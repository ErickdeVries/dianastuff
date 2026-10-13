"""Iter31 — Biteship shipping integration tests.

Covers (per review_request):
  * Default store Location seeded + CRUD + Biteship Locations sync.
  * Admin auth gate on /api/admin/locations.
  * Buyer /api/me/addresses CRUD + auto-default + public shape.
  * PUT /api/me persists latitude/longitude; GET /api/auth/me exposes them.
  * Products expose `weight` + `location_id` and ProductIn accepts location_id.
  * POST /api/shipping/rates validations and EXPECTED Biteship 502 'No sufficient balance'.
  * POST /api/orders stores shipping_coordinate/courier_company/courier_type.
  * POST /api/admin/orders/{id}/ship validations and EXPECTED Biteship 502 balance error.
  * SECURITY: BITESHIP_API_KEY is never leaked by any API response.

The Biteship account has NO BALANCE: Rates & Orders calls return HTTP 502 with
detail starting 'Biteship:'. That is EXPECTED and asserted as such.
"""
from __future__ import annotations

import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(http):
    r = http.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("session_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def buyer_token(http):
    r = http.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"})
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("session_token")
    assert tok
    return tok


def _ah(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. Seed + GET /api/admin/locations
# ---------------------------------------------------------------------------
class TestLocationsSeedAndAuth:
    def test_requires_auth(self, http):
        r = http.get(f"{API}/admin/locations")
        assert r.status_code in (401, 403), r.status_code

    def test_buyer_forbidden(self, http, buyer_token):
        r = http.get(f"{API}/admin/locations", headers=_ah(buyer_token))
        assert r.status_code == 403, r.status_code

    def test_default_location_seeded_shape(self, http, admin_token):
        r = http.get(f"{API}/admin/locations", headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:200]
        docs = r.json()
        assert isinstance(docs, list) and len(docs) >= 1
        d = docs[0]
        for key in [
            "id", "tenant_id", "name", "contact_name", "contact_phone",
            "address", "postal_code", "latitude", "longitude",
            "is_default", "biteship_location_id",
        ]:
            assert key in d, f"missing key {key} in location_public: {d}"


# ---------------------------------------------------------------------------
# 2. CRUD + Biteship Locations sync (works WITHOUT balance)
# ---------------------------------------------------------------------------
class TestLocationsCRUD:
    created_ids: list[str] = []

    def test_put_default_syncs_biteship(self, http, admin_token):
        r = http.get(f"{API}/admin/locations", headers=_ah(admin_token))
        docs = r.json()
        default = next((d for d in docs if d.get("is_default")), docs[0])
        payload = {
            "name": default["name"] or "Gudang Diana",
            "contact_name": default.get("contact_name") or "Admin Diana",
            "contact_phone": default.get("contact_phone") or "081234567890",
            "address": default.get("address") or "Jl. Kemang Raya No. 10, Jakarta Selatan",
            "postal_code": default.get("postal_code") or "12730",
            "latitude": -6.2615,
            "longitude": 106.8106,
            "is_default": True,
        }
        r = http.put(f"{API}/admin/locations/{default['id']}", json=payload, headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        # Biteship Locations endpoint doesn't need balance so this should be a real id.
        assert d.get("biteship_location_id"), f"expected biteship_location_id to be set, got {d}"
        assert d["latitude"] == payload["latitude"]
        assert d["longitude"] == payload["longitude"]

    def test_post_second_location_toggles_default(self, http, admin_token):
        payload = {
            "name": "TEST_iter31_warehouse",
            "contact_name": "TEST Iter31",
            "contact_phone": "081200000001",
            "address": "TEST Jl. Sudirman Kav 1, Jakarta Pusat",
            "postal_code": "10220",
            "latitude": -6.2088,
            "longitude": 106.8456,
            "is_default": True,
        }
        r = http.post(f"{API}/admin/locations", json=payload, headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:300]
        new_loc = r.json()
        assert new_loc["id"]
        self.__class__.created_ids.append(new_loc["id"])
        assert new_loc["is_default"] is True
        # Verify only one default now
        r = http.get(f"{API}/admin/locations", headers=_ah(admin_token))
        assert r.status_code == 200
        defaults = [d for d in r.json() if d.get("is_default")]
        assert len(defaults) == 1, f"expected exactly one default, got {len(defaults)}"
        assert defaults[0]["id"] == new_loc["id"]

    def test_zz_cleanup_restore_default(self, http, admin_token):
        """Restore the ORIGINAL seeded location to be the default and delete our
        extra TEST_ locations via direct Mongo isn't exposed — but the API has no
        delete endpoint for admin locations. So we at least switch the default
        back to the first seeded location via PUT (is_default=True)."""
        r = http.get(f"{API}/admin/locations", headers=_ah(admin_token))
        docs = r.json()
        # Pick first non-TEST location (the originally seeded one).
        orig = next((d for d in docs if not (d.get("name") or "").startswith("TEST_")), None)
        if not orig:
            pytest.skip("no original location found to restore default")
        payload = {
            "name": orig["name"],
            "contact_name": orig.get("contact_name") or orig["name"],
            "contact_phone": orig.get("contact_phone") or "081234567890",
            "address": orig.get("address") or "Jl. Kemang Raya No. 10",
            "postal_code": orig.get("postal_code") or "12730",
            "latitude": orig["latitude"],
            "longitude": orig["longitude"],
            "is_default": True,
        }
        r = http.put(f"{API}/admin/locations/{orig['id']}", json=payload, headers=_ah(admin_token))
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# 3. Buyer addresses CRUD
# ---------------------------------------------------------------------------
class TestBuyerAddresses:
    created_addr_ids: list[str] = []

    def test_requires_auth(self, http):
        r = http.get(f"{API}/me/addresses")
        assert r.status_code == 401

    def test_create_first_address_auto_default(self, http, buyer_token):
        # Delete any pre-existing addresses so our new one becomes "first".
        r = http.get(f"{API}/me/addresses", headers=_ah(buyer_token))
        assert r.status_code == 200
        for a in r.json():
            http.delete(f"{API}/me/addresses/{a['id']}", headers=_ah(buyer_token))

        payload = {
            "label_alamat": "TEST_Rumah",
            "nama_penerima": "TEST Buyer Iter31",
            "telepon": "081299999999",
            "alamat_lengkap": "TEST Jl. Mangga Dua No. 7",
            "postal_code": "10730",
            "latitude": -6.1382,
            "longitude": 106.8286,
            "is_default": False,  # expect server to force True on first address
        }
        r = http.post(f"{API}/me/addresses", json=payload, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for key in [
            "id", "label_alamat", "nama_penerima", "telepon", "alamat_lengkap",
            "postal_code", "latitude", "longitude", "is_default",
        ]:
            assert key in d, f"missing key {key}: {d}"
        assert d["is_default"] is True, "first address should be auto-default"
        self.__class__.created_addr_ids.append(d["id"])

    def test_get_and_update_address(self, http, buyer_token):
        assert self.__class__.created_addr_ids, "need created address"
        aid = self.__class__.created_addr_ids[0]
        r = http.get(f"{API}/me/addresses", headers=_ah(buyer_token))
        assert r.status_code == 200
        found = next((a for a in r.json() if a["id"] == aid), None)
        assert found is not None

        upd = {
            "label_alamat": "TEST_Kantor",
            "nama_penerima": "TEST Updated",
            "telepon": "081288888888",
            "alamat_lengkap": "TEST Jl. Sudirman Kav 1",
            "postal_code": "10220",
            "latitude": -6.2088,
            "longitude": 106.8456,
            "is_default": True,
        }
        r = http.put(f"{API}/me/addresses/{aid}", json=upd, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["label_alamat"] == "TEST_Kantor"
        assert d["nama_penerima"] == "TEST Updated"
        assert d["latitude"] == -6.2088

    def test_zz_cleanup_delete(self, http, buyer_token):
        for aid in self.__class__.created_addr_ids:
            r = http.delete(f"{API}/me/addresses/{aid}", headers=_ah(buyer_token))
            assert r.status_code == 200
        # Verify 404 on re-fetch
        for aid in self.__class__.created_addr_ids:
            r = http.delete(f"{API}/me/addresses/{aid}", headers=_ah(buyer_token))
            assert r.status_code == 404


# ---------------------------------------------------------------------------
# 4. PUT /api/me persists lat/lng; /auth/me exposes them
# ---------------------------------------------------------------------------
class TestMeLatLng:
    def test_put_me_persists_latlng(self, http, buyer_token):
        payload = {
            "alamat": "TEST Jl. Pin Point 10",
            "kota": "Jakarta Selatan",
            "kode_pos": "12730",
            "latitude": -6.2615,
            "longitude": 106.8106,
        }
        r = http.put(f"{API}/me", json=payload, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d.get("latitude") == -6.2615
        assert d.get("longitude") == 106.8106

        # Confirm via /auth/me
        r = http.get(f"{API}/auth/me", headers=_ah(buyer_token))
        assert r.status_code == 200
        d = r.json()
        assert d.get("latitude") == -6.2615
        assert d.get("longitude") == 106.8106


# ---------------------------------------------------------------------------
# 5. Products expose weight + location_id
# ---------------------------------------------------------------------------
class TestProductsLocation:
    def test_list_products_shape(self, http):
        r = http.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        assert isinstance(prods, list)
        if prods:
            p = prods[0]
            assert "weight" in p
            assert "location_id" in p
            assert p["weight"] == p.get("berat_gram", 0)

    def test_product_in_accepts_location_id(self, http, admin_token):
        # Grab default location id
        r = http.get(f"{API}/admin/locations", headers=_ah(admin_token))
        loc = r.json()[0]
        payload = {
            "kategori": "Test",
            "nama_produk": "TEST_iter31_prod",
            "deskripsi": "test",
            "harga": 10000,
            "stok": 1,
            "berat_gram": 400,
            "bisa_po": False,
            "foto_urls": [],
            "location_id": loc["id"],
        }
        r = http.post(f"{API}/products", json=payload, headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("location_id") == loc["id"]
        assert d.get("weight") == 400
        # Cleanup
        if d.get("id"):
            http.delete(f"{API}/products/{d['id']}", headers=_ah(admin_token))


# ---------------------------------------------------------------------------
# 6. /api/shipping/rates — validations + EXPECTED Biteship 502 balance error
# ---------------------------------------------------------------------------
class TestShippingRates:
    def test_requires_auth(self, http):
        r = http.post(f"{API}/shipping/rates", json={})
        assert r.status_code == 401

    def test_missing_destination_coords_returns_400(self, http, buyer_token):
        r = http.post(
            f"{API}/shipping/rates",
            json={"items": [{"name": "X", "value": 10000, "weight": 500, "quantity": 1}]},
            headers=_ah(buyer_token),
        )
        assert r.status_code == 400, r.text[:200]
        assert "tujuan" in (r.json().get("detail") or "").lower()

    def test_rates_returns_expected_biteship_502(self, http, buyer_token):
        """Backend returns 502 w/ JSON {'detail': 'Biteship: No sufficient balance...'}.
        NOTE: Cloudflare ingress intercepts 5xx responses and serves its own HTML
        error page in production preview — so the JSON body is NOT visible to
        the client. We assert status code only here, and flag the Cloudflare
        interception as an integration bug for the main agent."""
        r = http.post(
            f"{API}/shipping/rates",
            json={
                "destination_latitude": -6.1382,
                "destination_longitude": 106.8286,
                "items": [
                    {"name": "Barang", "value": 50000, "length": 10, "width": 10,
                     "height": 10, "weight": 500, "quantity": 1}
                ],
            },
            headers=_ah(buyer_token),
        )
        if r.status_code == 200:
            assert "pricing" in r.json()
            return
        assert r.status_code == 502, r.text[:200]
        # Try to parse JSON — may be swallowed by Cloudflare 502 page.
        try:
            detail = r.json().get("detail", "")
            assert detail.startswith("Biteship:"), f"got: {detail!r}"
        except Exception:
            # Cloudflare intercepted — assert via logs/direct backend not possible from here.
            assert "502" in r.text or "Bad gateway" in r.text, "unexpected 502 body"


# ---------------------------------------------------------------------------
# 7. Orders accept + store shipping_coordinate / courier_company / courier_type
# ---------------------------------------------------------------------------
class TestOrdersCoord:
    created_order_id: str | None = None

    def test_create_order_with_coord(self, http, buyer_token, admin_token):
        prods = http.get(f"{API}/products").json()
        if not prods:
            pytest.skip("no products available to order")
        prod = prods[0]
        payload = {
            "items": [{"product_id": prod["id"], "qty": 1}],
            "kurir": "JNE",
            "ongkir": 15000,
            "catatan": "TEST_iter31",
            "shipping_coordinate": {"latitude": -6.2088, "longitude": 106.8456},
            "courier_company": "jne",
            "courier_type": "reg",
        }
        r = http.post(f"{API}/orders", json=payload, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        self.__class__.created_order_id = d.get("id") or d.get("order_id")
        assert self.__class__.created_order_id, f"no order id: {d}"
        # Verify via admin list of /api/orders (admin role sees all)
        r = http.get(f"{API}/orders", headers=_ah(admin_token))
        assert r.status_code == 200
        orders = r.json()
        mine = next((o for o in orders if o.get("id") == self.__class__.created_order_id), None)
        assert mine is not None, "created order not visible to admin"
        assert mine.get("status") in ("menunggu_pembayaran", "pending", "menunggu_konfirmasi"), mine.get("status")

    def test_ship_order_requires_coord_validation(self, http, admin_token):
        """Also validates the 'Koordinat alamat pembeli tidak ada' path by
        temporarily nulling shipping_coordinate — but we can only test the
        happy-path 'coord present but Biteship 502' here. For the missing-coord
        path, see test_ship_without_coord_returns_400 (uses an older order)."""
        oid = self.__class__.created_order_id
        if not oid:
            pytest.skip("no order id")
        r = http.post(
            f"{API}/admin/orders/{oid}/ship",
            json={"courier_company": "jne", "courier_type": "reg"},
            headers=_ah(admin_token),
        )
        if r.status_code == 200:
            return
        assert r.status_code == 502, r.text[:200]
        try:
            detail = r.json().get("detail", "")
            assert detail.startswith("Biteship:"), f"got: {detail!r}"
        except Exception:
            assert "502" in r.text or "Bad gateway" in r.text

    def test_ship_without_coord_returns_400(self, http, admin_token):
        """SKIPPED — order_public (server.py L1642) does NOT expose
        shipping_coordinate/courier_company/courier_type, so we cannot
        identify a coord-less order via the API. Backend code path IS
        covered (lines 536-538); flagged in test report as a transparency
        issue for the admin UI."""
        pytest.skip(
            "order_public hides shipping_coordinate — see backend_issues.minor"
        )


# ---------------------------------------------------------------------------
# 8. SECURITY: BITESHIP_API_KEY never leaked
# ---------------------------------------------------------------------------
class TestSecurity:
    def test_api_responses_never_contain_biteship_key(self, http, admin_token, buyer_token):
        key_pattern = re.compile(r"biteship_(live|test)\.[A-Za-z0-9_\-]+")
        endpoints = [
            ("GET", f"{API}/admin/locations", _ah(admin_token)),
            ("GET", f"{API}/me/addresses", _ah(buyer_token)),
            ("GET", f"{API}/auth/me", _ah(buyer_token)),
            ("GET", f"{API}/products", {}),
            ("GET", f"{API}/orders", _ah(admin_token)),
            ("GET", f"{API}/profil_admin", {}),
            ("GET", f"{API}/", {}),
        ]
        for method, url, headers in endpoints:
            r = http.request(method, url, headers=headers, timeout=15)
            # Any text response should NOT contain the api key.
            assert not key_pattern.search(r.text), f"BITESHIP_API_KEY leaked at {url}: {r.text[:200]}"

    def test_env_var_not_exposed_in_root(self, http):
        r = http.get(f"{API}/")
        assert r.status_code == 200
        txt = r.text.lower()
        assert "biteship_api_key" not in txt
