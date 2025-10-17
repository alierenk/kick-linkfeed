import asyncio
import json
from kickpython import KickAPI
import websockets

connected_clients = set()

async def ws_handler(websocket):
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)

async def chat_listener():
    api = KickAPI()

    async def message_handler(msg):
        print(json.dumps(msg, indent=2))

        username = msg.get("sender_username")
        content = msg.get("content") or ""
        avatar = msg.get("profile_pic")
        print(f"[CHAT] {username}: {content}: Avatar: {avatar}")

        links = [url for url in content.split() if url.startswith("http")]  
        payload = {
            "username": username,
            "content": content,
            "links": links,
            "avatar" : avatar
        }

        if connected_clients:
            await asyncio.gather(*(ws.send(json.dumps(payload)) for ws in connected_clients))

    api.add_message_handler(message_handler)
    await api.connect_to_chatroom("alierenbey")  #kanal adı 

    while True:
        await asyncio.sleep(1)


async def main():
    ws_server = await websockets.serve(ws_handler, "0.0.0.0", 6789)
    print("WebSocket server running at ws://localhost:6789")
    await chat_listener()

if __name__ == "__main__":
    asyncio.run(main())