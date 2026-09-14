# Iter25: rekap live delete endpoint + socket admins-room delivery regression tests
# Covers: DELETE /api/admin/live-history/{id} (401/403/404/ok), full start->stop->delete flow,
# and socket-level verification that an admin socket receives live_viewers + live_chat
# emitted by a GUEST socket (backend counterpart of the guest->login socket-upgrade fix).
import os
import time
import threading

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
BASE_URL = (BASE_URL or "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_BACKEND_URL not set", allow_module_level=True)


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def _login(api_client, username, password):
    r = api_client.post(f"{BASE_URL}/api/auth/login-whitelist", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} failed: {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token(api_client):
    return _login(api_client, "admin", "admin123")


@pytest.fixture(scope="module")
def buyer_token(api_client):
    return _login(api_client, "buyer", "buyer123")


class TestRekapDeleteEndpoint:
    """DELETE /api/admin/live-history/{id} access control + full lifecycle"""

    def test_live_current_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/live/current")
        assert r.status_code == 200
        assert "live" in r.json()

    def test_delete_unauthenticated_401(self, api_client):
        r = api_client.delete(f"{BASE_URL}/api/admin/live-history/nonexistent_123")
        assert r.status_code in (401, 403)

    def test_delete_buyer_forbidden(self, api_client, buyer_token):
        r = api_client.delete(
            f"{BASE_URL}/api/admin/live-history/nonexistent_123",
            headers={"Authorization": f"Bearer {buyer_token}"},
        )
        assert r.status_code in (401, 403)

    def test_delete_nonexistent_404(self, api_client, admin_token):
        r = api_client.delete(
            f"{BASE_URL}/api/admin/live-history/nonexistent_123",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 404

    def test_full_start_stop_delete_flow(self, api_client, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        # Start a TEST live
        r = api_client.post(f"{BASE_URL}/api/live/start", headers=h, json={
            "title": "TEST_iter25_delete", "caption": "", "product_ids": [],
        })
        assert r.status_code == 200, r.text
        assert r.json()["live"] is True
        # Stop it
        r = api_client.post(f"{BASE_URL}/api/live/stop", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["live"] is False
        # Find recap in history
        r = api_client.get(f"{BASE_URL}/api/admin/live-history", headers=h)
        assert r.status_code == 200
        history = r.json()
        target = next((x for x in history if x["title"] == "TEST_iter25_delete"), None)
        assert target is not None, "recap not found in live-history after stop"
        assert set(target["recap"].keys()) >= {"peak_viewers", "total_likes", "orders_count", "orders_total"}
        # Delete it
        r = api_client.delete(f"{BASE_URL}/api/admin/live-history/{target['id']}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify gone
        r = api_client.get(f"{BASE_URL}/api/admin/live-history", headers=h)
        ids = [x["id"] for x in r.json()]
        assert target["id"] not in ids, "recap still present after delete"


class TestSocketAdminsRoomDelivery:
    """Guest joins live + chats; admin socket (token auth) must receive live_viewers + live_chat.
    Backend counterpart of the guest->login socket-upgrade fix in src/lib/socket.ts."""

    def test_guest_events_reach_admin(self, admin_token):
        socketio = pytest.importorskip("socketio")
        got = {"viewers": [], "chat": []}

        admin = socketio.Client(reconnection=False)
        admin.on("live_viewers", lambda data: got["viewers"].append(data))
        admin.on("live_chat", lambda data: got["chat"].append(data))

        try:
            admin.connect(BASE_URL, socketio_path="/api/socket.io",
                          auth={"token": admin_token}, transports=["websocket", "polling"],
                          wait_timeout=15)
        except Exception as e:
            pytest.fail(f"admin socket connect failed: {e}")

        guest = socketio.Client(reconnection=False)
        try:
            guest.connect(BASE_URL, socketio_path="/api/socket.io",
                          auth={"token": None}, transports=["websocket", "polling"],
                          wait_timeout=15)
        except Exception as e:
            admin.disconnect()
            pytest.fail(f"guest socket connect failed: {e}")

        try:
            guest.emit("join_live", {})
            time.sleep(1.5)
            guest.emit("live_chat", {"text": "TEST_iter25_socket_chat"})
            # wait for admin to receive
            deadline = time.time() + 10
            while time.time() < deadline:
                if got["viewers"] and got["chat"]:
                    break
                time.sleep(0.3)
        finally:
            guest.disconnect()
            admin.disconnect()

        assert got["viewers"], "admin socket received NO live_viewers event"
        assert any(v.get("count", 0) >= 1 for v in got["viewers"]), \
            f"live_viewers never showed count>=1: {got['viewers']}"
        chats = [c for c in got["chat"] if c.get("text") == "TEST_iter25_socket_chat"]
        assert chats, f"admin socket did not receive guest live_chat: {got['chat']}"
        assert chats[0].get("role") == "guest"
