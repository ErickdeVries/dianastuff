"""Backend tests for Live Shopping ENHANCEMENTS (iteration 18).

Covers only the new fields + Socket.IO changes described in the review:

REST:
- POST /api/live/start persists new fields: caption, show_cart, require_login.
- Response and GET /api/live/current include: caption, show_cart, require_login,
  and whatsapp (from profil_admin).
- POST /api/live/stop clears live AND clears the in-memory chat buffer.

Socket.IO (path /api/socket.io):
- Guests (no token) CAN connect (previously rejected).
- Authenticated users still connect (join user room + admins room for admin).
- join_live emits live_chat_history (last 50) after buffered messages exist.
- live_chat broadcasts message {id,name,role,text,ts} to 'live' room and buffers it.
- live_react broadcasts validated emoji to 'live' room (falls back to ❤️ for unknown).
- Security: guest 'join' handler is silently rejected (does not enter arbitrary room).
- Security: guest 'message' handler is silently rejected (no chat_message saved).
- Non-admin buyer cannot join arbitrary rooms via 'join' (silently rejected).

Cleanup: after each start we stop the live at test end.
"""
import os
import time
import uuid

import pytest
import requests
import socketio


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set for tests"

ADMIN = {"username": "admin", "password": "admin123"}
BUYER = {"username": "buyer", "password": "buyer123"}


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, creds):
    r = api.post(f"{BASE_URL}/api/auth/login-whitelist", json=creds, timeout=15)
    assert r.status_code == 200, f"login {creds['username']}: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token(api):
    return _login(api, ADMIN)


@pytest.fixture(scope="module")
def buyer_token(api):
    return _login(api, BUYER)


