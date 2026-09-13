"""Backend tests for Diana Stuff buyer shopping flow.

Covers:
- PUT /api/me (address validation + persistence)
- GET /api/ongkir (found + not-found)
- POST /api/orders (subtotal, no_order, stock decrement, PO negative stock, error cases)
- GET /api/orders + /api/orders/{id} (buyer scoping + 403 cross-user)
- POST /api/orders/{id}/bukti (buyer sets bukti + status transitions)
- profil_admin.kurir_list contains 4 defaults
- /api/upload works with buyer token
"""
import os
import io
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def buyer_token():
    r = requests.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def buyer2_token(admin_token):
    """Create a second approved buyer + return its login token."""
    uname = f"tbuyer{int(time.time())}"
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.post(f"{API}/admin/customers", json={
        "username": uname, "password": "buyer123", "nama": "T Buyer 2", "status": "approved"
    }, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/auth/login-whitelist", json={"username": uname, "password": "buyer123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="session")
def stock_product(admin_token):
    """Create a non-PO product with stock=5."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.post(f"{API}/products", json={
        "kategori": "TEST", "nama_produk": "TEST_Buyer_Stock", "harga": 10000,
        "stok": 5, "bisa_po": False, "foto_urls": [],
    }, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def po_product(admin_token):
    """Create a PO product with stock=0."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.post(f"{API}/products", json={
        "kategori": "TEST", "nama_produk": "TEST_Buyer_PO", "harga": 25000,
        "stok": 0, "bisa_po": True, "foto_urls": [],
    }, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------- profil_admin.kurir_list
def test_profil_admin_has_kurir_list():
    r = requests.get(f"{API}/profil_admin", timeout=15)
    assert r.status_code == 200
    body = r.json()
    kurir = body.get("kurir_list") or []
    for k in ["JNE", "J&T", "Lion Parcel", "Gosend Instan/Sameday"]:
        assert k in kurir, f"Expected kurir {k} in {kurir}"


