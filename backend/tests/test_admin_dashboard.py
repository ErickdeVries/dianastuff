"""Backend regression tests for the Diana Stuff Admin Dashboard feature.

Covers:
- GET /api/admin/stats (auth guards + payload)
- Products CRUD + search + soft-delete
- Admin customers CRUD + validation
- PUT /api/profil_admin validation & persistence
- POST /api/upload + GET /api/files/{path} public read
- Seed data assertions (admin/buyer users, profil_admin whatsapp)
"""
import io
import uuid
import struct
import zlib
import pytest
import requests

BASE_URL = "https://diana-store-2.preview.emergentagent.com"
API = f"{BASE_URL}/api"


# --- fixtures ---------------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": "admin", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_token(s):
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": "buyer", "password": "buyer123"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _h(token): return {"Authorization": f"Bearer {token}"}


def _tiny_png() -> bytes:
    """Minimal 1x1 red PNG."""
    def chunk(t, d):
        return (struct.pack(">I", len(d)) + t + d
                + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# --- seed data --------------------------------------------------------------
def test_seed_profil_admin_whatsapp():
    r = requests.get(f"{API}/profil_admin", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["whatsapp"] == "6285312812452"
    assert data["nama_toko"] == "Diana Stuff"
    assert "_id" not in data


def test_seed_admin_and_buyer_exist(s):
    a = s.post(f"{API}/auth/login-whitelist",
               json={"username": "admin", "password": "admin123"}, timeout=20)
    assert a.status_code == 200 and a.json()["user"]["role"] == "admin"
    b = s.post(f"{API}/auth/login-whitelist",
               json={"username": "buyer", "password": "buyer123"}, timeout=20)
    assert b.status_code == 200 and b.json()["user"]["role"] == "buyer"


# --- /api/admin/stats -------------------------------------------------------
class TestAdminStats:
    def test_no_token_401(self):
        r = requests.get(f"{API}/admin/stats", timeout=20)
        assert r.status_code == 401

    def test_buyer_token_403(self, buyer_token):
        r = requests.get(f"{API}/admin/stats", headers=_h(buyer_token), timeout=20)
        assert r.status_code == 403

    def test_admin_stats_payload(self, admin_token):
        r = requests.get(f"{API}/admin/stats", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("produk", "pelanggan", "pending", "pesanan"):
            assert k in d and isinstance(d[k], int)


# --- products ---------------------------------------------------------------
class TestProducts:
    created_id = None

    def test_public_list(self):
        r = requests.get(f"{API}/products", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_write_requires_admin_401(self):
        r = requests.post(f"{API}/products", json={"nama_produk": "x"}, timeout=20)
        assert r.status_code == 401

    def test_write_requires_admin_403(self, buyer_token):
        r = requests.post(f"{API}/products", json={"nama_produk": "x"},
                          headers=_h(buyer_token), timeout=20)
        assert r.status_code == 403

    def test_create(self, admin_token):
        payload = {
            "kategori": "TEST_kategori",
            "nama_produk": f"TEST_produk_{uuid.uuid4().hex[:6]}",
            "deskripsi": "produk pengujian",
            "harga": 12345,
            "stok": 7,
            "berat_gram": 250,
            "bisa_po": True,
            "foto_urls": ["/api/files/x.png"],
        }
        r = requests.post(f"{API}/products", json=payload,
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and d["nama_produk"] == payload["nama_produk"]
        assert d["harga"] == 12345 and d["stok"] == 7 and d["bisa_po"] is True
        TestProducts.created_id = d["id"]
        TestProducts.created_name = d["nama_produk"]

    def test_search_filter_finds_created(self):
        assert TestProducts.created_id
        r = requests.get(f"{API}/products",
                         params={"search": TestProducts.created_name[:8]}, timeout=20)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert TestProducts.created_id in ids

    def test_search_filter_no_match(self):
        r = requests.get(f"{API}/products",
                         params={"search": f"zzz_nomatch_{uuid.uuid4().hex}"}, timeout=20)
        assert r.status_code == 200 and r.json() == []

    def test_update(self, admin_token):
        assert TestProducts.created_id
        new = {
            "kategori": "TEST_kategori",
            "nama_produk": TestProducts.created_name,
            "deskripsi": "updated",
            "harga": 99999,
            "stok": 2,
            "berat_gram": 500,
            "bisa_po": False,
            "foto_urls": [],
        }
        r = requests.put(f"{API}/products/{TestProducts.created_id}",
                         json=new, headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["harga"] == 99999
        # verify via GET
        r2 = requests.get(f"{API}/products/{TestProducts.created_id}", timeout=20)
        assert r2.status_code == 200 and r2.json()["stok"] == 2

    def test_soft_delete(self, admin_token):
        assert TestProducts.created_id
        r = requests.delete(f"{API}/products/{TestProducts.created_id}",
                            headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        # not in list anymore
        r2 = requests.get(f"{API}/products", timeout=20)
        ids = [p["id"] for p in r2.json()]
        assert TestProducts.created_id not in ids
        # 404 on GET
        r3 = requests.get(f"{API}/products/{TestProducts.created_id}", timeout=20)
        assert r3.status_code == 404


# --- customers --------------------------------------------------------------
class TestCustomers:
    created_id = None
    created_username = None

    def test_list_requires_admin(self, buyer_token):
        r = requests.get(f"{API}/admin/customers", timeout=20)
        assert r.status_code == 401
        r2 = requests.get(f"{API}/admin/customers", headers=_h(buyer_token), timeout=20)
        assert r2.status_code == 403

    def test_list_only_buyers(self, admin_token):
        r = requests.get(f"{API}/admin/customers", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        for u in r.json():
            assert u["role"] == "buyer"

    def test_create(self, admin_token):
        uname = f"test_cust_{uuid.uuid4().hex[:6]}"
        TestCustomers.created_username = uname
        r = requests.post(f"{API}/admin/customers",
                          json={
                              "email": f"{uname}@t.local",
                              "username": uname,
                              "password": "buyer123",
                              "nama": "TEST Pelanggan",
                              "wa": "081200001111",
                              "status": "approved",
                          },
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "buyer" and d["status"] == "approved"
        assert d["username"] == uname
        TestCustomers.created_id = d["user_id"]

    def test_create_short_password_400(self, admin_token):
        r = requests.post(f"{API}/admin/customers",
                          json={"username": f"cust_{uuid.uuid4().hex[:6]}",
                                "password": "abc", "nama": "x", "status": "approved"},
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 400

    def test_create_duplicate_username_409(self, admin_token):
        assert TestCustomers.created_username
        r = requests.post(f"{API}/admin/customers",
                          json={"username": TestCustomers.created_username,
                                "password": "buyer123", "nama": "dup", "status": "approved"},
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 409

    def test_update_status_and_password(self, admin_token):
        assert TestCustomers.created_id
        r = requests.put(f"{API}/admin/customers/{TestCustomers.created_id}",
                         json={
                             "email": f"{TestCustomers.created_username}@t.local",
                             "username": TestCustomers.created_username,
                             "password": "newpass123",
                             "nama": "TEST Pelanggan Updated",
                             "wa": "081200001111",
                             "status": "pending",
                         },
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"
        # verify new password works but pending blocks login (403)
        s = requests.Session()
        rl = s.post(f"{API}/auth/login-whitelist",
                    json={"username": TestCustomers.created_username, "password": "newpass123"},
                    timeout=20)
        assert rl.status_code == 403

    def test_delete_soft(self, admin_token):
        assert TestCustomers.created_id
        r = requests.delete(f"{API}/admin/customers/{TestCustomers.created_id}",
                            headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        # gone from list
        r2 = requests.get(f"{API}/admin/customers", headers=_h(admin_token), timeout=20)
        ids = [u["user_id"] for u in r2.json()]
        assert TestCustomers.created_id not in ids


# --- profil_admin update ----------------------------------------------------
class TestProfilAdminUpdate:
    def test_requires_admin(self, buyer_token):
        r = requests.put(f"{API}/profil_admin",
                         json={"nama_toko": "x", "whatsapp": "62811"}, timeout=20)
        assert r.status_code == 401
        r2 = requests.put(f"{API}/profil_admin",
                          json={"nama_toko": "x", "whatsapp": "62811"},
                          headers=_h(buyer_token), timeout=20)
        assert r2.status_code == 403

    def test_empty_whatsapp_400(self, admin_token):
        r = requests.put(f"{API}/profil_admin",
                         json={"nama_toko": "Diana Stuff", "whatsapp": "   ",
                               "rekening_bank": []},
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 400
        assert "wa wajib" in r.json()["detail"].lower()

    def test_empty_nama_toko_400(self, admin_token):
        r = requests.put(f"{API}/profil_admin",
                         json={"nama_toko": "   ", "whatsapp": "6285312812452",
                               "rekening_bank": []},
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 400

    def test_valid_update_persists(self, admin_token):
        payload = {
            "nama_toko": "Diana Stuff",
            "logo_url": "https://images.unsplash.com/photo-1638864616266-c390568f9092?w=400",
            "banner_url": "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200",
            "rekening_bank": [{"bank": "BCA", "no_rek": "1234567890", "a_n": "Diana"}],
            "whatsapp": "6285312812452",
        }
        r = requests.put(f"{API}/profil_admin", json=payload,
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["whatsapp"] == "6285312812452"
        # confirm via public GET
        r2 = requests.get(f"{API}/profil_admin", timeout=20)
        assert r2.status_code == 200
        assert r2.json()["whatsapp"] == "6285312812452"
        assert r2.json()["rekening_bank"][0]["bank"] == "BCA"


# --- upload + files ---------------------------------------------------------
class TestUpload:
    def test_upload_requires_admin_403(self, buyer_token):
        files = {"file": ("t.png", _tiny_png(), "image/png")}
        r = requests.post(f"{API}/upload", files=files,
                          headers=_h(buyer_token), timeout=30)
        assert r.status_code == 403

    def test_upload_admin_ok_and_public_read(self, admin_token):
        files = {"file": ("t.png", _tiny_png(), "image/png")}
        r = requests.post(f"{API}/upload", files=files,
                          headers=_h(admin_token), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("path") and d.get("url") == f"/api/files/{d['path']}"
        # public read — no auth
        r2 = requests.get(f"{BASE_URL}{d['url']}", timeout=30)
        assert r2.status_code == 200
        assert r2.headers.get("Content-Type", "").startswith("image/")
        assert len(r2.content) > 0