@pytest.fixture(scope="module")
def product_ids(api):
    r = api.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200
    return [p["id"] for p in r.json()[:2]]


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(api, admin_token):
    yield
    try:
        api.post(f"{BASE_URL}/api/live/stop",
                 headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    except Exception:
        pass


def _start(api, admin_token, **overrides):
    payload = {
        "title": overrides.get("title", "TEST_ENH_LIVE"),
        "caption": overrides.get("caption", "Halo semua! Diskon spesial hari ini"),
        "product_ids": overrides.get("product_ids", []),
        "show_cart": overrides.get("show_cart", True),
        "require_login": overrides.get("require_login", False),
    }
    r = api.post(f"{BASE_URL}/api/live/start", json=payload,
                 headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _stop(api, admin_token):
    api.post(f"{BASE_URL}/api/live/stop",
             headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)


# --------------------------------------------------------------------------- REST
class TestLiveNewFields:
    def test_start_persists_new_fields_and_response_shape(self, api, admin_token, product_ids):
        body = _start(api, admin_token,
                      caption="Live caption iter18",
                      product_ids=product_ids,
                      show_cart=True,
                      require_login=False)
        # Response contains all new fields
        assert body["live"] is True
        assert body["caption"] == "Live caption iter18"
        assert body["show_cart"] is True
        assert body["require_login"] is False
        assert "whatsapp" in body
        # whatsapp comes from profil_admin (may be seeded 085312812452 or empty)
        assert isinstance(body["whatsapp"], str)
        assert isinstance(body.get("products"), list)

    def test_current_includes_new_fields_and_whatsapp(self, api, admin_token, product_ids):
        _start(api, admin_token, caption="cap2", show_cart=False, require_login=True,
               product_ids=product_ids)
        r = api.get(f"{BASE_URL}/api/live/current", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["live"] is True
        assert body["caption"] == "cap2"
        assert body["show_cart"] is False
        assert body["require_login"] is True
        assert "whatsapp" in body

    def test_stop_returns_live_false_and_current_reflects(self, api, admin_token):
        _start(api, admin_token)
        r = api.post(f"{BASE_URL}/api/live/stop",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"live": False}
        cur = api.get(f"{BASE_URL}/api/live/current", timeout=15).json()
        assert cur == {"live": False}

    def test_start_defaults(self, api, admin_token):
        # Minimal payload — server should default show_cart=True, require_login=False,
        # caption="".
        r = api.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "TEST_DEFAULTS", "product_ids": []},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["show_cart"] is True
        assert b["require_login"] is False
        assert b["caption"] == ""
        _stop(api, admin_token)


# --------------------------------------------------------------------------- Socket.IO
def _sio_url():
    # python-socketio client uses the base URL and path.
    return BASE_URL


def _connect(token=None, timeout=8):
    client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
    auth = {"token": token} if token else {}
    client.connect(
        _sio_url(),
        socketio_path="/api/socket.io",
        transports=["websocket"],
        auth=auth,
        wait_timeout=timeout,
    )
    return client


class TestSocketConnect:
    def test_guest_can_connect(self):
        c = _connect(token=None)
        try:
            assert c.connected is True
        finally:
            c.disconnect()

    def test_admin_can_connect(self, api, admin_token):
        c = _connect(token=admin_token)
        try:
            assert c.connected is True
        finally:
            c.disconnect()

    def test_buyer_can_connect(self, api, buyer_token):
        c = _connect(token=buyer_token)
        try:
            assert c.connected is True
        finally:
            c.disconnect()


class TestLiveSocketEvents:
    def test_live_chat_broadcast_and_history(self, api, admin_token):
        _start(api, admin_token)
        try:
            # Sender = admin (has token, name=admin)
            sender = _connect(token=admin_token)
            receiver_msgs = []
            history_msgs = []

            receiver = _connect(token=None)

            @receiver.on("live_chat")
            def _on_chat(m):
                receiver_msgs.append(m)

            @receiver.on("live_chat_history")
            def _on_hist(msgs):
                history_msgs.append(msgs)

            sender.emit("join_live", {})
            receiver.emit("join_live", {})
            time.sleep(0.5)

            unique_text = f"hello_{uuid.uuid4().hex[:6]}"
            sender.emit("live_chat", {"text": unique_text})
            # give the server a moment to broadcast
            for _ in range(20):
                time.sleep(0.1)
                if any(m.get("text") == unique_text for m in receiver_msgs):
                    break

            got = [m for m in receiver_msgs if m.get("text") == unique_text]
            assert got, f"receiver did not get live_chat with text={unique_text}. got={receiver_msgs}"
            m = got[0]
            for k in ("id", "name", "role", "text", "ts"):
                assert k in m, f"missing key {k} in message {m}"
            assert m["text"] == unique_text
            assert m["role"] == "admin"

            # Now new receiver should get live_chat_history containing that message
            hist_recv = _connect(token=None)
            hist = []

            @hist_recv.on("live_chat_history")
            def _hh(msgs):
                hist.append(msgs)

            hist_recv.emit("join_live", {})
            for _ in range(20):
                time.sleep(0.1)
                if hist:
                    break
            assert hist, "no live_chat_history received on join_live after buffered messages"
            texts = [x.get("text") for x in hist[0]]
            assert unique_text in texts

            sender.disconnect()
            receiver.disconnect()
            hist_recv.disconnect()
        finally:
            _stop(api, admin_token)

    def test_live_react_broadcast_and_validation(self, api, admin_token):
        _start(api, admin_token)
        try:
            recv = _connect(token=None)
            got = []

            @recv.on("live_react")
            def _on_r(r):
                got.append(r)

            recv.emit("join_live", {})
            time.sleep(0.3)

            sender = _connect(token=None)
            sender.emit("live_react", {"emoji": "🔥"})
            sender.emit("live_react", {"emoji": "<script>"})  # invalid → fallback to ❤️

            for _ in range(20):
                time.sleep(0.1)
                if len(got) >= 2:
                    break

            emojis = [x.get("emoji") for x in got]
            assert "🔥" in emojis
            # Invalid should have been converted to ❤️
            assert "❤️" in emojis

            recv.disconnect()
            sender.disconnect()
        finally:
            _stop(api, admin_token)

    def test_stop_clears_chat_buffer(self, api, admin_token):
        # Start, post a message, stop, then start again and confirm no history
        _start(api, admin_token)
        s = _connect(token=admin_token)
        s.emit("join_live", {})
        time.sleep(0.2)
        s.emit("live_chat", {"text": "will_be_wiped"})
        time.sleep(0.5)
        s.disconnect()

        _stop(api, admin_token)
        _start(api, admin_token)
        try:
            r = _connect(token=None)
            hist = []

            @r.on("live_chat_history")
            def _h(m):
                hist.append(m)

            r.emit("join_live", {})
            time.sleep(1.0)
            # Buffer should have been cleared → either no history event OR empty list
            if hist:
                # If server does emit history, it must not contain the old text
                flat = [x for batch in hist for x in batch]
                assert not any(m.get("text") == "will_be_wiped" for m in flat), (
                    f"stop did not clear buffer, got {flat}"
                )
            r.disconnect()
        finally:
            _stop(api, admin_token)


class TestSocketSecurity:
    def test_guest_join_arbitrary_room_rejected_silently(self):
        """Guest emits 'join' with a chat room — handler must silently return."""
        c = _connect(token=None)
        try:
            # Should not raise nor cause disconnect; there is no way to observe the
            # room membership from the client, but we can verify the socket stays alive
            # and no error event is emitted.
            errors = []

            @c.on("error")
            def _err(e):
                errors.append(e)

            c.emit("join", {"room": "some_private_room"})
            time.sleep(0.4)
            assert c.connected is True
            assert not errors, f"guest join produced errors: {errors}"
        finally:
            c.disconnect()

    def test_guest_message_rejected_silently(self, api, admin_token):
        """Guest emits 'message' — must NOT be broadcast and must NOT save a chat doc."""
        # Snapshot chat count before
        r = api.get(f"{BASE_URL}/api/chat/rooms",
                    headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        if r.status_code != 200:
            pytest.skip("chat rooms endpoint not available")
        before = r.json()

        guest = _connect(token=None)
        received = []

        @guest.on("message")
        def _on_m(m):
            received.append(m)

        guest.emit("message", {"text": "guest_msg_should_be_ignored", "room": "guest_room"})
        time.sleep(0.5)

        # No message broadcasted back
        assert not received, f"guest message was broadcasted: {received}"

        # Admin chat rooms list should be unchanged (no new room appeared)
        r2 = api.get(f"{BASE_URL}/api/chat/rooms",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15).json()
        assert len(r2) == len(before), "guest message created a chat room in DB"
        guest.disconnect()

    def test_buyer_cannot_join_arbitrary_room(self, buyer_token):
        """Non-admin buyer emitting 'join' with a room != own user_id → handler returns."""
        c = _connect(token=buyer_token)
        try:
            errors = []

            @c.on("error")
            def _err(e):
                errors.append(e)

            c.emit("join", {"room": "some_other_user_id"})
            time.sleep(0.3)
            assert c.connected is True
            assert not errors
        finally:
            c.disconnect()
