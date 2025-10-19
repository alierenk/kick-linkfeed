require("dotenv").config();
const express = require("express");
const path = require("path");
const { MongoClient } = require("mongodb");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "frontend")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

const server = app.listen(PORT, () => {
    console.log(`Frontend server running at http://localhost:${PORT}`);
});

const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });

let messagesCollection;

async function initMongo() {
    try {
        await client.connect();
        const db = client.db("kick_chat");
        messagesCollection = db.collection("messages");
        console.log("MongoDB connected");
    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}
initMongo();

app.get("/messages", async (req, res) => {
    try {
        if (!messagesCollection) return res.status(500).send("DB not ready");
        const channel = req.query.channel;
        const query = channel ? { channel } : {};
        const messages = await messagesCollection
            .find(query)
            .sort({ timestamp: 1 })
            .toArray();
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching messages");
    }
});

let wsPython = new WebSocket("ws://localhost:6789");
let currentChannel = null;

wsPython.on("open", () => {
    console.log("Connected to Python WebSocket listener");
});

wsPython.on("message", async (data) => {
    const msg = JSON.parse(data);

    msg.timestamp = new Date();
    if (!msg.channel && msg.username) msg.channel = currentChannel || "default";

    
    const linksOnly = {
        username: msg.username,
        links: msg.links || [],
        avatar: msg.avatar || null,
        timestamp: msg.timestamp,
        channel: msg.channel
    };

    if (messagesCollection) {
        try {
            await messagesCollection.insertOne(linksOnly);
        } catch (err) {
            console.error("MongoDB insert error:", err);
        }
    }
});
