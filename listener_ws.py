import re
import asyncio
import json
import datetime
from kickpython import KickAPI
import websockets

connected_clients = set()
current_channel_task = None

async def ws_handler(websocket):
    global current_channel_task
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            msg = json.loads(message)
            if msg.get("type") == "change_channel":
                channel_name = msg.get("channel")
                if current_channel_task and not current_channel_task.done():
                    current_channel_task.cancel()
                current_channel_task = asyncio.create_task(chat_listener(channel_name))
    except asyncio.CancelledError:
        pass
    finally:
        connected_clients.remove(websocket)

async def chat_listener(channel_name):
    api = KickAPI()

    async def message_handler(msg):
        username = msg.get("sender_username")
        content = msg.get("content") or ""
        avatar = msg.get("profile_pic")

        url_pattern = re.compile(
        r'http[s]?://'                      
        r'(?:[a-zA-Z]|[0-9]|[$-_@.&+]|'     
        r'[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+'
        )
        
        links = url_pattern.findall(content)
        payload = {
            "username": username,
            "links": links,
            "avatar": avatar,
            "timestamp": str(datetime.datetime.now()),
            "channel": channel_name
        }

        if connected_clients and links:  
            await asyncio.gather(*(ws.send(json.dumps(payload)) for ws in connected_clients))

    api.add_message_handler(message_handler)
    await api.connect_to_chatroom(channel_name)

    while True:
        await asyncio.sleep(1)

async def main():
    ws_server = await websockets.serve(ws_handler, "0.0.0.0", 6789)
    print("WebSocket server running at ws://localhost:6789")
    await asyncio.Future()  

if __name__ == "__main__":
    asyncio.run(main())
