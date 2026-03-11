import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const FRONTEND_WS_PORT = 6789;
const HTTP_PORT = 4000;

const wss = new WebSocketServer({ port: FRONTEND_WS_PORT });
const clients = new Set();

let pusherWs = null;
let activeChatroom = null;
let activeChannelName = null;
let connectingTo = null;

wss.on("connection", (socket) => {
  clients.add(socket);
  console.log("Frontend WS client connected. Total:", clients.size);

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
  console.log("Frontend WS client disconnected. Total:", clients.size);

  setTimeout(() => {
    if (clients.size === 0 && pusherWs) {
      console.log("No clients left for 500ms → closing Pusher");
      try {
        pusherWs.close();
      } catch {}
      pusherWs = null;
      activeChatroom = null;
      activeChannelName = null;
      connectingTo = null;
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

function startPusherConnection(chatroomId, channelName = null) {
  if (!chatroomId) return;
  if (activeChatroom === chatroomId && pusherWs?.readyState === WebSocket.OPEN) return;
  if (connectingTo === chatroomId) return;
  connectingTo = chatroomId;

  if (!pusherWs) {
    const wsUrl = `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false`;
    pusherWs = new WebSocket(wsUrl);

    pusherWs.on("open", () => {
      activeChatroom = chatroomId;
      connectingTo = null;
      if (pusherWs && pusherWs.readyState === WebSocket.OPEN) {
        pusherWs.send(JSON.stringify({
          event: "pusher:subscribe",
          data: { channel: `chatrooms.${chatroomId}.v2` }
        }));
      }
    });

    pusherWs.on("message", handlePusherMessage);

    pusherWs.on("close", () => {
      pusherWs = null;
      activeChatroom = null;
      activeChannelName = null;
      connectingTo = null;
      console.log("Pusher WS closed");
    });

    pusherWs.on("error", (err) => {
      console.error("Pusher WS error:", err);
      if (pusherWs && (pusherWs.readyState === WebSocket.OPEN || pusherWs.readyState === WebSocket.CONNECTING)) {
        try { pusherWs.close(); } catch {}
      }
      pusherWs = null;
      activeChatroom = null;
      activeChannelName = null;
      connectingTo = null;
    });
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
      console.error("Channel switch error:", err);
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
            await fetch("http://localhost:3000/api/messages", {
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


app.get("/api/channel/:channelName", async (req, res) => {
  const { channelName } = req.params;
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${channelName}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
        "Accept": "*/*"
      }
    });
    if (!r.ok) return res.status(r.status).json({ error: "Kanal bulunamadı" });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/connect", (req, res) => {
  const { chatroomId, channelName } = req.body;
  if (!chatroomId) return res.status(400).json({ error: "chatroomId required" });
  startPusherConnection(chatroomId, channelName || null);
  res.json({ success: true, chatroomId, channelName: channelName || null });
});

app.listen(HTTP_PORT, () => {
  console.log(`Backend HTTP listening on http://localhost:${HTTP_PORT}`);
  console.log(`Frontend WS server listening on ws://localhost:${FRONTEND_WS_PORT}`);
});
