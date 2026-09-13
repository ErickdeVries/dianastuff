"""Iteration 11 backend tests.

Coverage:
    * Auto-Selesai (auto_complete_orders):
        - Orders in 'dikirim' with `dikirim_at` older than 3 days must flip to
          'selesai' when GET /api/orders or GET /api/orders/{id} is called; the
          status_history must gain a 'selesai' entry and a socket 'order_status'
          event must be emitted to the buyer's user room.
        - Orders shipped < 3 days ago stay 'dikirim'.
        - Fallback path (no dikirim_at, but a stale 'dikirim' entry in
          status_history > 3 days old) also auto-completes.
    * Web upload regression (/api/upload + PUT /api/profil_admin + /api/files):
        multipart image upload succeeds, url is stored on profil_admin, and the
        file is served back through /api/files/....
    * Order status flow regression:
        konfirmasi_bayar -> sedang_dikemas -> dikirim(+resi, sets dikirim_at) ->
        buyer POST /terima -> selesai.
"""
from __future__ import annotations

import asyncio
import io
import os
import struct
import time
import zlib
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import socketio

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN = {"username": "admin", "password": "admin123"}
BUYER = {"username": "buyer", "password": "buyer123"}


# --------------------------------------------------------------------------- helpers
def _login(session: requests.Session, creds: dict) -> str:
    r = session.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json=creds,
        timeout=15,
    )
    assert r.status_code == 200, f"login {creds['username']} failed: {r.status_code} {r.text}"
    j = r.json()
    tok = j.get("session_token") or j.get("access_token")
    assert tok, f"no token in response: {r.text}"
    return tok


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_png_bytes() -> bytes:
    """Return a valid 1x1 red PNG (no external deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00" + bytes([255, 0, 0])  # filter byte + RGB pixel
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def api() -> requests.Session:
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(api) -> str:
    return _login(api, ADMIN)


@pytest.fixture(scope="module")
def buyer_token(api) -> str:
    return _login(api, BUYER)


@pytest.fixture(scope="module")
def buyer_user_id(admin_token, api) -> str:
    r = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(admin_token))
    # /me returns the caller — get buyer via mongo instead
    async def _get_uid():
        c = AsyncIOMotorClient(MONGO_URL)
        u = await c[DB_NAME].users.find_one({"username": "buyer"}, {"_id": 0, "user_id": 1})
        c.close()
        return u["user_id"]

    return asyncio.get_event_loop().run_until_complete(_get_uid()) if False else asyncio.run(_get_uid())


# --------------------------------------------------------------------------- mongo helper
async def _mongo():
    client = AsyncIOMotorClient(MONGO_URL)
    return client, client[DB_NAME]


def _run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- health
class TestHealth:
    def test_backend_reachable(self, api):
        r = api.get(f"{BASE_URL}/api/profil_admin", timeout=15)
        assert r.status_code == 200
        assert "nama_toko" in r.json()


# --------------------------------------------------------------------------- auto-complete
class TestAutoComplete:
    """Auto-Selesai (auto_complete_orders)."""

    # We'll snapshot & restore state so we don't corrupt fixtures for later runs.
    _mutated_ids: list[str] = []

    @classmethod
    def teardown_class(cls):
        async def restore():
            client, db = await _mongo()
            try:
                for oid in cls._mutated_ids:
                    # remove the artificial dikirim_at / re-mark status to dikirim
                    doc = await db.orders.find_one({"id": oid})
                    if not doc:
                        continue
                    # nothing else to restore — the auto-complete promotion is legitimate,
                    # but we do drop the pushed 'selesai' entry we caused so history stays clean.
                    hist = doc.get("status_history") or []
                    # keep only up to (and including) the last legitimate entry that was
                    # present before this test run. We can't perfectly know, so leave it —
                    # the append-only history growth is by-design per iteration_10 notes.
                    _ = hist
            finally:
                client.close()

        _run(restore())

    def _pick_or_make_dikirim_order(self, api, admin_token) -> tuple[str, str]:
        """Return (order_id, no_order) of an order currently in 'dikirim'.

        Falls back to promoting a 'sedang_dikemas' order via admin PUT so tests
        are idempotent across reruns.
        """
        async def find():
            client, db = await _mongo()
            try:
                # Prefer a buyer-owned order so the socket assertion has a valid room.
                doc = await db.orders.find_one({"status": "dikirim", "deleted_at": None},
                                               {"_id": 0, "id": 1, "no_order": 1, "user_id": 1})
                if doc:
                    return doc["id"], doc["no_order"]
                cand = await db.orders.find_one({"status": "sedang_dikemas", "deleted_at": None},
                                                {"_id": 0, "id": 1, "no_order": 1, "user_id": 1})
                return (cand["id"], cand["no_order"]) if cand else (None, None)
            finally:
                client.close()

        oid, no_order = _run(find())
        assert oid, "No dikirim/sedang_dikemas order available for testing"
        # Ensure status is 'dikirim' with a resi.
        r = api.put(
            f"{BASE_URL}/api/orders/{oid}/status",
            headers=_auth(admin_token),
            json={"status": "dikirim", "no_resi": f"TEST_AUTO{int(time.time())}"},
        )
        assert r.status_code == 200, r.text
        return oid, no_order

    def test_stale_dikirim_auto_completes_via_list_orders(self, api, admin_token):
        oid, _ = self._pick_or_make_dikirim_order(api, admin_token)
        self._mutated_ids.append(oid)

        # Force dikirim_at to 4 days ago in Mongo.
        four_days_ago = datetime.now(timezone.utc) - timedelta(days=4)

        async def set_stale():
            client, db = await _mongo()
            try:
                # Reset status back to dikirim & set dikirim_at old.
                await db.orders.update_one(
                    {"id": oid},
                    {"$set": {"status": "dikirim", "dikirim_at": four_days_ago}},
                )
            finally:
                client.close()

        _run(set_stale())

        # Trigger auto-complete via GET /api/orders (admin sees all).
        r = api.get(f"{BASE_URL}/api/orders", headers=_auth(admin_token))
        assert r.status_code == 200
        matches = [o for o in r.json() if o["id"] == oid]
        assert matches, "order missing from list"
        assert matches[0]["status"] == "selesai", f"expected selesai, got {matches[0]['status']}"

        # status_history must contain a selesai entry.
        hist = matches[0].get("status_history") or []
        assert any(h.get("status") == "selesai" for h in hist), "status_history missing selesai entry"

    def test_fresh_dikirim_stays_dikirim(self, api, admin_token):
        oid, _ = self._pick_or_make_dikirim_order(api, admin_token)
        self._mutated_ids.append(oid)

        # Set dikirim_at to now (fresh).
        async def set_fresh():
            client, db = await _mongo()
            try:
                await db.orders.update_one(
                    {"id": oid},
                    {"$set": {"status": "dikirim", "dikirim_at": datetime.now(timezone.utc)}},
                )
            finally:
                client.close()

        _run(set_fresh())

        r = api.get(f"{BASE_URL}/api/orders/{oid}", headers=_auth(admin_token))
        assert r.status_code == 200
        assert r.json()["status"] == "dikirim"

    def test_fallback_uses_status_history_when_no_dikirim_at(self, api, admin_token):
        oid, _ = self._pick_or_make_dikirim_order(api, admin_token)
        self._mutated_ids.append(oid)

        # Remove dikirim_at, inject an old dikirim entry into status_history.
        four_days_ago = datetime.now(timezone.utc) - timedelta(days=4)

        async def set_history():
            client, db = await _mongo()
            try:
                await db.orders.update_one(
                    {"id": oid},
                    {
                        "$set": {"status": "dikirim",
                                 "status_history": [{"status": "dikirim", "at": four_days_ago}]},
                        "$unset": {"dikirim_at": ""},
                    },
                )
            finally:
                client.close()

        _run(set_history())

        r = api.get(f"{BASE_URL}/api/orders/{oid}", headers=_auth(admin_token))
        assert r.status_code == 200
        assert r.json()["status"] == "selesai", "fallback via status_history should promote to selesai"

    def test_socket_order_status_emitted_on_auto_complete(self, api, admin_token, buyer_token, buyer_user_id):
        """When list_orders promotes a stale order, buyer's room should receive an 'order_status' event."""
        # Prefer a buyer-owned order specifically for this test.
        async def find_buyer_order():
            client, db = await _mongo()
            try:
                # Any non-deleted order owned by buyer; we promote it to dikirim below.
                doc = await db.orders.find_one(
                    {"user_id": buyer_user_id, "deleted_at": None,
                     "status": {"$in": ["sedang_dikemas", "dikirim", "menunggu_konfirmasi"]}},
                    {"_id": 0, "id": 1, "no_order": 1, "user_id": 1},
                )
                return doc
            finally:
                client.close()

        doc = _run(find_buyer_order())
        if not doc:
            pytest.skip("no buyer-owned promotable order available")
        oid = doc["id"]
        self._mutated_ids.append(oid)

        # Promote to dikirim to get a valid state.
        api.put(
            f"{BASE_URL}/api/orders/{oid}/status",
            headers=_auth(admin_token),
            json={"status": "dikirim", "no_resi": f"TEST_SOCK{int(time.time())}"},
        )

        # Prime the order to old dikirim_at.
        four_days_ago = datetime.now(timezone.utc) - timedelta(days=4)

        async def set_stale():
            client, db = await _mongo()
            try:
                await db.orders.update_one(
                    {"id": oid},
                    {"$set": {"status": "dikirim", "dikirim_at": four_days_ago}},
                )
            finally:
                client.close()

        _run(set_stale())

        events: list[dict] = []
        sio = socketio.Client(reconnection=False, logger=False, engineio_logger=False)

        @sio.on("order_status")
        def _on_status(data):  # noqa: ARG001
            events.append(data)

        sio.connect(
            BASE_URL,
            socketio_path="/api/socket.io",
            transports=["websocket"],
            auth={"token": buyer_token},
            wait_timeout=10,
        )
        try:
            # Give the buyer's connect handler a moment to join user room.
            time.sleep(0.5)
            r = api.get(f"{BASE_URL}/api/orders", headers=_auth(admin_token))
            assert r.status_code == 200
            # Wait for the event to arrive.
            deadline = time.time() + 5
            while time.time() < deadline and not any(e.get("id") == oid for e in events):
                time.sleep(0.2)
        finally:
            try:
                sio.disconnect()
            except Exception:
                pass

        match = [e for e in events if e.get("id") == oid]
        assert match, f"no order_status event for {oid} received (events={events})"
        assert match[-1].get("status") == "selesai", f"expected status=selesai, got {match[-1]}"


