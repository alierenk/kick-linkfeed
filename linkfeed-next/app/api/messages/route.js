import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel");

  await client.connect();
  const db = client.db("kick_chat");
  const col = db.collection("messages");

  const query = channel ? { channel } : {};
  const messages = await col.find(query).sort({ timestamp: 1 }).toArray();

  return new Response(JSON.stringify(messages), { status: 200 });
}

export async function POST(req) {
  const data = await req.json();
  await client.connect();
  const db = client.db("kick_chat");
  const col = db.collection("messages");

  if (data.links && data.links.length > 0) {
    await col.insertOne({
      username: data.username,
      avatar: data.avatar || null,
      links: data.links,
      timestamp: data.timestamp || new Date(),
      channel: data.channel || "default",
    });
  }

  return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
}
