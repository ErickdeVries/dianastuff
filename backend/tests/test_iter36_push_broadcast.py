# iter36 — Push notification / broadcast backend tests
# Covers:
#   - POST /api/admin/broadcast (target=all / selected / validation / admin guard)
#   - GET  /api/admin/broadcast (list, newest first)
#   - GET  /api/notifications (buyer sees all + their own; not sees selected-not-them)
#   - POST /api/register-push (placeholder EMERGENT_PUSH_KEY => graceful 500 or skip)
#   - Regression: chat/send buyer + admin still succeed (push side-effect is best-effort)
# Push relay failures are EXPECTED (EMERGENT_PUSH_KEY=placeholder) and must be NON-BLOCKING.
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{API}/auth/login-whitelist",
        json={"username": "admin", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def buyer_login():
    r = requests.post(
        f"{API}/auth/login-whitelist",
        json={"username": "buyer", "password": "buyer123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return data["session_token"], data["user"]["user_id"]


@pytest.fixture(scope="session")
def buyer_token(buyer_login):
    return buyer_login[0]


@pytest.fixture(scope="session")
def buyer_user_id(buyer_login):
    return buyer_login[1]


# --------------------------------------------------------------------------- admin broadcast
class TestAdminBroadcast:
    """POST/GET /api/admin/broadcast + validations + admin guard."""

    def test_broadcast_all_success(self, admin_token):
        payload = {
            "title": "Promo A",
            "message": "Hemat besar",
            "image_url": "/api/files/b.jpg",
            "action_url": "/toko",
            "target": "all",
        }
        r = requests.post(f"{API}/admin/broadcast", json=payload, headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("id", "").startswith("ntf_")
        assert data["title"] == "Promo A"
        assert data["message"] == "Hemat besar"
        assert data["target"] == "all"
        assert data["image_url"] == "/api/files/b.jpg"
        assert data["action_url"] == "/toko"
        # recipients_count = number of approved buyers (>=1 since seeded buyer exists)
        assert isinstance(data["recipients_count"], int)
        assert data["recipients_count"] >= 1

    def test_broadcast_selected_empty_user_ids_400(self, admin_token):
        payload = {
            "title": "Promo S",
            "message": "khusus",
            "target": "selected",
            "user_ids": [],
        }
        r = requests.post(f"{API}/admin/broadcast", json=payload, headers=_h(admin_token), timeout=15)
        assert r.status_code == 400, r.text
        assert "minimal 1" in (r.json().get("detail") or "").lower()

    def test_broadcast_selected_with_buyer(self, admin_token, buyer_user_id):
        payload = {
            "title": "Promo Selected",
            "message": "Hanya untukmu",
            "target": "selected",
            "user_ids": [buyer_user_id],
        }
        r = requests.post(f"{API}/admin/broadcast", json=payload, headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["target"] == "selected"
        assert data["recipients_count"] == 1

    def test_broadcast_empty_title_400(self, admin_token):
        r = requests.post(
            f"{API}/admin/broadcast",
            json={"title": "   ", "message": "isi", "target": "all"},
            headers=_h(admin_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_broadcast_empty_message_400(self, admin_token):
        r = requests.post(
            f"{API}/admin/broadcast",
            json={"title": "judul", "message": "", "target": "all"},
            headers=_h(admin_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_list_broadcasts_newest_first(self, admin_token):
        # create a fresh "ping" broadcast to be at top
        unique_title = f"PING_{int(time.time())}"
        requests.post(
            f"{API}/admin/broadcast",
            json={"title": unique_title, "message": "ping", "target": "all"},
            headers=_h(admin_token),
            timeout=20,
        )
        r = requests.get(f"{API}/admin/broadcast", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 1
        # newest first => our ping should be at top
        assert rows[0]["title"] == unique_title
        # order check: created_at non-increasing
        times = [row.get("created_at") or "" for row in rows]
        assert times == sorted(times, reverse=True)

    # Admin-only guard
    def test_get_broadcast_without_token_401(self):
        r = requests.get(f"{API}/admin/broadcast", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_post_broadcast_without_token_401(self):
        r = requests.post(
            f"{API}/admin/broadcast",
            json={"title": "x", "message": "y", "target": "all"},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.text

    def test_get_broadcast_with_buyer_token_403(self, buyer_token):
        r = requests.get(f"{API}/admin/broadcast", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 403, r.text

    def test_post_broadcast_with_buyer_token_403(self, buyer_token):
        r = requests.post(
            f"{API}/admin/broadcast",
            json={"title": "x", "message": "y", "target": "all"},
            headers=_h(buyer_token),
            timeout=15,
        )
        assert r.status_code == 403, r.text


# --------------------------------------------------------------------------- buyer notifications
class TestBuyerNotifications:
    """GET /api/notifications visibility rules for buyers."""

    def test_buyer_sees_all_and_targeted(self, admin_token, buyer_token, buyer_user_id):
        tag = f"IT36_{int(time.time())}"
        # broadcast target=all
        r1 = requests.post(
            f"{API}/admin/broadcast",
            json={"title": f"{tag}_ALL", "message": "untuk semua", "target": "all"},
            headers=_h(admin_token),
            timeout=20,
        )
        assert r1.status_code == 200
        # broadcast target=selected to this buyer
        r2 = requests.post(
            f"{API}/admin/broadcast",
            json={
                "title": f"{tag}_ME",
                "message": "khusus kamu",
                "target": "selected",
                "user_ids": [buyer_user_id],
            },
            headers=_h(admin_token),
            timeout=20,
        )
        assert r2.status_code == 200

        r = requests.get(f"{API}/notifications", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        titles = [row["title"] for row in rows]
        assert f"{tag}_ALL" in titles
        assert f"{tag}_ME" in titles

    def test_buyer_does_not_see_selected_not_them(self, admin_token, buyer_token):
        tag = f"IT36NO_{int(time.time())}"
        # target=selected to a non-existent other user_id
        other_uid = "user_ffffffffffff"
        r = requests.post(
            f"{API}/admin/broadcast",
            json={
                "title": f"{tag}_HIDDEN",
                "message": "bukan untukmu",
                "target": "selected",
                "user_ids": [other_uid],
            },
            headers=_h(admin_token),
            timeout=20,
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/notifications", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        titles = [row["title"] for row in r.json()]
        assert f"{tag}_HIDDEN" not in titles


# --------------------------------------------------------------------------- register-push
class TestRegisterPush:
    """POST /api/register-push with placeholder EMERGENT_PUSH_KEY must be graceful (not 5xx crash)."""

    def test_register_push_graceful(self, buyer_user_id):
        r = requests.post(
            f"{API}/register-push",
            json={"user_id": buyer_user_id, "platform": "android", "device_token": "tok123"},
            timeout=20,
        )
        # Allowed outcomes with placeholder key:
        #   500 {"detail":"EMERGENT_PUSH_KEY missing or invalid"} OR
        #   201 {"status":"skipped"} / {"status":"registered"} (graceful skip)
        assert r.status_code in (201, 500), r.text
        if r.status_code == 500:
            detail = (r.json() or {}).get("detail") or ""
            assert "EMERGENT_PUSH_KEY" in detail, f"unexpected 500 detail: {detail}"
        else:
            body = r.json()
            assert body.get("status") in ("skipped", "registered")

    def test_server_still_alive_after_register_push(self, admin_token):
        """Ensure the server did not crash after register-push attempt."""
        r = requests.get(f"{API}/admin/broadcast", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- chat regression
class TestChatSendRegression:
    """Chat send must still work; push side-effect is best-effort."""

    def test_chat_send_buyer(self, buyer_token):
        r = requests.post(
            f"{API}/chat/send",
            json={"text": "halo"},
            headers=_h(buyer_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") == "halo"
        assert data.get("sender_role") == "buyer"

    def test_chat_send_admin_reply(self, admin_token, buyer_user_id):
        r = requests.post(
            f"{API}/chat/send",
            json={"room": buyer_user_id, "text": "balas"},
            headers=_h(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") == "balas"
        assert data.get("sender_role") == "admin"
        assert data.get("room") == buyer_user_id
