# Realtime in-app notification layer tests (iteration 7)
# Covers:
#   - POST /api/orders emits 'new_order' to the 'admins' socket room (and NOT to buyers)
#   - PUT /api/orders/<id>/status emits 'order_status' {id,no_order,status,no_resi} to the buyer's room
#     (including resi-only updates on an already-dikirim order)
#   - GET /api/admin/stats returns perlu_konfirmasi (count of menunggu_konfirmasi orders)
#   - Regression: buyer chat message reaches admin via socket; admin reply reaches buyer;
#     unread badge increments and /api/chat/read clears it.
# Run serially: pytest /app/backend/tests/test_notifications_realtime.py -n 0
import asyncio
import os

import pytest
import requests
import socketio

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def buyer_token():
    r = requests.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def product(admin_token):
    r = requests.post(f"{API}/products", json={
        "kategori": "TEST", "nama_produk": "TEST_Notif", "harga": 15000,
        "stok": 100, "bisa_po": False, "foto_urls": [],
    }, headers=_h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def buyer_ready(buyer_token):
    r = requests.put(f"{API}/me", json={
        "alamat": "Jl TEST Mawar No 1", "kota": "Bandung", "kode_pos": "40123", "wa": "081234567890",
    }, headers=_h(buyer_token), timeout=15)
    assert r.status_code == 200, r.text
    return buyer_token


def _mk_order(buyer_token, product):
    r = requests.post(f"{API}/orders", json={
        "items": [{"product_id": product["id"], "qty": 1}], "kurir": "JNE", "ongkir": 10000,
    }, headers=_h(buyer_token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


async def _connect(token):
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    await client.connect(
        BASE_URL,
        socketio_path="api/socket.io",
        auth={"token": token},
        transports=["websocket", "polling"],
        wait_timeout=15,
    )
    return client


async def _wait_event(client, event, predicate=None, timeout=8):
    """Wait for a socket event matching predicate. Returns payload or None on timeout."""
    loop = asyncio.get_event_loop()
    fut = loop.create_future()

    def handler(payload):
        if predicate is None or predicate(payload):
            if not fut.done():
                fut.set_result(payload)

    client.on(event, handler)
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return None


# ===========================================================================
# A) new_order -> admins room
# ===========================================================================
class TestNewOrderNotification:
    def test_new_order_event_reaches_admin(self, admin_token, buyer_ready, product):
        async def run():
            admin = await _connect(admin_token)
            try:
                waiter = asyncio.ensure_future(_wait_event(admin, "new_order", timeout=10))
                await asyncio.sleep(0.5)  # ensure handler registered before trigger
                order = _mk_order(buyer_ready, product)
                evt = await waiter
                assert evt is not None, "admin socket did not receive 'new_order' within 10s"
                assert evt.get("id") == order["id"], f"wrong order id: {evt}"
                assert evt.get("no_order") == order["no_order"], f"wrong no_order: {evt}"
                assert evt.get("status") == "menunggu_pembayaran", evt
            finally:
                await admin.disconnect()
        asyncio.run(run())

    def test_new_order_not_leaked_to_buyer(self, buyer_ready, product):
        """new_order is emitted only to the 'admins' room — buyer must not get it."""
        async def run():
            buyer = await _connect(buyer_ready)
            try:
                waiter = asyncio.ensure_future(_wait_event(buyer, "new_order", timeout=4))
                await asyncio.sleep(0.5)
                _mk_order(buyer_ready, product)
                evt = await waiter
                assert evt is None, f"buyer unexpectedly received new_order: {evt}"
            finally:
                await buyer.disconnect()
        asyncio.run(run())


# ===========================================================================
# B) order_status -> buyer room
# ===========================================================================
class TestOrderStatusNotification:
    def test_status_change_emits_to_buyer_room(self, admin_token, buyer_ready, product):
        order = _mk_order(buyer_ready, product)

        async def run():
            buyer = await _connect(buyer_ready)
            try:
                waiter = asyncio.ensure_future(
                    _wait_event(buyer, "order_status", lambda p: p.get("id") == order["id"], timeout=10))
                await asyncio.sleep(0.5)
                r = requests.put(f"{API}/orders/{order['id']}/status",
                                 json={"status": "sedang_dikemas"}, headers=_h(admin_token), timeout=15)
                assert r.status_code == 200, r.text
                evt = await waiter
                assert evt is not None, "buyer did not receive 'order_status' within 10s"
                assert evt.get("no_order") == order["no_order"], evt
                assert evt.get("status") == "sedang_dikemas", evt
                assert "no_resi" in evt, f"payload missing no_resi key: {evt}"
            finally:
                await buyer.disconnect()
        asyncio.run(run())

    def test_dikirim_and_resi_only_update_emit(self, admin_token, buyer_ready, product):
        order = _mk_order(buyer_ready, product)

        async def run():
            buyer = await _connect(buyer_ready)
            try:
                # 1) move to dikirim with resi
                waiter = asyncio.ensure_future(
                    _wait_event(buyer, "order_status", lambda p: p.get("id") == order["id"], timeout=10))
                await asyncio.sleep(0.5)
                r = requests.put(f"{API}/orders/{order['id']}/status",
                                 json={"status": "dikirim", "no_resi": "TEST-RESI-1"},
                                 headers=_h(admin_token), timeout=15)
                assert r.status_code == 200, r.text
                evt = await waiter
                assert evt is not None, "no order_status for dikirim transition"
                assert evt.get("status") == "dikirim" and evt.get("no_resi") == "TEST-RESI-1", evt

                # 2) resi-only update on already-dikirim order still notifies buyer
                waiter2 = asyncio.ensure_future(
                    _wait_event(buyer, "order_status", lambda p: p.get("id") == order["id"], timeout=10))
                await asyncio.sleep(0.5)
                r2 = requests.put(f"{API}/orders/{order['id']}/status",
                                  json={"status": "dikirim", "no_resi": "TEST-RESI-2"},
                                  headers=_h(admin_token), timeout=15)
                assert r2.status_code == 200, r2.text
                evt2 = await waiter2
                assert evt2 is not None, "no order_status for resi-only update"
                assert evt2.get("no_resi") == "TEST-RESI-2", evt2
            finally:
                await buyer.disconnect()
        asyncio.run(run())

    def test_order_status_not_sent_to_admin_room_only_buyer(self, admin_token, buyer_ready, product):
        """Sanity: another admin connection should NOT receive the buyer-targeted order_status."""
        order = _mk_order(buyer_ready, product)

        async def run():
            admin = await _connect(admin_token)
            try:
                waiter = asyncio.ensure_future(_wait_event(admin, "order_status", timeout=4))
                await asyncio.sleep(0.5)
                requests.put(f"{API}/orders/{order['id']}/status",
                             json={"status": "dibatalkan"}, headers=_h(admin_token), timeout=15)
                evt = await waiter
                assert evt is None, f"admin socket unexpectedly received order_status: {evt}"
            finally:
                await admin.disconnect()
        asyncio.run(run())


# ===========================================================================
# C) admin stats: perlu_konfirmasi
# ===========================================================================
class TestAdminStatsPerluKonfirmasi:
    def test_stats_contains_perlu_konfirmasi_and_counts(self, admin_token, buyer_ready, product):
        r0 = requests.get(f"{API}/admin/stats", headers=_h(admin_token), timeout=15)
        assert r0.status_code == 200, r0.text
        base = r0.json()
        assert "perlu_konfirmasi" in base, f"missing key: {base.keys()}"
        assert isinstance(base["perlu_konfirmasi"], int)

        order = _mk_order(buyer_ready, product)
        # menunggu_pembayaran must NOT count
        r1 = requests.get(f"{API}/admin/stats", headers=_h(admin_token), timeout=15)
        assert r1.json()["perlu_konfirmasi"] == base["perlu_konfirmasi"], \
            "menunggu_pembayaran order wrongly counted as perlu_konfirmasi"

        rb = requests.post(f"{API}/orders/{order['id']}/bukti",
                           json={"bukti_bayar_url": "/api/files/TEST_bukti.jpg"},
                           headers=_h(buyer_ready), timeout=15)
        assert rb.status_code == 200 and rb.json()["status"] == "menunggu_konfirmasi", rb.text

        r2 = requests.get(f"{API}/admin/stats", headers=_h(admin_token), timeout=15)
        assert r2.json()["perlu_konfirmasi"] == base["perlu_konfirmasi"] + 1, \
            f"expected {base['perlu_konfirmasi'] + 1}, got {r2.json()['perlu_konfirmasi']}"

    def test_stats_forbidden_for_buyer(self, buyer_ready):
        r = requests.get(f"{API}/admin/stats", headers=_h(buyer_ready), timeout=15)
        assert r.status_code in (401, 403), r.status_code


# ===========================================================================
# D) Regression: chat realtime + unread/read (iteration_5 fix must hold)
# ===========================================================================
class TestChatRegression:
    def test_buyer_message_reaches_admin_and_unread_clears(self, admin_token, buyer_ready):
        async def run():
            admin = await _connect(admin_token)
            try:
                waiter = asyncio.ensure_future(
                    _wait_event(admin, "message", lambda m: "TEST_notif_regress" in (m.get("text") or ""), timeout=10))
                await asyncio.sleep(0.5)
                r = requests.post(f"{API}/chat/send", json={"text": "TEST_notif_regress halo admin"},
                                  headers=_h(buyer_ready), timeout=15)
                assert r.status_code == 200, r.text
                evt = await waiter
                assert evt is not None, "admin did not receive buyer message in realtime"
                assert evt.get("sender_role") == "buyer", evt
            finally:
                await admin.disconnect()
        asyncio.run(run())

        # unread badge increments, then read clears it
        room = requests.get(f"{API}/auth/me", headers=_h(buyer_ready), timeout=15).json()["user_id"]
        rr = requests.post(f"{API}/chat/read", json={"room": room}, headers=_h(admin_token), timeout=15)
        assert rr.status_code == 200, rr.text
        rooms = requests.get(f"{API}/chat/rooms", headers=_h(admin_token), timeout=15).json()
        target = [x for x in rooms if x["room"] == room]
        assert target and target[0]["unread"] == 0, f"unread not cleared: {target}"

    def test_admin_reply_reaches_buyer(self, admin_token, buyer_ready):
        buyer_room = requests.get(f"{API}/auth/me", headers=_h(buyer_ready), timeout=15).json()["user_id"]

        async def run():
            buyer = await _connect(buyer_ready)
            try:
                waiter = asyncio.ensure_future(
                    _wait_event(buyer, "message", lambda m: "TEST_notif_reply" in (m.get("text") or ""), timeout=10))
                await asyncio.sleep(0.5)
                r = requests.post(f"{API}/chat/send",
                                  json={"room": buyer_room, "text": "TEST_notif_reply dari admin"},
                                  headers=_h(admin_token), timeout=15)
                assert r.status_code == 200, r.text
                evt = await waiter
                assert evt is not None, "buyer did not receive admin reply in realtime"
                assert evt.get("sender_role") == "admin", evt
            finally:
                await buyer.disconnect()
        asyncio.run(run())

        # cleanup: buyer marks read so global unread isn't polluted
        requests.post(f"{API}/chat/read", json={}, headers=_h(buyer_ready), timeout=15)