# --------------------------------------------------------------------------- upload regression
class TestWebUpload:
    def test_upload_and_persist_to_profil_admin(self, api, admin_token):
        # 1. Snapshot current profile so we can restore it.
        r0 = api.get(f"{BASE_URL}/api/profil_admin")
        assert r0.status_code == 200
        original = r0.json()

        # 2. Upload a fresh PNG (simulates the "web" Blob path — a bytes body
        #    with multipart Content-Disposition; server treats them identically).
        png = _make_png_bytes()
        files = {"file": ("logo_test.png", io.BytesIO(png), "image/png")}
        r = api.post(f"{BASE_URL}/api/upload", headers=_auth(admin_token), files=files)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert "url" in body and body["url"].startswith("/api/files/"), body
        new_url = body["url"]

        # 3. Fetch back via /api/files/... — must return the same bytes.
        rf = api.get(f"{BASE_URL}{new_url}")
        assert rf.status_code == 200
        assert rf.content == png, "served bytes differ from uploaded bytes"
        assert rf.headers.get("content-type", "").startswith("image/"), rf.headers

        # 4. PUT /api/profil_admin — persist the new url.
        payload = {
            "nama_toko": original.get("nama_toko") or "Diana Stuff",
            "logo_url": new_url,
            "banner_url": original.get("banner_url"),
            "whatsapp": original.get("whatsapp") or "085312812452",
            "rekening_bank": original.get("rekening_bank") or [],
        }
        rp = api.put(f"{BASE_URL}/api/profil_admin", headers=_auth(admin_token), json=payload)
        assert rp.status_code == 200, rp.text
        assert rp.json().get("logo_url") == new_url

        # 5. GET /api/profil_admin — new url must be reflected.
        r2 = api.get(f"{BASE_URL}/api/profil_admin")
        assert r2.status_code == 200
        assert r2.json().get("logo_url") == new_url

        # 6. Restore original logo_url so we don't pollute the demo store.
        restore = {
            "nama_toko": original.get("nama_toko") or "Diana Stuff",
            "logo_url": original.get("logo_url"),
            "banner_url": original.get("banner_url"),
            "whatsapp": original.get("whatsapp") or "085312812452",
            "rekening_bank": original.get("rekening_bank") or [],
        }
        rr = api.put(f"{BASE_URL}/api/profil_admin", headers=_auth(admin_token), json=restore)
        assert rr.status_code == 200

    def test_upload_requires_auth(self, api):
        png = _make_png_bytes()
        files = {"file": ("logo_test.png", io.BytesIO(png), "image/png")}
        r = api.post(f"{BASE_URL}/api/upload", files=files)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# --------------------------------------------------------------------------- status-flow regression
