import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const log = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

const FRONTEND_WS_PORT = Number(process.env.FRONTEND_WS_PORT || 6789);
const HTTP_PORT = Number(process.env.BACKEND_HTTP_PORT || 4000);
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const PUSHER_WS_URL =
  process.env.PUSHER_WS_URL ||
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false";
const KICK_API_BASE = process.env.KICK_API_BASE || "https://kick.com/api/v2";

const wss = new WebSocketServer({ port: FRONTEND_WS_PORT });
const clients = new Set();

const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60000);
const RATE_MAX = Number(process.env.RATE_MAX || 60);
const rateStore = new Map();

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (Array.isArray(fwd)) return fwd[0];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function rateLimit(req, res, next) {
  const key = getClientIp(req);
  const now = Date.now();
  const entry = rateStore.get(key);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) {
    rateStore.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    log.warn("Rate limit exceeded:", key, req.method, req.originalUrl);
    return res.status(429).json({ error: "Rate limit" });
  }
  return next();
}

let pusherWs = null;
let activeChatroom = null;
let activeChannelName = null;
let connectingTo = null;
let desiredChatroom = null;
let pusherReconnectTimer = null;
let pusherReconnectAttempt = 0;

wss.on("connection", (socket) => {
  clients.add(socket);
  log.info("Frontend WS client connected. Total:", clients.size);

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg?.type === "change_channel" && msg.channel) {
        startPusherConnection(msg.channel, msg.channelName);
      }
    } catch {}
  });

  socket.on("close", () => {
    clients.delete(socket);
    log.info("Frontend WS client disconnected. Total:", clients.size);

    setTimeout(() => {
      if (clients.size === 0 && pusherWs) {
        log.info("No clients left for 500ms -> closing Pusher");
        try {
          pusherWs.close();
        } catch {}
        pusherWs = null;
        activeChatroom = null;
        activeChannelName = null;
        connectingTo = null;
        desiredChatroom = null;
        pusherReconnectAttempt = 0;
        if (pusherReconnectTimer) {
          clearTimeout(pusherReconnectTimer);
          pusherReconnectTimer = null;
        }
      }
    }, 500);
  });
});

function broadcast(payload) {
  if (clients.size === 0) return;
  const j = JSON.stringify(payload);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(j);
  }
}

function schedulePusherReconnect() {
  if (!desiredChatroom) return;
  if (clients.size === 0) return;
  if (pusherReconnectTimer) return;
  pusherReconnectAttempt += 1;
  const delay = Math.min(30000, 1000 * 2 ** (pusherReconnectAttempt - 1));
  pusherReconnectTimer = setTimeout(() => {
    pusherReconnectTimer = null;
    createPusherWs();
  }, delay);
}

function createPusherWs() {
  if (!desiredChatroom) return;
  if (pusherWs && (pusherWs.readyState === WebSocket.OPEN || pusherWs.readyState === WebSocket.CONNECTING)) return;

  pusherWs = new WebSocket(PUSHER_WS_URL);

  pusherWs.on("open", () => {
    pusherReconnectAttempt = 0;
    if (pusherReconnectTimer) {
      clearTimeout(pusherReconnectTimer);
      pusherReconnectTimer = null;
    }
    activeChatroom = desiredChatroom;
    connectingTo = null;
    if (pusherWs && pusherWs.readyState === WebSocket.OPEN) {
      pusherWs.send(JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: `chatrooms.${desiredChatroom}.v2` }
      }));
    }
  });

  pusherWs.on("message", handlePusherMessage);

  pusherWs.on("close", () => {
    pusherWs = null;
    activeChatroom = null;
    activeChannelName = null;
    connectingTo = null;
    log.info("Pusher WS closed");
    schedulePusherReconnect();
  });

  pusherWs.on("error", (err) => {
    log.error("Pusher WS error:", err);
    if (pusherWs && (pusherWs.readyState === WebSocket.OPEN || pusherWs.readyState === WebSocket.CONNECTING)) {
      try { pusherWs.close(); } catch {}
    }
    pusherWs = null;
    activeChatroom = null;
    activeChannelName = null;
    connectingTo = null;
    schedulePusherReconnect();
  });
}

