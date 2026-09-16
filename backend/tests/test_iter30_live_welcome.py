"""Iteration 30 backend tests — auto welcome greeting + live_welcome profile field.

Coverage:
- GET /api/profil_admin returns 'live_welcome' (default present).
- PUT /api/profil_admin (admin) updates live_welcome; persists on reload.
- PUT /api/profil_admin still requires whatsapp (400 if empty).
- POST /api/live/presence for a NEW viewer_id triggers TWO messages in /api/live/feed:
    * role=system, kind=join, text '<name> bergabung ke live'
    * role=admin, kind=welcome, name=<store name>, text=template with {nama} + {toko} substituted.
- Repeated presence for the SAME viewer_id must NOT add another welcome (first-join dedup).
- Custom template via PUT is used for substitution.
- Anti-spoof regression: buyer cannot override 'name' on /live/chat or /live/presence.

Cleanup: restore default template, stop live, delete test recap.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

DEFAULT_TEMPLATE = "Halo {nama}, selamat datang di live {toko}! 🎉 Selamat belanja ya 😍"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": username, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _get_profil() -> dict:
    r = requests.get(f"{BASE_URL}/api/profil_admin", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_profil(admin_tok: str, body: dict) -> requests.Response:
    return requests.put(f"{BASE_URL}/api/profil_admin", json=body, headers=_hdr(admin_tok), timeout=15)


def _feed_messages(viewer_id: str = "probe") -> list:
    r = requests.get(f"{BASE_URL}/api/live/feed", params={"since_seq": 0, "viewer_id": viewer_id}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("messages") or []


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_tok() -> str:
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def buyer_tok() -> str:
    return _login("buyer", "buyer123")


@pytest.fixture(scope="module")
def original_profil(admin_tok) -> dict:
    """Snapshot the profile so we can restore it later."""
    return _get_profil()


@pytest.fixture(scope="module")
def live_show_id(admin_tok, original_profil):
    """Start a fresh live show for this test module; stop + delete recap on teardown."""
    r = requests.post(
        f"{BASE_URL}/api/live/start",
        json={
            "title": "TEST_iter30_welcome",
            "caption": "",
            "product_ids": [],
            "show_cart": False,
            "require_login": False,
            "featured_product_id": None,
        },
        headers=_hdr(admin_tok),
        timeout=15,
    )
    assert r.status_code == 200, f"live/start failed: {r.text}"
    yield r.json()

    # --- teardown: stop + delete recap + restore profile ---
    try:
        stop = requests.post(f"{BASE_URL}/api/live/stop", headers=_hdr(admin_tok), timeout=15)
        assert stop.status_code == 200
    except Exception as e:
        print(f"[teardown] live/stop failed: {e}")

    try:
        hist = requests.get(f"{BASE_URL}/api/admin/live-history", headers=_hdr(admin_tok), timeout=15).json()
        for it in hist:
            if it.get("title", "").startswith("TEST_iter30"):
                requests.delete(
                    f"{BASE_URL}/api/admin/live-history/{it['id']}",
                    headers=_hdr(admin_tok),
                    timeout=15,
                )
    except Exception as e:
        print(f"[teardown] recap delete failed: {e}")

    # Restore original profile (default template)
    try:
        body = {
            "nama_toko": original_profil.get("nama_toko") or "Diana Stuff",
            "logo_url": original_profil.get("logo_url"),
            "banner_url": original_profil.get("banner_url"),
            "whatsapp": original_profil.get("whatsapp") or "085312812452",
            "rekening_bank": original_profil.get("rekening_bank") or [],
            "live_welcome": original_profil.get("live_welcome") or DEFAULT_TEMPLATE,
        }
        r = _put_profil(admin_tok, body)
        assert r.status_code == 200, r.text
    except Exception as e:
        print(f"[teardown] profil restore failed: {e}")


# ---------------------------------------------------------------------------
# 1. profil_admin.live_welcome
# ---------------------------------------------------------------------------
class TestProfilAdminLiveWelcome:
    def test_get_returns_live_welcome(self):
        p = _get_profil()
        assert "live_welcome" in p, "profil_admin missing 'live_welcome' key"
        assert isinstance(p["live_welcome"], str)
        assert p["live_welcome"].strip() != ""

    def test_put_updates_live_welcome_and_persists(self, admin_tok, original_profil):
        custom = "Hai {nama}, welcome ke live {toko}! -TEST-"
        body = {
            "nama_toko": original_profil.get("nama_toko") or "Diana Stuff",
            "logo_url": original_profil.get("logo_url"),
            "banner_url": original_profil.get("banner_url"),
            "whatsapp": original_profil.get("whatsapp") or "085312812452",
            "rekening_bank": original_profil.get("rekening_bank") or [],
            "live_welcome": custom,
        }
        r = _put_profil(admin_tok, body)
        assert r.status_code == 200, r.text
        assert r.json().get("live_welcome") == custom

        # Reload -> still there
        again = _get_profil()
        assert again["live_welcome"] == custom

    def test_put_requires_whatsapp(self, admin_tok, original_profil):
        body = {
            "nama_toko": original_profil.get("nama_toko") or "Diana Stuff",
            "whatsapp": "",
            "rekening_bank": [],
            "live_welcome": "anything",
        }
        r = _put_profil(admin_tok, body)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "WA" in r.text or "whatsapp" in r.text.lower()

    def test_put_unauth_forbidden(self):
        r = requests.put(
            f"{BASE_URL}/api/profil_admin",
            json={"nama_toko": "x", "whatsapp": "081", "rekening_bank": [], "live_welcome": "Halo"},
            timeout=15,
        )
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 2. Auto welcome greeting on first join
# ---------------------------------------------------------------------------
class TestAutoWelcomeGreeting:
    def _set_template(self, admin_tok, original_profil, template: str):
        body = {
            "nama_toko": original_profil.get("nama_toko") or "Diana Stuff",
            "logo_url": original_profil.get("logo_url"),
            "banner_url": original_profil.get("banner_url"),
            "whatsapp": original_profil.get("whatsapp") or "085312812452",
            "rekening_bank": original_profil.get("rekening_bank") or [],
            "live_welcome": template,
        }
        r = _put_profil(admin_tok, body)
        assert r.status_code == 200, r.text

    def test_first_join_emits_join_and_welcome_with_default(
        self, admin_tok, original_profil, live_show_id
    ):
        # Reset to default template first
        self._set_template(admin_tok, original_profil, DEFAULT_TEMPLATE)
        toko = _get_profil()["nama_toko"]

        viewer_id = f"TESTvw_{uuid.uuid4().hex[:8]}"
        viewer_name = "Sinta"

        # Send presence as guest (no auth)
        r = requests.post(
            f"{BASE_URL}/api/live/presence",
            json={"viewer_id": viewer_id, "name": viewer_name},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        time.sleep(0.3)

        msgs = _feed_messages(viewer_id=viewer_id)
        my_uid = f"guest_{viewer_id}"
        my_msgs = [m for m in msgs if m.get("uid") == my_uid or (m.get("role") == "admin" and m.get("kind") == "welcome" and viewer_name in (m.get("text") or ""))]
        assert my_msgs, f"no messages found for viewer {viewer_id}: {msgs[-6:]}"

        join = next((m for m in msgs if m.get("uid") == my_uid and m.get("role") == "system" and m.get("kind") == "join"), None)
        welcome = next((m for m in msgs if m.get("role") == "admin" and m.get("kind") == "welcome" and viewer_name in (m.get("text") or "")), None)

        assert join is not None, f"missing system join message. Recent: {msgs[-6:]}"
        assert viewer_name in (join.get("text") or "")
        assert "bergabung" in (join.get("text") or "").lower()

        assert welcome is not None, f"missing admin welcome message. Recent: {msgs[-6:]}"
        assert welcome.get("name") == toko, f"welcome.name should be store name '{toko}', got '{welcome.get('name')}'"
        expected = DEFAULT_TEMPLATE.replace("{nama}", viewer_name).replace("{toko}", toko)
        assert welcome.get("text") == expected, f"substitution mismatch. Got: '{welcome.get('text')}' Expected: '{expected}'"

    def test_repeated_presence_does_not_duplicate_welcome(
        self, admin_tok, original_profil, live_show_id
    ):
        self._set_template(admin_tok, original_profil, DEFAULT_TEMPLATE)
        viewer_id = f"TESTvw_{uuid.uuid4().hex[:8]}"
        viewer_name = "Rina"

        # First join
        r1 = requests.post(
            f"{BASE_URL}/api/live/presence",
            json={"viewer_id": viewer_id, "name": viewer_name},
            timeout=15,
        )
        assert r1.status_code == 200
        time.sleep(0.3)

        msgs1 = _feed_messages(viewer_id=viewer_id)
        my_uid = f"guest_{viewer_id}"
        welcomes1 = [m for m in msgs1 if m.get("kind") == "welcome" and viewer_name in (m.get("text") or "")]
        joins1 = [m for m in msgs1 if m.get("uid") == my_uid and m.get("kind") == "join"]
        assert len(welcomes1) == 1
        assert len(joins1) == 1

        # Second presence with SAME viewer_id
        r2 = requests.post(
            f"{BASE_URL}/api/live/presence",
            json={"viewer_id": viewer_id, "name": viewer_name},
            timeout=15,
        )
        assert r2.status_code == 200
        time.sleep(0.3)

        msgs2 = _feed_messages(viewer_id=viewer_id)
        welcomes2 = [m for m in msgs2 if m.get("kind") == "welcome" and viewer_name in (m.get("text") or "")]
        joins2 = [m for m in msgs2 if m.get("uid") == my_uid and m.get("kind") == "join"]
        assert len(welcomes2) == 1, f"welcome duplicated: {welcomes2}"
        assert len(joins2) == 1, f"join duplicated: {joins2}"

    def test_custom_template_substitution(self, admin_tok, original_profil, live_show_id):
        custom = "Selamat datang {nama} di {toko} ✨ (CUSTOM)"
        self._set_template(admin_tok, original_profil, custom)
        toko = _get_profil()["nama_toko"]

        viewer_id = f"TESTvw_{uuid.uuid4().hex[:8]}"
        viewer_name = "Budi"

        r = requests.post(
            f"{BASE_URL}/api/live/presence",
            json={"viewer_id": viewer_id, "name": viewer_name},
            timeout=15,
        )
        assert r.status_code == 200
        time.sleep(0.3)

        msgs = _feed_messages(viewer_id=viewer_id)
        welcome = next((m for m in msgs if m.get("kind") == "welcome" and viewer_name in (m.get("text") or "")), None)
        assert welcome is not None, f"no welcome found. Recent: {msgs[-6:]}"
        expected = custom.replace("{nama}", viewer_name).replace("{toko}", toko)
        assert welcome.get("text") == expected
        assert welcome.get("role") == "admin"
        assert welcome.get("name") == toko


# ---------------------------------------------------------------------------
# 3. Anti-spoof regression
# ---------------------------------------------------------------------------
class TestAntiSpoofRegression:
    def test_buyer_presence_cannot_spoof_name(self, buyer_tok, live_show_id):
        # Authenticated buyer sends a fake 'name' on /live/presence.
        # The system message should use the buyer's real account name.
        viewer_id = f"TESTauth_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/live/presence",
            json={"viewer_id": viewer_id, "name": "HackerName"},
            headers={"Authorization": f"Bearer {buyer_tok}"},
            timeout=15,
        )
        assert r.status_code == 200
        time.sleep(0.3)

        msgs = _feed_messages(viewer_id=viewer_id)
        # Look for any 'HackerName' message
        spoofed = [m for m in msgs if "HackerName" in (m.get("text") or "") or m.get("name") == "HackerName"]
        assert not spoofed, f"anti-spoof failed, found: {spoofed}"

    def test_buyer_chat_cannot_spoof_name(self, buyer_tok, live_show_id):
        marker = f"TESTmsg_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"name": "Impersonator", "text": marker},
            headers={"Authorization": f"Bearer {buyer_tok}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        msg = r.json().get("message") or {}
        assert msg.get("name") != "Impersonator", f"spoof allowed: {msg}"