class TestStatusFlowRegression:
    """Only touches an order we create via admin; we drive it end-to-end."""

    def test_full_status_flow_sets_dikirim_at_and_terima_completes(self, api, admin_token, buyer_token):
        # Reuse an existing menunggu_konfirmasi order owned by buyer.
        async def find():
            client, db = await _mongo()
            try:
                doc = await db.orders.find_one(
                    {"status": "menunggu_konfirmasi", "deleted_at": None},
                    {"_id": 0, "id": 1, "user_id": 1},
                )
                return doc
            finally:
                client.close()

        doc = _run(find())
        if not doc:
            pytest.skip("no menunggu_konfirmasi order available for regression")
        oid = doc["id"]

        # menunggu_konfirmasi -> sedang_dikemas
        r = api.put(
            f"{BASE_URL}/api/orders/{oid}/status",
            headers=_auth(admin_token),
            json={"status": "sedang_dikemas"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "sedang_dikemas"

        # sedang_dikemas -> dikirim (must require resi)
        r_bad = api.put(
            f"{BASE_URL}/api/orders/{oid}/status",
            headers=_auth(admin_token),
            json={"status": "dikirim"},
        )
        assert r_bad.status_code == 400
        r_ok = api.put(
            f"{BASE_URL}/api/orders/{oid}/status",
            headers=_auth(admin_token),
            json={"status": "dikirim", "no_resi": "TEST_REG_9999"},
        )
        assert r_ok.status_code == 200
        body = r_ok.json()
        assert body["status"] == "dikirim"
        assert body.get("no_resi") == "TEST_REG_9999"
        # dikirim_at must now be set on the doc.
        async def get_dat():
            client, db = await _mongo()
            try:
                d = await db.orders.find_one({"id": oid}, {"_id": 0, "dikirim_at": 1})
                return d.get("dikirim_at") if d else None
            finally:
                client.close()

        dikirim_at = _run(get_dat())
        assert dikirim_at is not None, "PUT /status {dikirim} must set dikirim_at"

        # buyer POST /orders/{id}/terima -> selesai (only if buyer owns this order)
        # confirm ownership; otherwise use admin path
        if doc["user_id"]:
            async def owner_username():
                client, db = await _mongo()
                try:
                    u = await db.users.find_one({"user_id": doc["user_id"]}, {"_id": 0, "username": 1})
                    return u.get("username") if u else None
                finally:
                    client.close()

            uname = _run(owner_username())
            if uname == "buyer":
                r_t = api.post(
                    f"{BASE_URL}/api/orders/{oid}/terima",
                    headers=_auth(buyer_token),
                )
                assert r_t.status_code == 200, r_t.text
                assert r_t.json()["status"] == "selesai"
            else:
                pytest.skip(f"order owned by {uname}, buyer terima path not exercised")
