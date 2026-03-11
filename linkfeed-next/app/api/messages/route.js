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
  console.log("[NEXT API] POST /api/messages payload:", JSON.stringify(data));

  await client.connect();
  const db = client.db("kick_chat");
  const col = db.collection("messages");

  if (data.messageId) {
    const exists = await col.findOne({ messageId: data.messageId });
    if (exists) {
      console.log("[NEXT API] Duplicate messageId, skipping insert:", data.messageId);
      return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
    }
  }

  if (data.links && data.links.length > 0) {
    await col.insertOne({
      username: data.username,
      links: data.links,
      badges: data.badges || [],
      is_subscriber: data.is_subscriber || false,
      subscription_months: data.subscription_months || 0,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      username_color: data.username_color || null,
      channel: data.channel || "default",
      messageId: data.messageId || null,
    });
    console.log("[NEXT API] Inserted message for channel:", data.channel);
  } else {
    console.log("[NEXT API] Ignored payload - no links");
  }

  return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
}


