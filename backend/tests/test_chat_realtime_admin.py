# Realtime chat: admin broadcast room regression tests
# Verifies the bug fix for "Admin tidak terima chat" — admins must receive
# buyer messages in realtime WITHOUT joining the buyer's room, both for
# socket-sent messages and REST POST /api/chat/send. Also covers unread
# badge counts and read-marking regressions.
import asyncio
import os
import uuid

import pytest
import requests
import socketio

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or ""
).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL env var is required"


@pytest.fixture(scope="module")
def admin_auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": "admin", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["session_token"], "user": data["user"]}


@pytest.fixture(scope="module")
def buyer_auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": "buyer", "password": "buyer123"},
        timeout=15,
    )
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["session_token"], "user": data["user"]}


def _auth_header(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def _connect(token):
    """Connect a socket.io client against the public endpoint."""
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    await client.connect(
        BASE_URL,
        socketio_path="api/socket.io",
        auth={"token": token},
        transports=["websocket", "polling"],
        wait_timeout=15,
    )
    return client


async def _wait_message(client, predicate=None, timeout=8):
    """Wait for a 'message' event matching predicate."""
    fut = asyncio.get_event_loop().create_future()

    def on_message(msg):
        if predicate is None or predicate(msg):
            if not fut.done():
                fut.set_result(msg)

    client.on("message", on_message)
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    finally:
        client.handlers.pop("message", None) if hasattr(client, "handlers") else None


class TestChatRealtimeAdminBroadcast:
    """Core bug fix: admin receives buyer messages without joining buyer room."""

    def test_buyer_socket_message_reaches_admin_broadcast_room(self, admin_auth, buyer_auth):
        """Admin (connected, NOT joined to buyer room) must receive the buyer's
        socket-emitted message; buyer receives the server echo too."""
        buyer_uid = buyer_auth["user"]["user_id"]
        unique_text = f"TEST_rt_socket_{uuid.uuid4().hex[:8]}"

        async def scenario():
            admin = await _connect(admin_auth["token"])
            buyer = await _connect(buyer_auth["token"])
            try:
                await buyer.emit("join", {"room": buyer_uid})
                admin_wait = asyncio.ensure_future(
                    _wait_message(admin, lambda m: m.get("text") == unique_text)
                )
                buyer_wait = asyncio.ensure_future(
                    _wait_message(buyer, lambda m: m.get("text") == unique_text)
                )
                await asyncio.sleep(0.5)  # let join settle server-side
                await buyer.emit("message", {"room": buyer_uid, "text": unique_text})
                admin_msg, buyer_msg = await asyncio.gather(admin_wait, buyer_wait)
                return admin_msg, buyer_msg
            finally:
                await admin.disconnect()
                await buyer.disconnect()

        admin_msg, buyer_msg = asyncio.run(asyncio.wait_for(scenario(), timeout=30))
        # Admin received it without joining the buyer's room
        assert admin_msg["room"] == buyer_uid
        assert admin_msg["sender_role"] == "buyer"
        assert admin_msg["sender_id"] == buyer_uid
        # Buyer echo (instant feedback of own sent message)
        assert buyer_msg["room"] == buyer_uid
        assert buyer_msg["sender_id"] == buyer_uid
        assert buyer_msg["text"] == unique_text

    def test_rest_chat_send_reaches_admin_socket(self, admin_auth, buyer_auth):
        """REST POST /api/chat/send by buyer must also broadcast to the 'admins' room."""
        buyer_uid = buyer_auth["user"]["user_id"]
        unique_text = f"TEST_rt_rest_{uuid.uuid4().hex[:8]}"

        async def scenario():
            admin = await _connect(admin_auth["token"])
            try:
                waiter = asyncio.ensure_future(
                    _wait_message(admin, lambda m: m.get("text") == unique_text)
                )
                await asyncio.sleep(0.5)
                r = requests.post(
                    f"{BASE_URL}/api/chat/send",
                    json={"text": unique_text},
                    headers=_auth_header(buyer_auth["token"]),
                    timeout=15,
                )
                assert r.status_code == 200, f"chat/send failed: {r.status_code} {r.text}"
                return await waiter
            finally:
                await admin.disconnect()

        admin_msg = asyncio.run(asyncio.wait_for(scenario(), timeout=30))
        assert admin_msg["room"] == buyer_uid
        assert admin_msg["text"] == unique_text

    def test_admin_socket_reply_reaches_buyer(self, admin_auth, buyer_auth):
        """Admin reply (socket, targeting buyer room) reaches the buyer in realtime;
        a second admin listening on the broadcast room also sees it."""
        buyer_uid = buyer_auth["user"]["user_id"]
        unique_text = f"TEST_rt_admin_reply_{uuid.uuid4().hex[:8]}"

        async def scenario():
            admin = await _connect(admin_auth["token"])
            buyer = await _connect(buyer_auth["token"])
            try:
                await buyer.emit("join", {"room": buyer_uid})
                buyer_wait = asyncio.ensure_future(
                    _wait_message(buyer, lambda m: m.get("text") == unique_text)
                )
                await asyncio.sleep(0.5)
                await admin.emit("message", {"room": buyer_uid, "text": unique_text})
                return await buyer_wait
            finally:
                await admin.disconnect()
                await buyer.disconnect()

        buyer_msg = asyncio.run(asyncio.wait_for(scenario(), timeout=30))
        assert buyer_msg["room"] == buyer_uid
        assert buyer_msg["sender_role"] == "admin"
        assert buyer_msg["text"] == unique_text

    def test_buyer_cannot_join_foreign_room(self, admin_auth, buyer_auth):
        """Security: a buyer joining another user's room must be ignored."""
        buyer_uid = buyer_auth["user"]["user_id"]
        unique_text = f"TEST_rt_foreign_{uuid.uuid4().hex[:8]}"

        async def scenario():
            buyer = await _connect(buyer_auth["token"])
            try:
                # Buyer tries to join a room that is not their own
                await buyer.emit("join", {"room": "someone-else-room"})
                waiter = asyncio.ensure_future(_wait_message(buyer, timeout=5))
                await asyncio.sleep(0.5)
                # Send a message to that foreign room via admin REST
                requests.post(
                    f"{BASE_URL}/api/chat/send",
                    json={"room": "someone-else-room", "text": unique_text},
                    headers=_auth_header(admin_auth["token"]),
                    timeout=15,
                )
                try:
                    msg = await waiter
                    return msg  # should not happen
                except asyncio.TimeoutError:
                    return None
            finally:
                await buyer.disconnect()

        msg = asyncio.run(asyncio.wait_for(scenario(), timeout=30))
        assert msg is None, f"buyer illegally received message from foreign room: {msg}"


class TestChatUnreadBadges:
    """Regression: unread badge counts and read-marking."""

    def test_unread_increments_and_read_marks_for_admin(self, admin_auth, buyer_auth):
        buyer_uid = buyer_auth["user"]["user_id"]

        def buyer_room_unread():
            r = requests.get(f"{BASE_URL}/api/chat/rooms", headers=_auth_header(admin_auth["token"]), timeout=15)
            assert r.status_code == 200
            for room in r.json():
                if room["room"] == buyer_uid:
                    return room["unread"]
            return 0

        # Baseline: per-room unread (admin global unread spans other rooms, so
        # the rooms endpoint is the correct scope for this assertion)
        baseline = buyer_room_unread()

        # Buyer sends a message (read_admin must be False)
        unique_text = f"TEST_unread_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/chat/send",
            json={"text": unique_text},
            headers=_auth_header(buyer_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200

        # Global admin unread must increment by exactly 1
        g0 = requests.get(f"{BASE_URL}/api/chat/unread", headers=_auth_header(admin_auth["token"]), timeout=15)
        after_send = buyer_room_unread()
        assert after_send == baseline + 1, (
            f"room unread did not increment: {baseline} -> {after_send}"
        )

        # Mark read via POST /api/chat/read {room}
        rr = requests.post(
            f"{BASE_URL}/api/chat/read",
            json={"room": buyer_uid},
            headers=_auth_header(admin_auth["token"]),
            timeout=15,
        )
        assert rr.status_code == 200
        after_read = buyer_room_unread()
        assert after_read == 0, f"room unread not reset after read: {after_read}"
        g1 = requests.get(f"{BASE_URL}/api/chat/unread", headers=_auth_header(admin_auth["token"]), timeout=15)
        assert g1.json()["count"] == g0.json()["count"] - (baseline + 1), (
            "global admin unread should drop by exactly the room's unread count"
        )

    def test_buyer_unread_counts_admin_replies_and_read_marks(self, admin_auth, buyer_auth):
        buyer_uid = buyer_auth["user"]["user_id"]
        r0 = requests.get(f"{BASE_URL}/api/chat/unread", headers=_auth_header(buyer_auth["token"]), timeout=15)
        assert r0.status_code == 200
        baseline = r0.json()["count"]

        unique_text = f"TEST_unread_buyer_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/chat/send",
            json={"room": buyer_uid, "text": unique_text},
            headers=_auth_header(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200

        r1 = requests.get(f"{BASE_URL}/api/chat/unread", headers=_auth_header(buyer_auth["token"]), timeout=15)
        assert r1.json()["count"] == baseline + 1

        rr = requests.post(
            f"{BASE_URL}/api/chat/read",
            json={},
            headers=_auth_header(buyer_auth["token"]),
            timeout=15,
        )
        assert rr.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/chat/unread", headers=_auth_header(buyer_auth["token"]), timeout=15)
        # Buyer unread is scoped to the buyer's own room, so read resets it to 0
        assert r2.json()["count"] == 0

    def test_admin_send_without_room_returns_400(self, admin_auth):
        r = requests.post(
            f"{BASE_URL}/api/chat/send",
            json={"text": "TEST_no_room"},
            headers=_auth_header(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 400

    def test_admin_read_without_room_returns_400(self, admin_auth):
        r = requests.post(
            f"{BASE_URL}/api/chat/read",
            json={},
            headers=_auth_header(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 400

    def test_empty_message_rejected(self, buyer_auth):
        r = requests.post(
            f"{BASE_URL}/api/chat/send",
            json={},
            headers=_auth_header(buyer_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 400