# --------------------------------------------------------------------------- PUT /api/me
class TestPutMe:
    def test_empty_alamat_400(self, buyer_token):
        r = requests.put(f"{API}/me", json={"alamat": "", "kota": "Bandung"}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 400

    def test_empty_kota_400(self, buyer_token):
        r = requests.put(f"{API}/me", json={"alamat": "Jl Mawar", "kota": "   "}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 400

    def test_save_success_and_persist(self, buyer_token):
        payload = {"alamat": "Jl Mawar No 12", "kota": "Bandung", "kode_pos": "40123", "wa": "081234567890"}
        r = requests.put(f"{API}/me", json=payload, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["alamat"] == "Jl Mawar No 12"
        assert body["kota"] == "Bandung"
        assert body["kode_pos"] == "40123"
        # Verify persistence
        r2 = requests.get(f"{API}/auth/me", headers=_h(buyer_token), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["alamat"] == "Jl Mawar No 12"


# --------------------------------------------------------------------------- GET /api/ongkir
class TestOngkir:
    def test_not_found_returns_false(self, buyer_token):
        r = requests.get(f"{API}/ongkir", params={"kota": "KotaTidakAda__X", "kurir": "JNE"}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b == {"found": False, "harga": None}

    def test_found_returns_harga(self, buyer_token, db):
        db.ongkir_manual.delete_many({"kota": "Bandung", "kurir": "JNE"})
        db.ongkir_manual.insert_one({"kota": "Bandung", "kurir": "JNE", "harga": 15000})
        try:
            r = requests.get(f"{API}/ongkir", params={"kota": "bandung", "kurir": "JNE"}, headers=_h(buyer_token), timeout=15)
            assert r.status_code == 200
            b = r.json()
            assert b["found"] is True
            assert b["harga"] == 15000
        finally:
            db.ongkir_manual.delete_many({"kota": "Bandung", "kurir": "JNE"})

    def test_requires_auth(self):
        r = requests.get(f"{API}/ongkir", params={"kota": "Bandung", "kurir": "JNE"}, timeout=15)
        assert r.status_code == 401


# --------------------------------------------------------------------------- POST /api/orders
class TestCreateOrder:
    def test_empty_cart_400(self, buyer_token):
        # Buyer already has address from TestPutMe.test_save_success_and_persist
        r = requests.post(f"{API}/orders", json={"items": [], "kurir": "JNE", "ongkir": 0}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 400

    def test_missing_address_returns_400(self, buyer2_token, stock_product):
        # buyer2 has NO address set yet
        r = requests.post(f"{API}/orders", json={
            "items": [{"product_id": stock_product["id"], "qty": 1}]
        }, headers=_h(buyer2_token), timeout=15)
        assert r.status_code == 400
        assert "alamat" in r.json().get("detail", "").lower()

    def test_insufficient_stock_non_po(self, buyer_token, stock_product):
        r = requests.post(f"{API}/orders", json={
            "items": [{"product_id": stock_product["id"], "qty": 999}], "kurir": "JNE", "ongkir": 0
        }, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 400

    def test_successful_order_and_stock_decrement(self, buyer_token, stock_product):
        # stock was 5; place order of 2
        r = requests.post(f"{API}/orders", json={
            "items": [{"product_id": stock_product["id"], "qty": 2}], "kurir": "JNE", "ongkir": 15000
        }, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        order = r.json()
        # no_order format DS-YYMMDD-XXXX (4 hex chars)
        assert order["no_order"].startswith("DS-"), order["no_order"]
        parts = order["no_order"].split("-")
        assert len(parts) == 3
        assert len(parts[1]) == 6 and parts[1].isdigit()
        assert len(parts[2]) == 4
        assert order["subtotal"] == 20000
        assert order["ongkir"] == 15000
        assert order["total"] == 35000
        assert order["status"] == "menunggu_pembayaran"
        assert order["alamat"]["kota"] == "Bandung"
        assert order["kurir"] == "JNE"
        # Stock decremented
        r2 = requests.get(f"{API}/products/{stock_product['id']}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["stok"] == 3
        # Save for later tests
        pytest.buyer_order_id = order["id"]
        pytest.buyer_order_no = order["no_order"]

    def test_po_allows_negative_stock(self, buyer_token, po_product):
        r = requests.post(f"{API}/orders", json={
            "items": [{"product_id": po_product["id"], "qty": 3}], "kurir": "J&T", "ongkir": 0
        }, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["subtotal"] == 75000
        r2 = requests.get(f"{API}/products/{po_product['id']}", timeout=15)
        assert r2.json()["stok"] == -3


# --------------------------------------------------------------------------- GET orders
class TestListAndGetOrders:
    def test_list_buyer_own_only(self, buyer_token):
        r = requests.get(f"{API}/orders", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) >= 1
        # every order must belong to this buyer (buyer scoped)
        me = requests.get(f"{API}/auth/me", headers=_h(buyer_token), timeout=15).json()
        for o in orders:
            assert o["user_id"] == me["user_id"]

    def test_get_own_order(self, buyer_token):
        oid = getattr(pytest, "buyer_order_id", None)
        assert oid, "prerequisite order id"
        r = requests.get(f"{API}/orders/{oid}", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == oid

    def test_other_buyer_gets_403(self, buyer2_token):
        oid = getattr(pytest, "buyer_order_id", None)
        assert oid
        r = requests.get(f"{API}/orders/{oid}", headers=_h(buyer2_token), timeout=15)
        assert r.status_code == 403


# --------------------------------------------------------------------------- bukti bayar
class TestBuktiBayar:
    def test_missing_url_400(self, buyer_token):
        oid = getattr(pytest, "buyer_order_id", None)
        r = requests.post(f"{API}/orders/{oid}/bukti", json={}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 400

    def test_set_bukti_updates_status(self, buyer_token):
        oid = getattr(pytest, "buyer_order_id", None)
        r = requests.post(f"{API}/orders/{oid}/bukti", json={"bukti_bayar_url": "/api/files/foo.jpg"}, headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bukti_bayar_url"] == "/api/files/foo.jpg"
        assert body["status"] == "menunggu_konfirmasi"

    def test_other_buyer_bukti_403(self, buyer2_token):
        oid = getattr(pytest, "buyer_order_id", None)
        r = requests.post(f"{API}/orders/{oid}/bukti", json={"bukti_bayar_url": "/api/files/x.jpg"}, headers=_h(buyer2_token), timeout=15)
        assert r.status_code == 403


# --------------------------------------------------------------------------- upload with buyer token
def test_upload_with_buyer_token(buyer_token):
    # 1x1 PNG
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
           b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00"
           b"\x03\x00\x01`|\xe5V\x00\x00\x00\x00IEND\xaeB`\x82")
    files = {"file": ("t.png", io.BytesIO(png), "image/png")}
    r = requests.post(f"{API}/upload", files=files, headers=_h(buyer_token), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and body["url"].startswith("/api/files/")


# --------------------------------------------------------------------------- cleanup
def test_zzz_cleanup(admin_token, stock_product, po_product):
    h = _h(admin_token)
    for pid in [stock_product["id"], po_product["id"]]:
        requests.delete(f"{API}/products/{pid}", headers=h, timeout=15)
