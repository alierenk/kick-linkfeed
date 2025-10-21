"use client";

import { useEffect, useRef, useState } from "react";
import "../public/style.css";

export default function Home() {
  const [currentChannel, setCurrentChannel] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const ws = useRef(null);

 
  useEffect(() => {
    ws.current = new WebSocket("ws://localhost:6789");

    ws.current.onopen = () => {
      console.log("Connected to Python listener");
      const last = localStorage.getItem("lastChannel");
      if (last) {
        ws.current.send(JSON.stringify({ type: "change_channel", channel: last }));
      }
    };

    ws.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (!data.links || data.links.length === 0) return;

      
      setMessages((prev) => [
        {
          username: data.username,
          avatar: data.avatar,
          links: data.links,
          timestamp: data.timestamp || new Date(),
        },
        ...prev,
      ]);

      
      try {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch (err) {
        console.error("DB insert failed:", err);
      }
    };

    return () => ws.current?.close();
  }, []);

  
  const fetchMessages = async (channel) => {
    if (!channel) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/messages?channel=${channel}`);
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setMessages(data.reverse());
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      const channelName = e.target.value.trim();
      if (!channelName) return;

      setMessages([]);
      setCurrentChannel(channelName);
      localStorage.setItem("lastChannel", channelName);
      fetchMessages(channelName);

      const payload = JSON.stringify({ type: "change_channel", channel: channelName });
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(payload);
      } else {
        ws.current?.addEventListener("open", () => ws.current.send(payload));
      }
    }
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
            <div className="username-link">
              {msg.avatar && <img src={msg.avatar} alt={msg.username} />}
              <span className="username">{msg.username}:</span>
              <div className="links-container">
                {msg.links.map((url, j) => (
                  <a key={j} href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                ))}
              </div>
            </div>
            <span className="timestamp">{new Date(msg.timestamp).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
