"""iter35 — shipping settings, Biteship rates filtering + subsidy, product
variations, and ordering with variations/insurance.

Requires `admin/admin123` and `buyer/buyer123` whitelist seeds. Buyer must have a
delivery address with coordinates (seeded via PUT /api/user/alamat).
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ["EXPO_BACKEND_URL"]
BASE_URL = BASE_URL.rstrip("/")


# --- auth fixtures ----------------------------------------------------------

def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": username, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_headers():
    tok = _login("admin", "admin123")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def buyer_headers():
    tok = _login("buyer", "buyer123")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def ensure_buyer_address(buyer_headers):
    # ensure buyer has a shipping address (needed for /orders)
    me = requests.get(f"{BASE_URL}/api/me", headers=buyer_headers, timeout=15).json()
    if not me.get("alamat") or not me.get("kota"):
        requests.put(
            f"{BASE_URL}/api/user/alamat",
            headers=buyer_headers,
            json={
                "nama": me.get("nama") or "Buyer Test",
                "wa": me.get("wa") or "081234567890",
                "alamat": "Jl. Test 123",
                "kota": "Jakarta",
                "kode_pos": "12345",
                "latitude": -6.2088,
                "longitude": 106.8456,
            },
            timeout=15,
        )


# --- 1) shipping-settings + rates filtering + subsidy -----------------------

class TestShippingSettingsAndRates:
    def test_get_shipping_settings_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-settings", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("enabled_couriers", "subsidy_mode", "subsidy_amount", "all_couriers"):
            assert key in data, f"missing {key}"
        assert isinstance(data["all_couriers"], list) and len(data["all_couriers"]) == 8

    def test_put_settings_discount_persists(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/shipping-settings",
            headers=admin_headers,
            json={"enabled_couriers": ["jne", "jnt"], "subsidy_mode": "discount", "subsidy_amount": 5000},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/admin/shipping-settings", headers=admin_headers, timeout=15).json()
        assert set(g["enabled_couriers"]) == {"jne", "jnt"}
        assert g["subsidy_mode"] == "discount"
        assert g["subsidy_amount"] == 5000

    def test_rates_discount_mode(self, admin_headers, buyer_headers):
        # settings already applied in previous test (module order)
        payload = {
            "destination_latitude": -6.2088,
            "destination_longitude": 106.8456,
            "items": [{"name": "T", "value": 89000, "length": 15, "width": 15, "height": 10, "weight": 500, "quantity": 1}],
        }
        r = requests.post(f"{BASE_URL}/api/shipping/rates", headers=buyer_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("subsidy_mode") == "discount"
        pricing = data.get("pricing") or []
        assert len(pricing) > 0, "no pricing returned"
        couriers = {(p.get("courier_code") or "").lower() for p in pricing}
        # only jne/jnt should remain
        assert couriers.issubset({"jne", "jnt"}), f"unexpected couriers: {couriers}"
        # fields present per item
        for p in pricing:
            for k in ("price_asli", "price", "subsidi", "duration", "available_for_insurance"):
                assert k in p, f"missing field {k} in pricing item"
            # price = max(0, price_asli - 5000) and subsidi<=5000
            expected = max(0, p["price_asli"] - 5000)
            assert p["price"] == expected, f"price mismatch {p}"
            assert p["subsidi"] == min(5000, p["price_asli"])
            # insurance_fee key exists when available
            if p.get("available_for_insurance"):
                assert "insurance_fee" in p

    def test_rates_free_mode(self, admin_headers, buyer_headers):
        requests.put(
            f"{BASE_URL}/api/admin/shipping-settings",
            headers=admin_headers,
            json={"enabled_couriers": ["jne", "jnt"], "subsidy_mode": "free", "subsidy_amount": 0},
            timeout=15,
        )
        r = requests.post(
            f"{BASE_URL}/api/shipping/rates",
            headers=buyer_headers,
            json={
                "destination_latitude": -6.2088,
                "destination_longitude": 106.8456,
                "items": [{"name": "T", "value": 89000, "length": 15, "width": 15, "height": 10, "weight": 500, "quantity": 1}],
            },
            timeout=30,
        ).json()
        assert r.get("subsidy_mode") == "free"
        for p in r.get("pricing", []):
            assert p["price"] == 0, f"free mode should zero price: {p}"
            assert p["subsidi"] == p["price_asli"]

    def test_reset_settings(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/shipping-settings",
            headers=admin_headers,
            json={"enabled_couriers": [], "subsidy_mode": "none", "subsidy_amount": 0},
            timeout=15,
        )
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/admin/shipping-settings", headers=admin_headers, timeout=15).json()
        # empty enabled_couriers => defaults to all 8
        assert len(g["enabled_couriers"]) == 8
        assert g["subsidy_mode"] == "none"
        assert g["subsidy_amount"] == 0


# --- 2 + 3 + 4) variations product lifecycle --------------------------------

@pytest.fixture(scope="module")
def variation_product(admin_headers):
    payload = {
        "nama_produk": "TEST_Variasi_iter35",
        "kategori": "Test",
        "deskripsi": "iter35 variation product",
        "harga": 0,
        "stok": 0,
        "berat_gram": 500,
        "bisa_po": False,
        "has_variations": True,
        "variations": [
            {"name": "Warna", "options": ["Merah", "Biru"]},
            {"name": "Ukuran", "options": ["S", "M"]},
        ],
        "combinations": [
            {"options": ["Merah", "S"], "harga": 100000, "harga_diskon": 80000, "stok": 5, "foto": "/api/files/x.jpg"},
            {"options": ["Merah", "M"], "harga": 110000, "stok": 3},
            {"options": ["Biru", "S"], "harga": 105000, "stok": 0},
            {"options": ["Biru", "M"], "harga": 115000, "stok": 2},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/products", headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    # cleanup
    requests.delete(f"{BASE_URL}/api/products/{pid}", headers=admin_headers, timeout=15)


class TestVariationProduct:
    def test_product_public_has_aggregates(self, variation_product):
        r = requests.get(f"{BASE_URL}/api/products/{variation_product}", timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["has_variations"] is True
        assert p["harga_final"] == 80000, f"harga_final={p['harga_final']}"
        assert p["harga_max"] == 115000, f"harga_max={p['harga_max']}"
        assert p["stok"] == 10, f"stok sum={p['stok']}"
        assert len(p["combinations"]) == 4

    def test_order_with_variation(self, variation_product, buyer_headers):
        payload = {
            "items": [{"product_id": variation_product, "qty": 2, "variation_key": "Merah|S"}],
            "ongkir": 10000,
            "asuransi": True,
            "asuransi_fee": 2500,
        }
        r = requests.post(f"{BASE_URL}/api/orders", headers=buyer_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()
        it = order["items"][0]
        assert it["harga"] == 80000, f"item.harga={it['harga']}"
        assert it["variation_label"] == "Merah, S"
        assert order["subtotal"] == 160000
        assert order["asuransi_fee"] == 2500
        assert order["total"] == 172500, f"total={order['total']}"

        # stok Merah|S should drop 5 -> 3
        p = requests.get(f"{BASE_URL}/api/products/{variation_product}", timeout=15).json()
        merah_s = next(c for c in p["combinations"] if c["options"] == ["Merah", "S"])
        assert merah_s["stok"] == 3, f"stok after decrement={merah_s['stok']}"

    def test_order_without_variation_key_rejected(self, variation_product, buyer_headers):
        r = requests.post(
            f"{BASE_URL}/api/orders",
            headers=buyer_headers,
            json={"items": [{"product_id": variation_product, "qty": 1}], "ongkir": 0},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_order_variation_zero_stock_rejected(self, variation_product, buyer_headers):
        r = requests.post(
            f"{BASE_URL}/api/orders",
            headers=buyer_headers,
            json={"items": [{"product_id": variation_product, "qty": 1, "variation_key": "Biru|S"}], "ongkir": 0},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
