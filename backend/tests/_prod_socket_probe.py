import asyncio, json, urllib.request
import socketio

PRD = "https://diana-store-2.emergent.host"
PATH = "/api/socket.io"


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(PRD + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


async def main():
    token = http("POST", "/api/auth/login-whitelist", body={"username": "admin", "password": "admin123"})["session_token"]
    prods = http("GET", "/api/products")
    p1 = prods[0]["id"]
    http("POST", "/api/live/start", token=token, body={"title": "TES SOKET PRODUKSI", "caption": "", "product_ids": [p1], "show_cart": True, "require_login": False})

    # --- Admin (host) socket, like the APK ---
    admin_events = {"viewers": None, "chat": []}
    admin = socketio.AsyncClient()

    @admin.on("live_viewers")
    async def on_v(p): admin_events["viewers"] = p
    @admin.on("live_chat")
    async def on_c(m): admin_events["chat"].append(m)

    await admin.connect(PRD, socketio_path=PATH, auth={"token": token}, transports=["websocket"])

    # --- Guest (web audience) socket, like dianastuff.com ---
    guest_events = {"history": None, "chat_echo": []}
    guest = socketio.AsyncClient()

    @guest.on("live_chat_history")
    async def on_h(m): guest_events["history"] = m
    @guest.on("live_chat")
    async def on_gc(m): guest_events["chat_echo"].append(m)

    try:
        await guest.connect(PRD, socketio_path=PATH, transports=["websocket"])
        print("GUEST websocket connect: OK")
    except Exception as e:
        print("GUEST websocket connect FAILED:", str(e)[:200])
        # try polling fallback
        try:
            await guest.connect(PRD, socketio_path=PATH, transports=["polling"])
            print("GUEST polling connect: OK")
        except Exception as e2:
            print("GUEST polling connect FAILED:", str(e2)[:200])

    await guest.emit("join_live", {})
    await asyncio.sleep(1.5)
    await guest.emit("live_chat", {"text": "halo dari web tamu"})
    await asyncio.sleep(1.5)

    print("ADMIN received viewers:", admin_events["viewers"])
    print("ADMIN received chat:", admin_events["chat"])
    print("GUEST echo chat:", guest_events["chat_echo"])

    await guest.disconnect()
    await admin.disconnect()
    http("POST", "/api/live/stop", token=token)
    print("DONE")


asyncio.run(main())
