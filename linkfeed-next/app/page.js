"use client";

import { useEffect, useRef, useState } from "react";
import "../public/style.css";

export default function Home() {
  const [currentChannel, setCurrentChannel] = useState("");
  const [messages, setMessages] = useState([]);
  const [subscriberBadges, setSubscriberBadges] = useState([]);
  const [loading, setLoading] = useState(false);
  const ws = useRef(null);

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

  useEffect(() => {
    ws.current = new WebSocket("ws://localhost:6789");

    ws.current.onopen = () => {
      const last = localStorage.getItem("lastChannel");
      if (last) {
        (async () => {
          try {
            const res = await fetch(`http://localhost:4000/api/channel/${last}`);
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
                await fetch("http://localhost:4000/api/connect", {
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

    return () => ws.current?.close();
  }, []);

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
        const res = await fetch(`http://localhost:4000/api/channel/${channelName}`);
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

        await fetch("http://localhost:4000/api/connect", {
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
              placeholder="Kanal adı girin"
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

      <div id="links">
        {messages.map((msg, i) => (
          <div className="link-box" key={i}>
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
                  <span className="shared-by">↪ shared by:</span>

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
        ))}
      </div>
    </div>
  );
}
