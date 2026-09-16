"""Iter27: Live-shopping REST polling migration end-to-end tests.

Covers the MongoDB-backed multi-worker-safe live realtime endpoints:
- start / stop / current / history / delete history
- feed (cursor incrementality for messages & reactions)
- chat (guest, muted -> ok:false, kicked -> 403)
- react (increments total_likes)
- presence (heartbeat upsert, viewer dedup, stale drop)
- pin / unpin
- mute / unmute
- kick (feed.kicked=true for the kicked viewer)

Reference: /app/backend/server.py live REST endpoints ~L640-963
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to the same env key used by tests in earlier iterations
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
def product_ids():
    r = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200
    prods = r.json()
    assert prods, "no products seeded — cannot run live tests"
    return [p["id"] for p in prods[:3]]


@pytest.fixture
def live_session(admin_headers, product_ids):
    """Start a fresh live show for each test and stop it at teardown."""
    # ensure any leftover live is stopped first (fresh state -> seq resets)
    requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
    r = requests.post(
        f"{BASE_URL}/api/live/start",
        headers=admin_headers,
        json={
            "title": "TEST_iter27_live_rest",
            "caption": "iter27",
            "product_ids": product_ids,
            "featured_product_id": product_ids[0],
        },
        timeout=15,
    )
    assert r.status_code == 200, f"live/start failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("live") is True
    yield body
    # teardown
    requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)


# ---------- 1. current / start / stop ---------------------------------------
class TestLiveLifecycle:
    def test_current_returns_live_after_start(self, live_session):
        r = requests.get(f"{BASE_URL}/api/live/current", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("live") is True
        assert data.get("title") == "TEST_iter27_live_rest"
        assert isinstance(data.get("products"), list) and data["products"]
        assert data.get("featured") is not None
        assert data["featured"]["id"] == live_session["featured"]["id"]

    def test_stop_then_current_returns_live_false(self, admin_headers, product_ids):
        # start a throwaway live and stop it, verifying recap is built
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        r = requests.post(
            f"{BASE_URL}/api/live/start",
            headers=admin_headers,
            json={"title": "TEST_iter27_throwaway", "product_ids": product_ids[:1]},
            timeout=10,
        )
        assert r.status_code == 200
        # send a like so recap.total_likes > 0
        vid = f"v_test_{uuid.uuid4().hex[:8]}"
        requests.post(f"{BASE_URL}/api/live/react", json={"viewer_id": vid, "emoji": "❤️"}, timeout=10)
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid, "name": "T"}, timeout=10)
        # feed once to trigger peak_viewers update
        requests.get(f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}", timeout=10)

        s = requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        assert s.status_code == 200
        assert s.json().get("live") is False

        c = requests.get(f"{BASE_URL}/api/live/current", timeout=10)
        assert c.status_code == 200
        assert c.json() == {"live": False}

        # recap available in history
        h = requests.get(f"{BASE_URL}/api/admin/live-history", headers=admin_headers, timeout=10)
        assert h.status_code == 200
        hist = h.json()
        latest = next((x for x in hist if x.get("title") == "TEST_iter27_throwaway"), None)
        assert latest is not None, "throwaway recap not found in history"
        recap = latest["recap"]
        assert recap["total_likes"] >= 1
        assert recap["peak_viewers"] >= 1

        # delete recap
        d = requests.delete(
            f"{BASE_URL}/api/admin/live-history/{latest['id']}",
            headers=admin_headers,
            timeout=10,
        )
        assert d.status_code == 200
        assert d.json().get("ok") is True

    def test_start_requires_admin(self, product_ids):
        r = requests.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "TEST_unauth", "product_ids": product_ids[:1]},
            timeout=10,
        )
        assert r.status_code in (401, 403)


# ---------- 2. cursor incrementality (feed) ----------------------------------
class TestFeedCursor:
    def test_messages_and_reactions_are_not_reissued_with_cursor(self, live_session):
        vid = f"v_test_{uuid.uuid4().hex[:8]}"
        # register presence so we appear in viewers
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid, "name": "Cursor"}, timeout=10)

        # send 3 chats
        sent_ids = []
        for i in range(3):
            r = requests.post(
                f"{BASE_URL}/api/live/chat",
                json={"viewer_id": vid, "name": f"Cursor{i}", "text": f"TEST_iter27_msg_{i}"},
                timeout=10,
            )
            assert r.status_code == 200
            body = r.json()
            assert body.get("ok") is True
            sent_ids.append(body["message"]["id"])

        # send 2 reactions
        for _ in range(2):
            r = requests.post(f"{BASE_URL}/api/live/react", json={"viewer_id": vid, "emoji": "🔥"}, timeout=10)
            assert r.status_code == 200 and r.json().get("ok") is True

        # first feed pull
        r = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        assert r.status_code == 200
        feed = r.json()
        assert feed.get("live") is True
        msg_ids_first = [m["id"] for m in feed["messages"]]
        for sid in sent_ids:
            assert sid in msg_ids_first, f"missing chat id {sid} in first feed"
        assert len(feed["reactions"]) >= 2
        last_seq = feed["last_seq"]
        last_react = feed["last_react"]
        assert last_seq >= max(m["seq"] for m in feed["messages"])
        assert last_react >= max(r_["seq"] for r_ in feed["reactions"])

        # second feed pull with cursor: MUST NOT re-return the already-seen items
        r2 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq={last_seq}&since_react={last_react}&viewer_id={vid}",
            timeout=10,
        )
        assert r2.status_code == 200
        feed2 = r2.json()
        # our specific message ids must NOT reappear
        for sid in sent_ids:
            assert sid not in [m["id"] for m in feed2["messages"]], "cursor did not exclude seen messages"
        # since_react cursor semantics: no reaction with seq <= last_react re-returned
        for rx in feed2["reactions"]:
            assert rx["seq"] > last_react, "cursor did not exclude seen reactions"
        # last_seq / last_react should not go backwards
        assert feed2["last_seq"] >= last_seq
        assert feed2["last_react"] >= last_react

        # send one more message and verify only that one comes back
        r3 = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "text": "TEST_iter27_delta"},
            timeout=10,
        )
        delta_id = r3.json()["message"]["id"]
        r4 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq={last_seq}&since_react={last_react}&viewer_id={vid}",
            timeout=10,
        )
        feed4 = r4.json()
        got_ids = [m["id"] for m in feed4["messages"]]
        assert delta_id in got_ids
        for sid in sent_ids:
            assert sid not in got_ids


# ---------- 3. viewer count dedup / stale drop -------------------------------
class TestViewerCount:
    def test_same_viewer_id_counts_as_one_and_distinct_ids_increase(self, live_session):
        vid_a = f"v_a_{uuid.uuid4().hex[:8]}"
        vid_b = f"v_b_{uuid.uuid4().hex[:8]}"
        # Multiple heartbeats for A
        for _ in range(3):
            requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid_a, "name": "A"}, timeout=10)
        r = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid_a}",
            timeout=10,
        )
        base_count = r.json()["viewers_count"]
        assert base_count >= 1
        # count of guest_A specifically
        uids_before = {v["uid"] for v in r.json()["viewers"]}
        assert f"guest_{vid_a}" in uids_before

        # A heartbeat repeated does not double count
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid_a}, timeout=10)
        r2 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid_a}",
            timeout=10,
        )
        assert r2.json()["viewers_count"] == base_count

        # Distinct viewer B increases count by 1
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid_b, "name": "B"}, timeout=10)
        r3 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid_a}",
            timeout=10,
        )
        uids_after = {v["uid"] for v in r3.json()["viewers"]}
        assert f"guest_{vid_b}" in uids_after
        assert r3.json()["viewers_count"] >= base_count + 1

    def test_stale_presence_dropped_after_12s(self, live_session):
        vid = f"v_stale_{uuid.uuid4().hex[:8]}"
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid, "name": "Stale"}, timeout=10)
        r = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        uids = {v["uid"] for v in r.json()["viewers"]}
        assert f"guest_{vid}" in uids
        # wait past 12s cutoff (feed uses last_seen >= now-12s)
        time.sleep(13)
        r2 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id=other_probe",
            timeout=10,
        )
        uids2 = {v["uid"] for v in r2.json()["viewers"]}
        assert f"guest_{vid}" not in uids2, "stale presence still counted after 12s"


# ---------- 4. moderation: mute / unmute / kick ------------------------------
class TestModeration:
    def test_mute_blocks_chat_then_unmute_restores(self, live_session, admin_headers):
        vid = f"v_mute_{uuid.uuid4().hex[:8]}"
        uid = f"guest_{vid}"
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid, "name": "M"}, timeout=10)
        # baseline: chat works
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "text": "TEST_iter27_before_mute"},
            timeout=10,
        )
        assert r.status_code == 200 and r.json().get("ok") is True

        # admin mutes uid
        m = requests.post(
            f"{BASE_URL}/api/live/mute",
            headers=admin_headers,
            json={"uid": uid, "mute": True},
            timeout=10,
        )
        assert m.status_code == 200 and m.json().get("muted") is True

        # muted chat returns ok:false, muted:true (not raise)
        r2 = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "text": "TEST_iter27_while_muted"},
            timeout=10,
        )
        assert r2.status_code == 200
        body = r2.json()
        assert body.get("ok") is False and body.get("muted") is True

        # feed reflects muted flag for that viewer
        f = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        assert f.json().get("muted") is True

        # unmute
        um = requests.post(
            f"{BASE_URL}/api/live/mute",
            headers=admin_headers,
            json={"uid": uid, "mute": False},
            timeout=10,
        )
        assert um.status_code == 200 and um.json().get("muted") is False

        r3 = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "text": "TEST_iter27_after_unmute"},
            timeout=10,
        )
        assert r3.status_code == 200 and r3.json().get("ok") is True

    def test_kick_returns_403_and_feed_kicked_true(self, live_session, admin_headers):
        vid = f"v_kick_{uuid.uuid4().hex[:8]}"
        uid = f"guest_{vid}"
        requests.post(f"{BASE_URL}/api/live/presence", json={"viewer_id": vid, "name": "K"}, timeout=10)
        # kick
        k = requests.post(
            f"{BASE_URL}/api/live/kick",
            headers=admin_headers,
            json={"uid": uid},
            timeout=10,
        )
        assert k.status_code == 200 and k.json().get("ok") is True

        # kicked chat -> 403
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "text": "TEST_iter27_kicked"},
            timeout=10,
        )
        assert r.status_code == 403

        # feed.kicked true for this viewer
        f = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        assert f.json().get("kicked") is True


# ---------- 5. pin / unpin ---------------------------------------------------
class TestPin:
    def test_pin_then_unpin(self, live_session, admin_headers):
        p = requests.post(
            f"{BASE_URL}/api/live/pin",
            headers=admin_headers,
            json={"message": {"id": "m1", "name": "Admin", "role": "admin", "text": "TEST_iter27_pinned"}},
            timeout=10,
        )
        assert p.status_code == 200
        assert p.json()["pinned"]["text"] == "TEST_iter27_pinned"

        f = requests.get(f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id=probe", timeout=10)
        pinned = f.json().get("pinned")
        assert pinned and pinned.get("text") == "TEST_iter27_pinned"

        u = requests.post(f"{BASE_URL}/api/live/unpin", headers=admin_headers, timeout=10)
        assert u.status_code == 200
        assert u.json()["pinned"] is None

        f2 = requests.get(f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id=probe", timeout=10)
        assert f2.json().get("pinned") in (None, {})


# ---------- 6. react increments total_likes ---------------------------------
class TestReactions:
    def test_react_increments_total_likes(self, live_session):
        vid = f"v_like_{uuid.uuid4().hex[:8]}"
        r0 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        base = r0.json()["total_likes"]
        for _ in range(4):
            rr = requests.post(f"{BASE_URL}/api/live/react", json={"viewer_id": vid, "emoji": "👍"}, timeout=10)
            assert rr.status_code == 200 and rr.json().get("ok") is True
        r1 = requests.get(
            f"{BASE_URL}/api/live/feed?since_seq=0&since_react=0&viewer_id={vid}",
            timeout=10,
        )
        assert r1.json()["total_likes"] >= base + 4


# ---------- 7. regression: /live/current when no live -----------------------
class TestRegression:
    def test_products_endpoint_public(self):
        r = requests.get(f"{BASE_URL}/api/products", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_current_returns_false_when_nothing_live(self, admin_headers):
        # ensure stopped
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        r = requests.get(f"{BASE_URL}/api/live/current", timeout=10)
        assert r.status_code == 200
        assert r.json() == {"live": False}

    def test_chat_when_no_live_returns_400(self, admin_headers):
        # ensure stopped
        requests.post(f"{BASE_URL}/api/live/stop", headers=admin_headers, timeout=10)
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": "v_probe", "text": "hello"},
            timeout=10,
        )
        assert r.status_code == 400