function startPusherConnection(chatroomId, channelName = null) {
  if (!chatroomId) return;
  if (activeChatroom === chatroomId && pusherWs?.readyState === WebSocket.OPEN) return;
  if (connectingTo === chatroomId) return;
  connectingTo = chatroomId;
  desiredChatroom = chatroomId;

  if (!pusherWs) {
    createPusherWs();
  } else {
    
    try {
      if (pusherWs && activeChatroom && pusherWs.readyState === WebSocket.OPEN) {
        pusherWs.send(JSON.stringify({
          event: "pusher:unsubscribe",
          data: { channel: `chatrooms.${activeChatroom}.v2` }
        }));
      }
      if (pusherWs && pusherWs.readyState === WebSocket.OPEN) {
        pusherWs.send(JSON.stringify({
          event: "pusher:subscribe",
          data: { channel: `chatrooms.${chatroomId}.v2` }
        }));
      }
      activeChatroom = chatroomId;
      connectingTo = null;
    } catch (err) {
      log.error("Channel switch error:", err);
    }
  }

  if (channelName) activeChannelName = channelName;
}

function handlePusherMessage(msg) {
  if (clients.size === 0) return;
  try {
    const data = JSON.parse(msg);
    const event = data.event;

    if (event === "pusher:connection_established" || event === "pusher_internal:subscription_succeeded") return;

    if (event?.includes("ChatMessageEvent")) {
      const chatData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
      const sender = chatData.sender || {};
      const content = chatData.content || "";

      const links = (content.match(/https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/gi) || []).map(u => u.trim());

      const rawBadges = sender.identity?.badges || [];

      const subscriberObj = rawBadges.find(
        b =>
          (b.type && b.type.toLowerCase() === "subscriber") ||
          (b.text && b.text.toLowerCase() === "subscriber")
      );

      const isSubscriber = !!subscriberObj;
      const subMonths = subscriberObj?.count || 0;

      const badgesArr = rawBadges.map(b => b.text || b.type);
      

      const payload = {
        username: sender.username || sender.slug || "unknown",
        username_color: sender.identity?.color || null,
        content,
        links,
        badges: badgesArr,
        is_subscriber: isSubscriber,
        subscription_months: subMonths,
        timestamp: chatData.created_at || new Date().toISOString(),
        channel: activeChannelName || chatData.chatroom_id,
        chatroomId: chatData.chatroom_id,
        messageId: chatData.id
      };

      broadcast(payload);

      if (payload.links?.length && clients.size > 0) {
        (async () => {
          try {
            await fetch(`${APP_BASE_URL}/api/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
          } catch {}
        })();
      }
    }
  } catch {}
}


app.get("/api/channel/:channelName", rateLimit, async (req, res) => {
  const { channelName } = req.params;
  try {
    const r = await fetch(`${KICK_API_BASE}/channels/${channelName}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
        "Accept": "*/*"
      }
    });
    if (!r.ok) {
      log.warn("Kick channel fetch failed:", r.status, channelName);
      return res.status(r.status).json({ error: "Kanal bulunamadi" });
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    log.error("Kick channel fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/connect", rateLimit, (req, res) => {
  const { chatroomId, channelName } = req.body;
  if (!chatroomId) return res.status(400).json({ error: "chatroomId required" });
  startPusherConnection(chatroomId, channelName || null);
  res.json({ success: true, chatroomId, channelName: channelName || null });
});

app.listen(HTTP_PORT, () => {
  log.info(`Backend HTTP listening on http://localhost:${HTTP_PORT}`);
  log.info(`Frontend WS server listening on ws://localhost:${FRONTEND_WS_PORT}`);
});


