"""Iter28: Live guest display names, join announcements, session isolation, chat transcript.

Covers:
1. JOIN ANNOUNCEMENT — POST /api/live/presence with a NEW viewer_id while a live
   is active inserts role='system' message "<name> bergabung ke live" in feed.
   Repeated presence with the SAME viewer_id must NOT duplicate the join message.
2. LOGGED-IN BUYER join announcement uses the account name.
3. SESSION ISOLATION — messages from a previous live session must not leak into
   a new session's feed (missing-await fix on _reset_live_state).
4. TRANSCRIPT — after live/stop, GET /api/admin/live-history/{id}/chat returns
   {title, messages:[...]} including system join messages; admin auth guard works;
   DELETE /api/admin/live-history/{id} still works.

Reference: /app/backend/server.py L582-590, L650-673, L713-762, L855-884
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set for tests"

ADMIN_USER = "admin"
ADMIN_PASS = "admin123"


# ---------- fixtures ---------------------------------------------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def buyer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": "buyer", "password": "buyer123"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip("buyer demo account unavailable")
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def product_ids():
    r = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200
    prods = r.json()
    assert prods, "no products seeded — cannot run live tests"
    return [p["id"] for p in prods[:3]]


@pytest.fixture
def live_session(admin_headers, product_ids):
    """Fresh live show per test; stops it on teardown."""
    requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
    r = requests.post(
        f"{BASE_URL}/api/live/start",
        headers=admin_headers,
        json={
            "title": "TEST_iter28_guest_transcript",
            "caption": "iter28",
            "product_ids": product_ids,
            "featured_product_id": product_ids[0],
        },
        timeout=15,
    )
    assert r.status_code == 200, f"live/start failed: {r.status_code} {r.text}"
    yield r.json()
    requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)


# ---------- helpers ----------------------------------------------------------
def _presence(viewer_id: str, name: str, headers=None):
    return requests.post(
        f"{BASE_URL}/api/live/presence",
        json={"viewer_id": viewer_id, "name": name},
        headers=headers or {"Content-Type": "application/json"},
        timeout=10,
    )


def _feed(viewer_id: str, since_seq: int = 0, headers=None):
    return requests.get(
        f"{BASE_URL}/api/live/feed?since_seq={since_seq}&since_react=0&viewer_id={viewer_id}",
        headers=headers or {},
        timeout=10,
    )


def _chat(viewer_id: str, name: str, text: str, headers=None):
    return requests.post(
        f"{BASE_URL}/api/live/chat",
        json={"viewer_id": viewer_id, "name": name, "text": text},
        headers=headers or {"Content-Type": "application/json"},
        timeout=10,
    )


# ---------- 1. join announcement ---------------------------------------------
class TestJoinAnnouncement:
    def test_new_guest_join_inserts_system_message(self, live_session):
        vid = f"iter28a_{uuid.uuid4().hex[:8]}"
        r = _presence(vid, "TEST_Rina")
        assert r.status_code == 200 and r.json().get("ok") is True

        feed = _feed(vid).json()
        joins = [m for m in feed.get("messages", []) if m.get("role") == "system"]
        assert joins, "no system join message in feed after first presence"
        assert any(m["text"] == "TEST_Rina bergabung ke live" for m in joins), \
            f"join text wrong: {[m['text'] for m in joins]}"
        assert any(m.get("kind") == "join" for m in joins)

    def test_repeated_presence_same_viewer_does_not_duplicate(self, live_session):
        vid = f"iter28b_{uuid.uuid4().hex[:8]}"
        for _ in range(3):
            r = _presence(vid, "TEST_Sinta")
            assert r.status_code == 200

        feed = _feed(vid).json()
        joins = [m for m in feed.get("messages", [])
                 if m.get("role") == "system" and "TEST_Sinta bergabung" in m.get("text", "")]
        assert len(joins) == 1, f"expected exactly 1 join message, got {len(joins)}"

    def test_logged_in_buyer_join_uses_account_name(self, live_session, buyer_token):
        headers = {"Authorization": f"Bearer {buyer_token}", "Content-Type": "application/json"}
        r = _presence("iter28c_buyer", "ShouldBeIgnored", headers=headers)
        assert r.status_code == 200

        feed = _feed("iter28c_buyer", headers=headers).json()
        joins = [m for m in feed.get("messages", []) if m.get("role") == "system"]
        assert joins, "no join message for logged-in buyer"
        # name must come from the account, not the client-supplied name
        assert not any("ShouldBeIgnored" in m["text"] for m in joins), \
            "buyer join message used client-supplied name instead of account name"
        assert any("bergabung ke live" in m["text"] for m in joins)
        # role of system message stores viewer uid of the buyer (not guest_)
        assert any(not m["uid"].startswith("guest_") for m in joins)


# ---------- 2. session isolation ----------------------------------------------
class TestSessionIsolation:
    def test_previous_session_messages_do_not_leak(self, admin_headers, product_ids):
        # Session A
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        r = requests.post(
            f"{BASE_URL}/api/live/start",
            headers=admin_headers,
            json={"title": "TEST_iter28_sessionA", "product_ids": product_ids},
            timeout=15,
        )
        assert r.status_code == 200
        vid_a = f"iter28d_{uuid.uuid4().hex[:8]}"
        _presence(vid_a, "TEST_Andi")
        assert _chat(vid_a, "TEST_Andi", "TEST_iter28_sessionA_msg").json().get("ok") is True
        r = requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        assert r.status_code == 200

        # Session B
        r = requests.post(
            f"{BASE_URL}/api/live/start",
            headers=admin_headers,
            json={"title": "TEST_iter28_sessionB", "product_ids": product_ids},
            timeout=15,
        )
        assert r.status_code == 200
        vid_b = f"iter28e_{uuid.uuid4().hex[:8]}"
        _presence(vid_b, "TEST_Budi")
        feed = _feed(vid_b).json()
        texts = [m.get("text", "") for m in feed.get("messages", [])]
        assert "TEST_iter28_sessionA_msg" not in texts, \
            f"previous session message leaked into new feed: {texts}"
        # the only messages should be B's own join announcement
        assert all("TEST_Budi bergabung" in t for t in texts), f"unexpected messages: {texts}"
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)


# ---------- 3. transcript & history -------------------------------------------
class TestTranscript:
    def test_transcript_saved_with_join_and_chat_messages(self, live_session, admin_headers):
        vid = f"iter28f_{uuid.uuid4().hex[:8]}"
        _presence(vid, "TEST_Dewi")
        _chat(vid, "TEST_Dewi", "TEST_iter28_halo_kak")
        _chat(vid, "TEST_Dewi", "TEST_iter28_barangnya_ready?")

        r = requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        assert r.status_code == 200

        hist = requests.get(f"{BASE_URL}/api/admin/live-history", headers=admin_headers, timeout=15)
        assert hist.status_code == 200
        items = hist.json()
        target = next((i for i in items if i["title"] == "TEST_iter28_guest_transcript"), None)
        assert target, "stopped live not found in history"

        r = requests.get(
            f"{BASE_URL}/api/admin/live-history/{target['id']}/chat",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("title") == "TEST_iter28_guest_transcript"
        msgs = data.get("messages") or []
        texts = [m.get("text", "") for m in msgs]
        roles = [m.get("role") for m in msgs]
        assert any(t == "TEST_Dewi bergabung ke live" and ro == "system"
                   for t, ro in zip(texts, roles)), f"join message missing from transcript: {texts}"
        assert "TEST_iter28_halo_kak" in texts
        assert "TEST_iter28_barangnya_ready?" in texts
        assert all("_id" not in m for m in msgs), "mongodb _id leaked into transcript"

    def test_transcript_requires_admin_auth(self, live_session):
        r = requests.get(f"{BASE_URL}/api/admin/live-history/whatever/chat", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_transcript_unknown_show_404(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/live-history/live_nonexistent/chat",
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 404

    def test_delete_recap_still_works(self, live_session, admin_headers):
        vid = f"iter28g_{uuid.uuid4().hex[:8]}"
        _presence(vid, "TEST_Eka")
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)

        hist = requests.get(f"{BASE_URL}/api/admin/live-history", headers=admin_headers, timeout=15).json()
        target = next(i for i in hist if i["title"] == "TEST_iter28_guest_transcript")
        r = requests.delete(
            f"{BASE_URL}/api/admin/live-history/{target['id']}",
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200 and r.json().get("ok") is True
        r2 = requests.get(
            f"{BASE_URL}/api/admin/live-history/{target['id']}/chat",
            headers=admin_headers,
            timeout=10,
        )
        assert r2.status_code == 404, "deleted recap transcript should 404"


# ---------- cleanup -----------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_recaps(admin_token):
    yield
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        requests.post(f"{BASE_URL}/api/live/stop", headers=headers, timeout=10)
        hist = requests.get(f"{BASE_URL}/api/admin/live-history", headers=headers, timeout=15).json()
        test_recs = [i for i in hist if str(i.get("title", "")).startswith("TEST_iter28")]
        # delete all test recaps EXCEPT one kept so the user can see the feature
        for i in test_recs[1:]:
            requests.delete(f"{BASE_URL}/api/admin/live-history/{i['id']}", headers=headers, timeout=10)
        print(f"\ncleanup: deleted {max(len(test_recs)-1, 0)} recaps, kept {min(len(test_recs), 1)}")
    except Exception as e:
        print(f"\ncleanup failed (non-fatal): {e}")
