"""Tests for iteration 37: ongkir_persen voucher, POS courier, product rating, satisfaction reviews."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login-whitelist",
                      json={"username": "admin", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_login():
    r = requests.post(f"{API}/auth/login-whitelist",
                      json={"username": "buyer", "password": "buyer123"}, timeout=20)
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text}"
    data = r.json()
    return data["session_token"], data["user"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Voucher CRUD + validation (ongkir_persen)
# ---------------------------------------------------------------------------
class TestOngkirPersenVoucher:
    created_ids = []

    def test_create_ongkir_persen_voucher(self, admin_token):
        kode = f"TESTONG{int(time.time())%100000}"
        payload = {"kode": kode, "tipe": "ongkir_persen", "nilai": 50,
                   "maks_potongan": 20000, "min_belanja": 0, "kuota": 0, "aktif": True}
        r = requests.post(f"{API}/admin/vouchers", json=payload,
                          headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tipe"] == "ongkir_persen"
        assert data["nilai"] == 50
        assert data["maks_potongan"] == 20000
        assert data["kode"] == kode.upper()
        TestOngkirPersenVoucher.created_ids.append((data["id"], data["kode"]))

    def test_reject_persen_over_100_for_ongkir(self, admin_token):
        kode = f"TESTBAD{int(time.time())%100000}"
        payload = {"kode": kode, "tipe": "ongkir_persen", "nilai": 150, "maks_potongan": 0}
        r = requests.post(f"{API}/admin/vouchers", json=payload,
                          headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 400, r.text
        assert "100" in r.json().get("detail", "")

    def test_validate_voucher_under_cap(self, buyer_login):
        tok, _ = buyer_login
        assert TestOngkirPersenVoucher.created_ids, "no voucher created in previous test"
        _, kode = TestOngkirPersenVoucher.created_ids[0]
        r = requests.post(f"{API}/voucher/validate",
                          json={"kode": kode, "subtotal": 100000, "ongkir": 30000},
                          headers=_hdr(tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        # 30000 * 50% = 15000 (< cap 20000)
        assert data["diskon"] == 15000, data

    def test_validate_voucher_capped(self, buyer_login):
        tok, _ = buyer_login
        _, kode = TestOngkirPersenVoucher.created_ids[0]
        r = requests.post(f"{API}/voucher/validate",
                          json={"kode": kode, "subtotal": 100000, "ongkir": 60000},
                          headers=_hdr(tok), timeout=20)
        data = r.json()
        assert data["valid"] is True
        # 60000 * 50% = 30000, capped at 20000
        assert data["diskon"] == 20000, data

    def test_validate_voucher_never_exceeds_ongkir(self, buyer_login):
        tok, _ = buyer_login
        _, kode = TestOngkirPersenVoucher.created_ids[0]
        # ongkir=10000, 50%=5000 -> never exceed shipping
        r = requests.post(f"{API}/voucher/validate",
                          json={"kode": kode, "subtotal": 100000, "ongkir": 10000},
                          headers=_hdr(tok), timeout=20)
        data = r.json()
        assert data["valid"] is True
        assert data["diskon"] == 5000

    @classmethod
    def teardown_class(cls):
        # Cleanup test vouchers
        try:
            r = requests.post(f"{API}/auth/login-whitelist",
                              json={"username": "admin", "password": "admin123"}, timeout=20)
            tok = r.json().get("session_token")
            for vid, _ in cls.created_ids:
                requests.delete(f"{API}/admin/vouchers/{vid}", headers=_hdr(tok), timeout=20)
        except Exception as e:
            print(f"cleanup failed: {e}")


# ---------------------------------------------------------------------------
# Regression: persen & nominal still work on subtotal
# ---------------------------------------------------------------------------
class TestRegressionVouchers:
    created_ids = []

    def test_persen_voucher_subtotal(self, admin_token, buyer_login):
        kode = f"TESTP{int(time.time())%100000}"
        payload = {"kode": kode, "tipe": "persen", "nilai": 10}
        r = requests.post(f"{API}/admin/vouchers", json=payload,
                          headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        TestRegressionVouchers.created_ids.append(r.json()["id"])
        tok, _ = buyer_login
        v = requests.post(f"{API}/voucher/validate",
                          json={"kode": kode, "subtotal": 100000, "ongkir": 20000},
                          headers=_hdr(tok), timeout=20).json()
        assert v["valid"] and v["diskon"] == 10000

    def test_nominal_voucher_subtotal(self, admin_token, buyer_login):
        kode = f"TESTN{int(time.time())%100000}"
        payload = {"kode": kode, "tipe": "nominal", "nilai": 7500}
        r = requests.post(f"{API}/admin/vouchers", json=payload,
                          headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        TestRegressionVouchers.created_ids.append(r.json()["id"])
        tok, _ = buyer_login
        v = requests.post(f"{API}/voucher/validate",
                          json={"kode": kode, "subtotal": 100000, "ongkir": 20000},
                          headers=_hdr(tok), timeout=20).json()
        assert v["valid"] and v["diskon"] == 7500

    @classmethod
    def teardown_class(cls):
        try:
            r = requests.post(f"{API}/auth/login-whitelist",
                              json={"username": "admin", "password": "admin123"}, timeout=20)
            tok = r.json().get("session_token")
            for vid in cls.created_ids:
                requests.delete(f"{API}/admin/vouchers/{vid}", headers=_hdr(tok), timeout=20)
        except Exception as e:
            print(f"cleanup failed: {e}")


# ---------------------------------------------------------------------------
# POS courier in ALL_COURIERS / shipping settings
# ---------------------------------------------------------------------------
class TestPosCourier:
    def test_shipping_settings_has_pos(self, admin_token):
        r = requests.get(f"{API}/admin/shipping-settings",
                         headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pos" in data.get("all_couriers", []), data


# ---------------------------------------------------------------------------
# Products expose rating + rating_count
# ---------------------------------------------------------------------------
class TestProductRatingFields:
    def test_products_list_has_rating_fields(self):
        r = requests.get(f"{API}/products", timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and items, "no products available"
        for p in items[:5]:
            assert "rating" in p, f"missing rating: {p.get('id')}"
            assert "rating_count" in p, f"missing rating_count: {p.get('id')}"
            assert isinstance(p["rating"], (int, float))
            assert isinstance(p["rating_count"], int)

    def test_product_detail_has_rating_fields(self):
        items = requests.get(f"{API}/products", timeout=20).json()
        pid = items[0]["id"]
        r = requests.get(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 200
        p = r.json()
        assert "rating" in p and "rating_count" in p


# ---------------------------------------------------------------------------
# Order creation applying ongkir_persen voucher
# ---------------------------------------------------------------------------
class TestOrderWithOngkirPersen:
    _voucher_id = None
    _order_id = None

    def test_full_order_flow(self, admin_token, buyer_login):
        # Create voucher
        kode = f"TESTORD{int(time.time())%100000}"
        rc = requests.post(f"{API}/admin/vouchers",
                           json={"kode": kode, "tipe": "ongkir_persen",
                                 "nilai": 50, "maks_potongan": 20000},
                           headers=_hdr(admin_token), timeout=20)
        assert rc.status_code == 200, rc.text
        TestOrderWithOngkirPersen._voucher_id = rc.json()["id"]

        # Pick a product
        prods = requests.get(f"{API}/products", timeout=20).json()
        prod = next((p for p in prods if not p.get("has_variations") and (p.get("stok", 0) > 0 or p.get("bisa_po"))), None)
        if not prod:
            pytest.skip("no simple product available for order")

        tok, _ = buyer_login
        order_payload = {
            "items": [{"product_id": prod["id"], "qty": 1}],
            "kurir": "pos",
            "ongkir": 30000,
            "shipping_coordinate": {"latitude": -6.2, "longitude": 106.8,
                                    "address": "Jl Test 1", "postal_code": "10220"},
            "courier_company": "pos",
            "courier_type": "paket_kilat_khusus",
            "voucher_code": kode,
            "asuransi": True,
            "asuransi_fee": 1000,
        }
        r = requests.post(f"{API}/orders", json=order_payload,
                          headers=_hdr(tok), timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        TestOrderWithOngkirPersen._order_id = order["id"]
        assert order["voucher_code"] == kode.upper()
        # 30000 * 50% = 15000, under cap
        assert order["voucher_diskon"] == 15000, order
        unit_price = prod.get("harga_final") or prod.get("harga")
        expected_total = unit_price + 30000 + 1000 - 15000
        assert abs(order["total"] - expected_total) < 1, order

    @classmethod
    def teardown_class(cls):
        try:
            r = requests.post(f"{API}/auth/login-whitelist",
                              json={"username": "admin", "password": "admin123"}, timeout=20)
            tok = r.json().get("session_token")
            if cls._voucher_id:
                requests.delete(f"{API}/admin/vouchers/{cls._voucher_id}",
                                headers=_hdr(tok), timeout=20)
        except Exception as e:
            print(f"cleanup failed: {e}")


# ---------------------------------------------------------------------------
# Review with satisfaction ratings (pelayanan + pengiriman)
# ---------------------------------------------------------------------------
class TestSatisfactionReviews:
    _order_id = None
    _product_id = None

    def _create_order(self, buyer_login):
        tok, _ = buyer_login
        prods = requests.get(f"{API}/products", timeout=20).json()
        prod = next((p for p in prods if not p.get("has_variations") and (p.get("stok", 0) > 0 or p.get("bisa_po"))), None)
        if not prod:
            pytest.skip("no simple product for review test")
        TestSatisfactionReviews._product_id = prod["id"]
        order_payload = {
            "items": [{"product_id": prod["id"], "qty": 1}],
            "kurir": "pos",
            "ongkir": 15000,
            "shipping_coordinate": {"latitude": -6.2, "longitude": 106.8,
                                    "address": "Jl Test 1", "postal_code": "10220"},
            "courier_company": "pos",
            "courier_type": "paket_kilat_khusus",
        }
        r = requests.post(f"{API}/orders", json=order_payload,
                          headers=_hdr(tok), timeout=30)
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        TestSatisfactionReviews._order_id = oid
        return oid

    def test_submit_review_with_satisfaction(self, admin_token, buyer_login):
        oid = self._create_order(buyer_login)
        tok, _ = buyer_login
        body = {"rating": 5, "rating_pelayanan": 4, "rating_pengiriman": 3,
                "komentar": "Mantap!"}
        r = requests.post(f"{API}/orders/{oid}/review", json=body,
                          headers=_hdr(tok), timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()
        rv = order.get("review") or {}
        assert rv.get("rating") == 5
        assert rv.get("rating_pelayanan") == 4
        assert rv.get("rating_pengiriman") == 3

    def test_satisfaction_clamped(self, admin_token, buyer_login):
        """Values outside 1-5 should be clamped to None (per _clamp)."""
        oid = TestSatisfactionReviews._order_id
        tok, _ = buyer_login
        body = {"rating": 4, "rating_pelayanan": 99, "rating_pengiriman": 0,
                "komentar": "clamp test"}
        r = requests.post(f"{API}/orders/{oid}/review", json=body,
                          headers=_hdr(tok), timeout=20)
        assert r.status_code == 200, r.text
        rv = (r.json().get("review") or {})
        assert rv.get("rating_pelayanan") is None
        assert rv.get("rating_pengiriman") is None

    def test_product_reviews_endpoint(self, admin_token, buyer_login):
        # Restore valid satisfaction so endpoint averages are populated
        oid = TestSatisfactionReviews._order_id
        pid = TestSatisfactionReviews._product_id
        tok, _ = buyer_login
        requests.post(f"{API}/orders/{oid}/review",
                      json={"rating": 5, "rating_pelayanan": 4,
                            "rating_pengiriman": 5, "komentar": "ok"},
                      headers=_hdr(tok), timeout=20)
        r = requests.get(f"{API}/products/{pid}/reviews", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "average" in data and "count" in data
        assert "average_pelayanan" in data
        assert "average_pengiriman" in data
        assert isinstance(data.get("items"), list)
        if data["items"]:
            item = data["items"][0]
            assert "rating_pelayanan" in item
            assert "rating_pengiriman" in item

    def test_product_rating_reflected_in_product_detail(self):
        pid = TestSatisfactionReviews._product_id
        r = requests.get(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 200
        p = r.json()
        assert p.get("rating_count", 0) >= 1
        assert p.get("rating", 0) >= 1

    @classmethod
    def teardown_class(cls):
        # No admin delete orders endpoint; leave test orders (prefixed test data) in place.
        pass
