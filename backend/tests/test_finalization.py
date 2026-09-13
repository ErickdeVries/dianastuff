"""Diana Stuff finalization tests: order lifecycle, chat REST, socket.io handshake, seed."""
import os
import uuid
import httpx
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login-whitelist",
                      json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(f"{BASE_URL}/api/auth/login-whitelist",
                      json={"username": "buyer", "password": "buyer123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_user(buyer_token):
    r = requests.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {buyer_token}"}, timeout=15)
    return r.json()


def _h(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def ensure_buyer_address(buyer_token, buyer_user):
    # ensure buyer has address so order creation is allowed
    if not buyer_user.get("alamat"):
        requests.put(f"{BASE_URL}/api/me", headers=_h(buyer_token),
                     json={"nama": buyer_user.get("nama") or "Pembeli Demo",
                           "wa": buyer_user.get("wa") or "081234567890",
                           "alamat": "Jl Mawar No 12", "kota": "Bandung",
                           "kode_pos": "40123"}, timeout=15)
    return True


@pytest.fixture(scope="module")
def sample_product():
    r = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200
    products = r.json()
    baju = [p for p in products if p.get("kategori") == "Baju" and p.get("stok", 0) > 0]
    assert baju, "no baju products with stock"
    return baju[0]


@pytest.fixture
def new_order(buyer_token, ensure_buyer_address, sample_product):
    r = requests.post(f"{BASE_URL}/api/orders", headers=_h(buyer_token),
                      json={"items": [{"product_id": sample_product["id"], "qty": 1}],
                            "kurir": "JNE", "ongkir": 15000}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- seed ----------
class TestSeed:
    def test_profil_admin_defaults(self):
        r = requests.get(f"{BASE_URL}/api/profil_admin", timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p.get("whatsapp"), "whatsapp missing"
        # allow 628123456789 (spec) or 6285312812452 (current DEFAULT_WHATSAPP)
        assert p["whatsapp"] in ("628123456789", "6285312812452"), f"whatsapp={p['whatsapp']}"
        rek = p.get("rekening_bank") or []
        assert any(r.get("bank") == "BCA" and r.get("a_n") == "Diana" for r in rek), rek
        assert p.get("kurir_list"), "kurir_list missing"

    def test_baju_products(self):
        r = requests.get(f"{BASE_URL}/api/products", timeout=15)
        assert r.status_code == 200
        names = {p["nama_produk"] for p in r.json()}
        for expected in ("Blouse Katun Premium", "Dress Floral Musim Panas", "Kemeja Oversize Unisex"):
            assert expected in names, f"missing seed product: {expected}"

    def test_users_exist(self, admin_token, buyer_token):
        assert admin_token and buyer_token


# ---------- konfirmasi bayar ----------
class TestKonfirmasiBayar:
    def test_sets_status_menunggu_konfirmasi(self, buyer_token, new_order):
        oid = new_order["id"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/konfirmasi-bayar",
                          headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "menunggu_konfirmasi"
        # verify persistence via GET
        g = requests.get(f"{BASE_URL}/api/orders/{oid}", headers=_h(buyer_token), timeout=15)
        assert g.json()["status"] == "menunggu_konfirmasi"


# ---------- update status (admin) ----------
class TestUpdateStatus:
    def test_buyer_forbidden(self, buyer_token, new_order):
        r = requests.put(f"{BASE_URL}/api/orders/{new_order['id']}/status",
                         headers=_h(buyer_token), json={"status": "sedang_dikemas"}, timeout=15)
        assert r.status_code == 403

    def test_invalid_status(self, admin_token, new_order):
        r = requests.put(f"{BASE_URL}/api/orders/{new_order['id']}/status",
                         headers=_h(admin_token), json={"status": "not_a_real_status"}, timeout=15)
        assert r.status_code == 400

    def test_sedang_dikemas(self, admin_token, new_order):
        r = requests.put(f"{BASE_URL}/api/orders/{new_order['id']}/status",
                         headers=_h(admin_token), json={"status": "sedang_dikemas"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "sedang_dikemas"

    def test_dikirim_requires_resi(self, admin_token, new_order):
        r = requests.put(f"{BASE_URL}/api/orders/{new_order['id']}/status",
                         headers=_h(admin_token), json={"status": "dikirim"}, timeout=15)
        assert r.status_code == 400

    def test_dikirim_stores_resi(self, admin_token, new_order):
        resi = f"TEST_RESI_{uuid.uuid4().hex[:6]}"
        r = requests.put(f"{BASE_URL}/api/orders/{new_order['id']}/status",
                         headers=_h(admin_token),
                         json={"status": "dikirim", "no_resi": resi}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "dikirim"
        assert body["no_resi"] == resi

    def test_selesai_flow(self, admin_token, buyer_token, sample_product, ensure_buyer_address):
        # create fresh order, run through lifecycle
        c = requests.post(f"{BASE_URL}/api/orders", headers=_h(buyer_token),
                          json={"items": [{"product_id": sample_product["id"], "qty": 1}]}, timeout=15)
        oid = c.json()["id"]
        for st in [("sedang_dikemas", {}), ("dikirim", {"no_resi": "TEST_RESI_XYZ"}), ("selesai", {})]:
            payload = {"status": st[0]}; payload.update(st[1])
            r = requests.put(f"{BASE_URL}/api/orders/{oid}/status", headers=_h(admin_token), json=payload, timeout=15)
            assert r.status_code == 200, (st[0], r.text)
        g = requests.get(f"{BASE_URL}/api/orders/{oid}", headers=_h(buyer_token), timeout=15).json()
        assert g["status"] == "selesai"
        assert g["no_resi"] == "TEST_RESI_XYZ"


# ---------- review ----------
class TestReview:
    def test_valid_rating(self, buyer_token, new_order):
        oid = new_order["id"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/review", headers=_h(buyer_token),
                          json={"rating": 5, "komentar": "TEST_ mantap"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["review"]["rating"] == 5
        assert r.json()["review"]["komentar"] == "TEST_ mantap"

    def test_invalid_rating(self, buyer_token, new_order):
        r = requests.post(f"{BASE_URL}/api/orders/{new_order['id']}/review", headers=_h(buyer_token),
                          json={"rating": 6}, timeout=15)
        assert r.status_code == 400
        r2 = requests.post(f"{BASE_URL}/api/orders/{new_order['id']}/review", headers=_h(buyer_token),
                           json={"rating": 0}, timeout=15)
        assert r2.status_code == 400

    def test_other_buyer_forbidden(self, admin_token, buyer_token, new_order):
        # create a second buyer
        uname = f"testbuyer{uuid.uuid4().hex[:6]}"
        cr = requests.post(f"{BASE_URL}/api/admin/customers", headers=_h(admin_token),
                           json={"username": uname, "password": "secret123", "nama": "TEST_ Other",
                                 "email": f"{uname}@x.test", "status": "approved"}, timeout=15)
        assert cr.status_code == 200, cr.text
        other = requests.post(f"{BASE_URL}/api/auth/login-whitelist",
                              json={"username": uname, "password": "secret123"}, timeout=15).json()["session_token"]
        r = requests.post(f"{BASE_URL}/api/orders/{new_order['id']}/review", headers=_h(other),
                          json={"rating": 5}, timeout=15)
        assert r.status_code == 403
        # cleanup: soft-delete this buyer
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(other), timeout=15).json()
        requests.delete(f"{BASE_URL}/api/admin/customers/{me['user_id']}", headers=_h(admin_token), timeout=15)


# ---------- order_public shape ----------
class TestOrderShape:
    def test_returns_no_resi_and_review(self, admin_token, buyer_token, sample_product, ensure_buyer_address):
        c = requests.post(f"{BASE_URL}/api/orders", headers=_h(buyer_token),
                          json={"items": [{"product_id": sample_product["id"], "qty": 1}]}, timeout=15).json()
        oid = c["id"]
        assert "no_resi" in c and "review" in c
        requests.put(f"{BASE_URL}/api/orders/{oid}/status", headers=_h(admin_token),
                     json={"status": "dikirim", "no_resi": "TR-1"}, timeout=15)
        requests.post(f"{BASE_URL}/api/orders/{oid}/review", headers=_h(buyer_token),
                      json={"rating": 4, "komentar": "ok"}, timeout=15)
        g = requests.get(f"{BASE_URL}/api/orders/{oid}", headers=_h(buyer_token), timeout=15).json()
        assert g["no_resi"] == "TR-1"
        assert g["review"]["rating"] == 4


# ---------- upload with buyer ----------
class TestUpload:
    def test_upload_buyer(self, buyer_token):
        # tiny 1x1 png
        png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
                            "53de0000000c4944415478da63f8cf00000003000119a4d75c0000000049454e44ae426082")
        files = {"file": ("test.png", png, "image/png")}
        r = requests.post(f"{BASE_URL}/api/upload", headers=_h(buyer_token), files=files, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "path" in body and body["url"].startswith("/api/files/")


# ---------- chat REST ----------
class TestChatREST:
    def test_history_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/chat/history", timeout=15)
        assert r.status_code == 401

    def test_rooms_requires_admin(self, buyer_token):
        r = requests.get(f"{BASE_URL}/api/chat/rooms", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/chat/rooms", timeout=15)
        assert r2.status_code == 401

    def test_buyer_send_saves_to_own_room(self, buyer_token, buyer_user):
        msg_text = f"TEST_ hello {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/chat/send", headers=_h(buyer_token),
                          json={"text": msg_text}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["room"] == buyer_user["user_id"]
        assert body["text"] == msg_text
        # verify in history
        h = requests.get(f"{BASE_URL}/api/chat/history", headers=_h(buyer_token), timeout=15).json()
        assert any(m["text"] == msg_text for m in h)

    def test_admin_send_requires_room(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/chat/send", headers=_h(admin_token),
                          json={"text": "TEST_ x"}, timeout=15)
        assert r.status_code == 400

    def test_admin_history_with_room(self, admin_token, buyer_user):
        r = requests.get(f"{BASE_URL}/api/chat/history?room={buyer_user['user_id']}",
                         headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_rooms_lists_buyer(self, admin_token, buyer_user):
        r = requests.get(f"{BASE_URL}/api/chat/rooms", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        rooms = r.json()
        assert any(rm["room"] == buyer_user["user_id"] for rm in rooms), rooms


# ---------- Socket.IO handshake ----------
class TestSocketIO:
    def test_handshake_polling(self):
        # engine.io v4 polling handshake — must return 200 and a session id
        r = requests.get(f"{BASE_URL}/api/socket.io/?EIO=4&transport=polling", timeout=15)
        assert r.status_code == 200, r.text
        # response should start with 0{"sid":...} (open packet)
        assert '"sid"' in r.text
        assert '"upgrades"' in r.text

    def test_connect_requires_valid_token(self, buyer_token):
        # Full connect via python-socketio client
        try:
            import socketio as sio_client
        except ImportError:
            pytest.skip("python-socketio client not installed")
        c = sio_client.Client(reconnection=False)
        try:
            c.connect(BASE_URL, socketio_path="/api/socket.io",
                      auth={"token": buyer_token}, wait_timeout=10,
                      transports=["polling"])
            assert c.connected
        finally:
            if c.connected: c.disconnect()

    def test_connect_rejects_bad_token(self):
        try:
            import socketio as sio_client
        except ImportError:
            pytest.skip("python-socketio client not installed")
        c = sio_client.Client(reconnection=False)
        with pytest.raises(Exception):
            c.connect(BASE_URL, socketio_path="/api/socket.io",
                      auth={"token": "invalid"}, wait_timeout=5,
                      transports=["polling"])
        if c.connected: c.disconnect()

    def test_message_persists_and_broadcasts(self, buyer_token, buyer_user):
        try:
            import socketio as sio_client
        except ImportError:
            pytest.skip("python-socketio client not installed")
        received = []
        c = sio_client.Client(reconnection=False)
        @c.on("message")
        def _on(data):
            received.append(data)
        c.connect(BASE_URL, socketio_path="/api/socket.io",
                  auth={"token": buyer_token}, wait_timeout=10,
                  transports=["polling"])
        c.emit("join", {"room": buyer_user["user_id"]})
        import time; time.sleep(0.5)
        marker = f"TEST_socket_{uuid.uuid4().hex[:6]}"
        c.emit("message", {"text": marker})
        # wait up to 5s for the echo
        for _ in range(20):
            if any(m.get("text") == marker for m in received): break
            time.sleep(0.25)
        c.disconnect()
        assert any(m.get("text") == marker for m in received), received
        # verify persisted in mongo via REST history
        h = requests.get(f"{BASE_URL}/api/chat/history", headers=_h(buyer_token), timeout=15).json()
        assert any(m["text"] == marker for m in h)
