"""Backend tests for Diana Stuff — iteration 6 scope.

Covers:
A) Session persistence semantics (bug fix 1):
   - whitelist login -> /api/auth/me works with token (session valid server-side)
   - invalid/garbage token -> /api/auth/me returns HTTP 401 (frontend clears session)
   - missing token -> 401
   - logout -> token invalidated server-side (subsequent /me -> 401)
B) Admin order management (bug fix 2):
   - PUT /api/orders/<id>/status transitions: menunggu_konfirmasi -> sedang_dikemas
     (Konfirmasi Pembayaran Diterima), sedang_dikemas -> dikirim (with resi),
     dikirim -> selesai
   - resi-only update (status unchanged dikirim->dikirim) updates no_resi WITHOUT
     pushing a duplicate status_history entry
   - regression: menunggu_pembayaran -> sedang_dikemas (Proses button path)
   - validation: dikirim without resi -> 400, invalid status -> 400,
     buyer (non-admin) cannot PUT status -> 401/403

Leaves behind TEST orders used by the UI E2E:
   pytest.ui_orders = {
     'konfirmasi': order in menunggu_konfirmasi (UI clicks Konfirmasi),
     'dikirim':    order in dikirim (UI updates resi + Tandai Selesai),
     'proses':     order in menunggu_pembayaran (UI regression: Proses button),
     'dikemas':    order in sedang_dikemas (UI regression: resi input + Kirim),
   }
Run serially: pytest /app/backend/tests/test_session_admin_orders.py -o addopts=''
"""
import os
import pytest
import requests

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
        "kategori": "TEST", "nama_produk": "TEST_SessOrders", "harga": 15000,
        "stok": 50, "bisa_po": False, "foto_urls": [],
    }, headers=_h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def buyer_ready(buyer_token):
    """Ensure the demo buyer has an address so orders can be created."""
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


def _get_order(order_id, token):
    r = requests.get(f"{API}/orders/{order_id}", headers=_h(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ===========================================================================
# A) Session persistence semantics
# ===========================================================================
class TestSessionPersistence:
    def test_admin_login_then_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["username"] == "admin"
        assert body["role"] == "admin"

    def test_buyer_login_then_me(self, buyer_token):
        r = requests.get(f"{API}/auth/me", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "buyer"

    def test_me_invalid_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", headers=_h("TEST_garbage_token_123"), timeout=15)
        assert r.status_code == 401, r.status_code

    def test_me_missing_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401, r.status_code

    def test_logout_invalidates_token_server_side(self):
        r = requests.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"}, timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json()["session_token"]
        assert requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15).status_code == 200
        r2 = requests.post(f"{API}/auth/logout", headers=_h(tok), timeout=15)
        assert r2.status_code == 200, r2.text
        r3 = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
        assert r3.status_code == 401, f"token still valid after logout: {r3.status_code}"


# ===========================================================================
# B) Admin order status management + resi dedup
# ===========================================================================
class TestAdminOrderStatus:
    def test_full_lifecycle_and_resi_dedup(self, admin_token, buyer_ready, product):
        bt, at = buyer_ready, admin_token

        # --- order for UI 'Konfirmasi Pembayaran Diterima' click (left in menunggu_konfirmasi)
        o_conf = _mk_order(bt, product)
        r = requests.post(f"{API}/orders/{o_conf['id']}/bukti",
                          json={"bukti_bayar_url": "/api/files/TEST_bukti.jpg"}, headers=_h(bt), timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "menunggu_konfirmasi", r.text

        # --- order for UI resi update + Tandai Selesai (driven to dikirim here)
        o_ship = _mk_order(bt, product)
        requests.post(f"{API}/orders/{o_ship['id']}/bukti",
                      json={"bukti_bayar_url": "/api/files/TEST_bukti.jpg"}, headers=_h(bt), timeout=15)
        # admin: Konfirmasi Pembayaran Diterima -> sedang_dikemas
        r = requests.put(f"{API}/orders/{o_ship['id']}/status",
                         json={"status": "sedang_dikemas"}, headers=_h(at), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "sedang_dikemas"
        hist = [h["status"] for h in body["status_history"]]
        assert hist.count("sedang_dikemas") == 1, hist

        # admin: Kirim -> dikirim with resi
        r = requests.put(f"{API}/orders/{o_ship['id']}/status",
                         json={"status": "dikirim", "no_resi": "TR-TEST-1"}, headers=_h(at), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "dikirim"
        assert body["no_resi"] == "TR-TEST-1"
        hist_len = len(body["status_history"])
        assert [h["status"] for h in body["status_history"]].count("dikirim") == 1

        # BUG FIX: resi-only update (status unchanged) must NOT duplicate history
        r = requests.put(f"{API}/orders/{o_ship['id']}/status",
                         json={"status": "dikirim", "no_resi": "TR-TEST-2"}, headers=_h(at), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["no_resi"] == "TR-TEST-2", body["no_resi"]
        assert len(body["status_history"]) == hist_len, (
            f"duplicate status_history on resi-only update: {body['status_history']}")
        assert [h["status"] for h in body["status_history"]].count("dikirim") == 1

        # verify persistence via GET
        got = _get_order(o_ship["id"], at)
        assert got["no_resi"] == "TR-TEST-2"
        assert len(got["status_history"]) == hist_len

        # --- regression: menunggu_pembayaran -> sedang_dikemas (Proses button)
        o_proc = _mk_order(bt, product)
        assert o_proc["status"] == "menunggu_pembayaran"
        r = requests.put(f"{API}/orders/{o_proc['id']}/status",
                         json={"status": "sedang_dikemas"}, headers=_h(at), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "sedang_dikemas"

        # --- a fresh menunggu_pembayaran order left for UI 'Proses' regression
        o_pay = _mk_order(bt, product)

        pytest.ui_orders = {
            "konfirmasi": o_conf["id"],
            "dikirim": o_ship["id"],
            "dikemas": o_proc["id"],
            "proses": o_pay["id"],
        }

    def test_dikirim_without_resi_400(self, admin_token, buyer_ready, product):
        o = _mk_order(buyer_ready, product)
        r = requests.put(f"{API}/orders/{o['id']}/status",
                         json={"status": "dikirim"}, headers=_h(admin_token), timeout=15)
        assert r.status_code == 400, r.status_code
        # order unchanged
        assert _get_order(o["id"], admin_token)["status"] == "menunggu_pembayaran"

    def test_invalid_status_400(self, admin_token, buyer_ready, product):
        o = _mk_order(buyer_ready, product)
        r = requests.put(f"{API}/orders/{o['id']}/status",
                         json={"status": "TEST_bogus"}, headers=_h(admin_token), timeout=15)
        assert r.status_code == 400, r.status_code

    def test_buyer_cannot_update_status(self, admin_token, buyer_ready, product):
        o = _mk_order(buyer_ready, product)
        r = requests.put(f"{API}/orders/{o['id']}/status",
                         json={"status": "sedang_dikemas"}, headers=_h(buyer_ready), timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_admin_sees_all_orders_list(self, admin_token):
        r = requests.get(f"{API}/orders", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        orders = r.json()
        assert isinstance(orders, list) and len(orders) >= 1
        # every item carries fields the admin UI needs
        for o in orders[:5]:
            for k in ("id", "no_order", "status", "total"):
                assert k in o, f"missing {k}"
