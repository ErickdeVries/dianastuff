"""Backend tests for Live Shopping iteration 19 — featured product,
admin moderation (pin/mute/kick), live-history recap, and live_chat->admins fanout.

Runs sequentially (no xdist) — see conftest.py or invocation flags.
"""
import os
import time
import uuid

import pytest
import requests
import socketio


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

ADMIN = {"username": "admin", "password": "admin123"}
BUYER = {"username": "buyer", "password": "buyer123"}


# --------------------------------------------------------------- session helpers
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
    ids = [p["id"] for p in r.json()[:3]]
    assert len(ids) >= 2, "need at least 2 products in DB"
    return ids


def _stop(api, admin_token):
    try:
        api.post(f"{BASE_URL}/api/live/stop",
                 headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(api, admin_token):
    _stop(api, admin_token)
    yield
    _stop(api, admin_token)


def _start(api, admin_token, product_ids, featured=None, **overrides):
    payload = {
        "title": overrides.get("title", "TEST_MOD_LIVE"),
        "caption": overrides.get("caption", ""),
        "product_ids": product_ids,
        "show_cart": overrides.get("show_cart", True),
        "require_login": overrides.get("require_login", False),
        "featured_product_id": featured,
    }
    r = api.post(f"{BASE_URL}/api/live/start", json=payload,
                 headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------- socket helpers
def _connect(token=None, timeout=10, retries=2):
    """Connect with a small delay between attempts to survive ingress flakes."""
    last_exc = None
    for attempt in range(retries + 1):
        try:
            client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
            auth = {"token": token} if token else {}
            client.connect(
                BASE_URL,
                socketio_path="/api/socket.io",
                transports=["websocket"],
                auth=auth,
                wait_timeout=timeout,
            )
            return client
        except Exception as e:
            last_exc = e
            time.sleep(0.6 + attempt * 0.6)
    raise last_exc


def _wait(cond, timeout=3.0, step=0.1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(step)
    return False


# =============================================================================
# 1) Featured product (start + change + validation)
# =============================================================================
class TestFeaturedProduct:
    def test_start_persists_featured_and_current_returns_full_product(self, api, admin_token, product_ids):
        body = _start(api, admin_token, product_ids, featured=product_ids[0])
        assert body["live"] is True
        assert isinstance(body.get("featured"), dict), f"featured must be a full product dict, got {body.get('featured')}"
        assert body["featured"]["id"] == product_ids[0]
        assert "nama_produk" in body["featured"] and "harga" in body["featured"]

        cur = api.get(f"{BASE_URL}/api/live/current", timeout=15).json()
        assert cur["live"] is True
        assert cur["featured"] and cur["featured"]["id"] == product_ids[0]
        _stop(api, admin_token)

    def test_start_with_featured_not_in_products_falls_back_to_none(self, api, admin_token, product_ids):
        # server drops featured silently if not in product_ids list
        bogus = "nonexistent_product_id_xyz"
        body = _start(api, admin_token, product_ids, featured=bogus)
        assert body["live"] is True
        assert body.get("featured") is None
        _stop(api, admin_token)

    def test_feature_change_during_live_and_socket_event(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids, featured=product_ids[0])
        try:
            # Guest subscribes to live_feature
            recv = _connect(token=None)
            got = []

            @recv.on("live_feature")
            def _on_f(p):
                got.append(p)

            recv.emit("join_live", {})
            time.sleep(0.4)

            # Admin swaps featured to product 2
            r = api.post(f"{BASE_URL}/api/live/feature", json={"product_id": product_ids[1]},
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["featured"] and body["featured"]["id"] == product_ids[1]

            assert _wait(lambda: len(got) >= 1, timeout=4.0), f"no live_feature received: {got}"
            payload = got[-1]
            assert payload.get("featured") and payload["featured"]["id"] == product_ids[1]

            # Now clear featured
            r2 = api.post(f"{BASE_URL}/api/live/feature", json={"product_id": None},
                          headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
            assert r2.status_code == 200 and r2.json()["featured"] is None
            recv.disconnect()
        finally:
            _stop(api, admin_token)

    def test_feature_rejects_id_not_in_live_products(self, api, admin_token, product_ids):
        _start(api, admin_token, [product_ids[0]])
        try:
            r = api.post(f"{BASE_URL}/api/live/feature", json={"product_id": product_ids[1]},
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
            assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        finally:
            _stop(api, admin_token)

    def test_feature_requires_admin(self, api, buyer_token, product_ids, admin_token):
        _start(api, admin_token, product_ids)
        try:
            r = api.post(f"{BASE_URL}/api/live/feature", json={"product_id": product_ids[0]},
                         headers={"Authorization": f"Bearer {buyer_token}"}, timeout=15)
            assert r.status_code in (401, 403), f"buyer got {r.status_code}"
        finally:
            _stop(api, admin_token)


# =============================================================================
# 2) Live-history REST + recap on stop
# =============================================================================
class TestLiveHistory:
    def test_live_history_admin_only(self, api, buyer_token):
        r = api.get(f"{BASE_URL}/api/admin/live-history",
                    headers={"Authorization": f"Bearer {buyer_token}"}, timeout=15)
        assert r.status_code in (401, 403)

        r2 = api.get(f"{BASE_URL}/api/admin/live-history", timeout=15)
        assert r2.status_code in (401, 403)

    def test_stop_stores_recap_and_history_returns_it(self, api, admin_token, product_ids):
        marker = f"TEST_REKAP_{uuid.uuid4().hex[:6]}"
        _start(api, admin_token, product_ids, title=marker)

        # Push a couple of reactions so total_likes > 0
        s = _connect(token=None)
        s.emit("join_live", {})
        time.sleep(0.3)
        s.emit("live_react", {"emoji": "🔥"})
        s.emit("live_react", {"emoji": "❤️"})
        time.sleep(0.5)
        s.disconnect()

        r = api.post(f"{BASE_URL}/api/live/stop",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200

        hist = api.get(f"{BASE_URL}/api/admin/live-history",
                       headers={"Authorization": f"Bearer {admin_token}"}, timeout=15).json()
        assert isinstance(hist, list) and len(hist) >= 1
        item = next((h for h in hist if h.get("title") == marker), None)
        assert item is not None, f"created show {marker} not in history"
        for k in ("id", "title", "started_at", "ended_at", "recap"):
            assert k in item
        recap = item["recap"]
        for k in ("peak_viewers", "total_likes", "orders_count", "orders_total"):
            assert k in recap
        # We fired 2 reactions from 1 sid — peak_viewers should be >= 1, likes >= 2
        assert recap["total_likes"] >= 2, f"expected total_likes>=2, got {recap['total_likes']}"
        assert recap["peak_viewers"] >= 1


# =============================================================================
# 3) Socket moderation (pin / mute / kick + admin-only enforcement)
# =============================================================================
class TestSocketModeration:
    def test_pin_by_admin_broadcasts_to_live_room(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            admin_sock = _connect(token=admin_token)
            viewer = _connect(token=None)
            pinned_events = []

            @viewer.on("live_pinned")
            def _on_p(p):
                pinned_events.append(p)

            viewer.emit("join_live", {})
            time.sleep(0.4)

            admin_sock.emit("pin_comment", {
                "message": {"id": "msg1", "name": "Alice", "role": "guest", "text": "Hello world"}
            })
            assert _wait(lambda: any(p.get("pinned") and p["pinned"].get("text") == "Hello world"
                                     for p in pinned_events), timeout=4.0), \
                f"no live_pinned received: {pinned_events}"

            # unpin
            admin_sock.emit("unpin_comment", {})
            assert _wait(lambda: any(p.get("pinned") is None for p in pinned_events), timeout=4.0), \
                f"no live_pinned=None received after unpin: {pinned_events}"

            admin_sock.disconnect()
            viewer.disconnect()
        finally:
            _stop(api, admin_token)

    def test_pin_by_non_admin_is_ignored(self, api, admin_token, buyer_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            viewer = _connect(token=None)
            pinned_events = []

            @viewer.on("live_pinned")
            def _on_p(p):
                pinned_events.append(p)

            viewer.emit("join_live", {})
            time.sleep(0.3)

            # Buyer (non-admin) tries to pin
            buyer_sock = _connect(token=buyer_token)
            buyer_sock.emit("pin_comment", {
                "message": {"id": "x", "name": "Buyer", "role": "buyer", "text": "should not pin"}
            })
            time.sleep(0.8)
            assert not any(p.get("pinned") and p["pinned"].get("text") == "should not pin"
                           for p in pinned_events), "buyer was able to pin!"

            # Guest tries to pin
            guest = _connect(token=None)
            guest.emit("pin_comment", {
                "message": {"id": "y", "name": "Guest", "role": "guest", "text": "guest pin attempt"}
            })
            time.sleep(0.8)
            assert not any(p.get("pinned") and p["pinned"].get("text") == "guest pin attempt"
                           for p in pinned_events), "guest was able to pin!"

            viewer.disconnect()
            buyer_sock.disconnect()
            guest.disconnect()
        finally:
            _stop(api, admin_token)

    def test_mute_blocks_chat_from_that_user(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            admin_sock = _connect(token=admin_token)
            target = _connect(token=None)
            other = _connect(token=None)

            admin_msgs = []
            other_msgs = []
            target_muted = []

            @admin_sock.on("live_chat")
            def _am(m): admin_msgs.append(m)

            @other.on("live_chat")
            def _om(m): other_msgs.append(m)

            @target.on("live_muted")
            def _tm(p): target_muted.append(p)

            target.emit("join_live", {})
            other.emit("join_live", {})
            time.sleep(0.5)

            # Send one message from target to grab its uid via the broadcast
            marker = f"pre_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": marker})
            assert _wait(lambda: any(m.get("text") == marker for m in other_msgs), timeout=4.0)
            target_msg = next(m for m in other_msgs if m.get("text") == marker)
            target_uid = target_msg["uid"]
            assert target_uid, "live_chat must include uid"

            # Admin mutes that uid
            admin_sock.emit("mod_mute", {"uid": target_uid, "mute": True})
            assert _wait(lambda: any(p.get("muted") is True for p in target_muted), timeout=4.0), \
                f"muted target did not get live_muted: {target_muted}"

            # Target tries to chat while muted → should be rejected (other should not receive)
            other_msgs.clear()
            muted_marker = f"muted_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": muted_marker})
            time.sleep(1.0)
            assert not any(m.get("text") == muted_marker for m in other_msgs), \
                "muted user's chat was broadcast"

            # Unmute
            admin_sock.emit("mod_mute", {"uid": target_uid, "mute": False})
            assert _wait(lambda: any(p.get("muted") is False for p in target_muted), timeout=4.0)

            unmute_marker = f"unmuted_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": unmute_marker})
            assert _wait(lambda: any(m.get("text") == unmute_marker for m in other_msgs), timeout=4.0), \
                "unmuted chat not broadcast"

            admin_sock.disconnect(); target.disconnect(); other.disconnect()
        finally:
            _stop(api, admin_token)

    def test_mute_by_non_admin_is_ignored(self, api, admin_token, buyer_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            target = _connect(token=None)
            target_muted = []

            @target.on("live_muted")
            def _tm(p): target_muted.append(p)

            target.emit("join_live", {})
            time.sleep(0.3)

            # Need a uid to try to mute — grab from viewers or from a chat
            other = _connect(token=None)
            broadcasts = []

            @other.on("live_chat")
            def _c(m): broadcasts.append(m)

            other.emit("join_live", {})
            time.sleep(0.3)
            marker = f"pre_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": marker})
            assert _wait(lambda: any(m.get("text") == marker for m in broadcasts), timeout=4.0)
            uid = next(m["uid"] for m in broadcasts if m.get("text") == marker)

            # Buyer (non-admin) tries mute
            buyer_sock = _connect(token=buyer_token)
            buyer_sock.emit("mod_mute", {"uid": uid, "mute": True})
            time.sleep(1.0)
            assert not any(p.get("muted") for p in target_muted), "non-admin succeeded to mute"

            target.disconnect(); other.disconnect(); buyer_sock.disconnect()
        finally:
            _stop(api, admin_token)

    def test_kick_removes_viewer_and_blocks_rejoin(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            admin_sock = _connect(token=admin_token)
            target = _connect(token=None)
            other = _connect(token=None)

            other_msgs = []
            target_kicked = []

            @other.on("live_chat")
            def _c(m): other_msgs.append(m)

            @target.on("live_kicked")
            def _k(_p=None): target_kicked.append(True)

            target.emit("join_live", {})
            other.emit("join_live", {})
            time.sleep(0.4)

            marker = f"pre_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": marker})
            assert _wait(lambda: any(m.get("text") == marker for m in other_msgs), timeout=4.0)
            uid = next(m["uid"] for m in other_msgs if m.get("text") == marker)

            admin_sock.emit("mod_kick", {"uid": uid})
            assert _wait(lambda: len(target_kicked) >= 1, timeout=4.0), "target did not get live_kicked"

            # Rejoin should be immediately kicked again
            target_kicked.clear()
            target.emit("join_live", {})
            assert _wait(lambda: len(target_kicked) >= 1, timeout=4.0), \
                "kicked user's rejoin was not rejected"

            admin_sock.disconnect(); target.disconnect(); other.disconnect()
        finally:
            _stop(api, admin_token)

    def test_kick_by_non_admin_is_ignored(self, api, admin_token, buyer_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            target = _connect(token=None)
            other = _connect(token=None)
            target_kicked = []
            other_msgs = []

            @target.on("live_kicked")
            def _k(_p=None): target_kicked.append(True)

            @other.on("live_chat")
            def _c(m): other_msgs.append(m)

            target.emit("join_live", {})
            other.emit("join_live", {})
            time.sleep(0.3)

            marker = f"pre_{uuid.uuid4().hex[:5]}"
            target.emit("live_chat", {"text": marker})
            assert _wait(lambda: any(m.get("text") == marker for m in other_msgs), timeout=4.0)
            uid = next(m["uid"] for m in other_msgs if m.get("text") == marker)

            buyer_sock = _connect(token=buyer_token)
            buyer_sock.emit("mod_kick", {"uid": uid})
            time.sleep(1.0)
            assert not target_kicked, "buyer succeeded to kick"

            target.disconnect(); other.disconnect(); buyer_sock.disconnect()
        finally:
            _stop(api, admin_token)


# =============================================================================
# 4) live_chat fanout to admins + uid + admin not counted as viewer
# =============================================================================
class TestChatFanoutAndUid:
    def test_live_chat_includes_uid_and_admin_receives_without_join_live(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            admin_sock = _connect(token=admin_token)  # admin: auto-joins 'admins' room, does NOT emit join_live
            guest_sender = _connect(token=None)

            admin_msgs = []

            @admin_sock.on("live_chat")
            def _am(m): admin_msgs.append(m)

            guest_sender.emit("join_live", {})
            time.sleep(0.4)

            marker = f"chat_{uuid.uuid4().hex[:5]}"
            guest_sender.emit("live_chat", {"text": marker})
            assert _wait(lambda: any(m.get("text") == marker for m in admin_msgs), timeout=4.0), \
                "admin (not in 'live' room) did not receive guest live_chat"
            m = next(m for m in admin_msgs if m.get("text") == marker)
            assert m.get("uid"), f"live_chat missing uid: {m}"
            assert m.get("role") == "guest"

            admin_sock.disconnect(); guest_sender.disconnect()
        finally:
            _stop(api, admin_token)

    def test_admin_not_counted_as_viewer(self, api, admin_token, product_ids):
        _start(api, admin_token, product_ids)
        try:
            admin_sock = _connect(token=admin_token)
            admin_viewers_events = []

            @admin_sock.on("live_viewers")
            def _v(p): admin_viewers_events.append(p)

            # Guest joins live
            guest = _connect(token=None)
            guest.emit("join_live", {})
            assert _wait(lambda: any(e.get("count", 0) >= 1 for e in admin_viewers_events), timeout=4.0), \
                f"admin did not receive live_viewers: {admin_viewers_events}"
            latest = admin_viewers_events[-1]
            # Admin should not be counted — the guest is the only viewer.
            assert latest["count"] == 1, f"expected 1 viewer (admin excluded), got {latest}"
            roles = [v.get("role") for v in latest.get("viewers", [])]
            assert "admin" not in roles, f"admin present in viewers list: {latest}"

            admin_sock.disconnect(); guest.disconnect()
        finally:
            _stop(api, admin_token)
