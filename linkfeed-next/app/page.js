"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { VariableSizeList as List } from "react-window";
import "../public/style.css";

export default function Home() {
  const backendBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL || "http://localhost:4000";
  const frontendWsUrl =
    process.env.NEXT_PUBLIC_FRONTEND_WS_URL || "ws://localhost:6789";
  const [currentChannel, setCurrentChannel] = useState("");
  const [messages, setMessages] = useState([]);
  const [subscriberBadges, setSubscriberBadges] = useState([]);
  const [loading, setLoading] = useState(false);
  const ws = useRef(null);
  const wsReconnectTimer = useRef(null);
  const wsReconnectAttempt = useRef(0);
  const wsClosedByUser = useRef(false);
  const listRef = useRef(null);
  const listContainerRef = useRef(null);
  const rowHeights = useRef({});
  const [listSize, setListSize] = useState({ width: 0, height: 0 });

  const badgeIcons = {
    broadcaster: "/assets/icons/broadcaster.svg",
    vip: "/assets/icons/vip.svg",
    moderator: "/assets/icons/moderator.svg",
    og: "/assets/icons/og.svg",
    founder: "/assets/icons/founder.svg",
    staff: "/assets/icons/staff.svg",
    subgifter: "/assets/icons/subgifter.svg",
    subgifter25: "/assets/icons/subgifter25.svg",
    subgifter50: "/assets/icons/subgifter50.svg",
    subgifter100: "/assets/icons/subgifter100.svg",
    subgifter200: "/assets/icons/subgifter200.svg",
    verified: "/assets/icons/verified.svg",
    subscriber: "/assets/icons/subscriber.svg",
  };

  const connectWs = () => {
    if (wsClosedByUser.current) return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) return;

    ws.current = new WebSocket(frontendWsUrl);

    ws.current.onopen = () => {
      wsReconnectAttempt.current = 0;
      if (wsReconnectTimer.current) {
        clearTimeout(wsReconnectTimer.current);
        wsReconnectTimer.current = null;
      }
      const last = localStorage.getItem("lastChannel");
      if (last) {
        (async () => {
          try {
            const res = await fetch(`${backendBaseUrl}/api/channel/${last}`);
            if (res.ok) {
              const data = await res.json();
              const subs =
                data.subscriber_badges ||
                data.chatroom?.subscriber_badges ||
                data.channel?.subscriber_badges ||
                data.subscriberBadges ||
                null;

              if (subs && Array.isArray(subs)) setSubscriberBadges(subs);

              const chatroomId = data.chatroom?.id;
              if (chatroomId) {
                await fetch(`${backendBaseUrl}/api/connect`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chatroomId, channelName: last }),
                });
              }
            }
          } catch (err) {}
        })();
      }
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data.links || data.links.length === 0) return;

      setMessages((prev) => [
        {
          username: data.username,
          username_color: data.username_color || null,
          links: data.links,
          badges: data.badges || [],
          is_subscriber: data.is_subscriber || false,
          subscription_months: data.subscription_months || 0,
          timestamp: data.timestamp || new Date(),
        },
        ...prev,
      ]);
    };

    ws.current.onclose = () => {
      if (wsClosedByUser.current) return;
      const attempt = wsReconnectAttempt.current + 1;
      wsReconnectAttempt.current = attempt;
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
      wsReconnectTimer.current = setTimeout(() => connectWs(), delay);
    };

    ws.current.onerror = () => {
      try {
        ws.current?.close();
      } catch {}
    };
  };

  useEffect(() => {
    wsClosedByUser.current = false;
    connectWs();
    return () => {
      wsClosedByUser.current = true;
      if (wsReconnectTimer.current) {
        clearTimeout(wsReconnectTimer.current);
        wsReconnectTimer.current = null;
      }
      try {
        ws.current?.close();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const measure = () => setListSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    rowHeights.current = {};
    if (listRef.current) listRef.current.resetAfterIndex(0);
  }, [messages.length]);

  const fetchMessages = async (channel) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages?channel=${encodeURIComponent(channel)}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      setMessages(Array.isArray(data) ? data.slice().reverse() : []);
    } catch (err) {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const getSubscriberBadgeUrl = (months) => {
    if (!subscriberBadges || subscriberBadges.length === 0) return null;
    const candidates = subscriberBadges
      .filter((b) => b && typeof b.months === "number" && b.months <= months)
      .sort((a, b) => b.months - a.months);

    if (candidates.length > 0)
      return candidates[0].badge_image?.src || candidates[0].badge_image?.srcset || null;

    const sorted = subscriberBadges
      .filter((b) => b && typeof b.months === "number")
      .sort((a, b) => a.months - b.months);

    return sorted.length > 0 ? sorted[0].badge_image?.src || null : null;
  };

  const setRowHeight = (index, size) => {
    if (rowHeights.current[index] !== size) {
      rowHeights.current[index] = size;
      if (listRef.current) listRef.current.resetAfterIndex(index);
    }
  };

  const getRowHeight = (index) => rowHeights.current[index] || 120;

  const Row = ({ index, style, data }) => {
    const { items, badgeIcons, getSubscriberBadgeUrl, setRowHeight } = data;
    const msg = items[index];
    const rowRef = useRef(null);

    useLayoutEffect(() => {
      if (!rowRef.current) return;
      const measure = () => {
        const h = rowRef.current.getBoundingClientRect().height;
        if (h > 0) setRowHeight(index, h + 15);
      };
      measure();
      let ro;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(measure);
        ro.observe(rowRef.current);
      }
      return () => {
        if (ro) ro.disconnect();
      };
    }, [index, msg, setRowHeight]);

    if (!msg) return null;

    const rowStyle = {
      ...style,
      display: "flex",
      justifyContent: "center",
      paddingBottom: 15,
      boxSizing: "border-box",
    };

    return (
      <div style={rowStyle}>
        <div ref={rowRef} className="link-box">
          <div className="row">
            <div className="profile-col">
              <img
                src="/default-user.png"
                alt="User"
                className="profile-pic"
              />
            </div>
            <div className="content-col">

              <div className="links-container">
                {msg.links.map((url, j) => (
                  <a key={j} href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                ))}
              </div>

              <div className="user-info">
                <span className="shared-by">shared by:</span>

                <span
                  className={`username ${msg.is_subscriber ? "subscriber" : ""}`}
                  style={{ color: msg.username_color || "inherit" }}
                >
                  {msg.badges && msg.badges.length > 0 && (() => {
                    const normalize = (s) => {
                      const raw = String(s || "").toLowerCase().trim();
                      if (raw === "verified channel") return "verified";
                      const n = raw.replace(/\s+/g, "");
                      if (n.startsWith("subgifter")) return "subgifter";
                      return n;
                    };

                    const normalizedSet = new Set(msg.badges.map(normalize));
                    const order = ["verified", "broadcaster", "moderator", "vip", "og", "subgifter"];

                    return (
                      <span className="badges">
                        {order.map((name) => {
                          if (!normalizedSet.has(name)) return null;
                          const icon = badgeIcons[name];
                          return icon ? (
                            <img key={name} src={icon} alt={name} className="badge-icon" />
                          ) : null;
                        })}
                      </span>
                    );
                  })()}

                  <span>{msg.username}</span>

                  {msg.is_subscriber && (
                    <>
                      {msg.subscription_months > 0 && (
                        <span className="subscription-months">{`x${msg.subscription_months}`}</span>
                      )}

                      {(() => {
                        const badgeUrl = getSubscriberBadgeUrl(msg.subscription_months || 0);
                        return badgeUrl ? (
                          <img
                            src={badgeUrl}
                            alt={`subscriber ${msg.subscription_months} months`}
                            title={`${msg.subscription_months} months`}
                            className="badge-sub"
                          />
                        ) : (
                          <img
                            src={badgeIcons["subscriber"]}
                            alt="subscriber"
                            title="subscriber"
                            className="badge-sub"
                          />
                        );
                      })()}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          <span className="timestamp">
            {new Date(msg.timestamp).toLocaleString()}
          </span>
        </div>
      </div>
    );
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return;

    let channelName = e.target.value.trim().toLowerCase();
    if (!channelName) return;

    setMessages([]);
    setCurrentChannel(channelName);
    localStorage.setItem("lastChannel", channelName);
    fetchMessages(channelName);

    (async () => {
      try {
        const res = await fetch(`${backendBaseUrl}/api/channel/${channelName}`);
        if (!res.ok) return;

        const data = await res.json();
        const subs =
          data.subscriber_badges ||
          data.chatroom?.subscriber_badges ||
          data.channel?.subscriber_badges ||
          data.subscriberBadges ||
          null;

        if (subs && Array.isArray(subs)) setSubscriberBadges(subs);

        const chatroomId = data.chatroom?.id;
        if (!chatroomId) return;

        await fetch(`${backendBaseUrl}/api/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatroomId, channelName }),
        });

        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: "change_channel", channel: chatroomId, channelName }));
        }
      } catch (err) {}
    })();
  };

  useEffect(() => {
    const last = localStorage.getItem("lastChannel");
    if (last) {
      setCurrentChannel(last);
      fetchMessages(last);
    }
  }, []);

  return (
    <div>
      <header>
        <div className="header-content">
          <div className="left">LinkFeed</div>
          <div className="center">
            <img src="/kick-logo.png" alt="Kick Logo" className="kick-logo" />
            <input
              type="text"
              placeholder="Kanal adi girin"
              onKeyDown={handleKeyDown}
              defaultValue={currentChannel || ""}
              style={{ textTransform: "lowercase" }}
            />
          </div>
          <div className="right">
            <div className="viewers">hidden viewers</div>
            <button>Logout</button>
          </div>
        </div>
      </header>

      {loading && (
        <div id="loading">
          <div className="spinner"></div>
        </div>
      )}

      <div id="links" ref={listContainerRef}>
        {listSize.height > 0 && listSize.width > 0 && (
          <List
            ref={listRef}
            height={listSize.height}
            width={listSize.width}
            itemCount={messages.length}
            itemSize={getRowHeight}
            itemData={{ items: messages, badgeIcons, getSubscriberBadgeUrl, setRowHeight }}
            itemKey={(index, data) => data.items[index]?.messageId || `${data.items[index]?.timestamp || "t"}-${index}`}
            overscanCount={6}
          >
            {Row}
          </List>
        )}
      </div>
    </div>
  );
}

