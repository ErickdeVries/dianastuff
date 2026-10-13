"""Iter32 — Biteship x manual-payment END-TO-END tests.

Scope (per review_request):
  * E2E courier×manual payment flow (menunggu_pembayaran → menunggu_konfirmasi →
    sedang_dikemas → dikirim (AUTO-BOOK Biteship, no_resi becomes waybill,
    biteship_order_id persisted) → /track returns tracked:true → /terima →
    selesai).
  * Manual-resi fallback: order WITHOUT courier/coord requires no_resi in body
    (400 when missing, 200 when provided, no Biteship call).
  * Biteship webhook flips 'dikirim' orders to 'selesai' on delivered + unknown
    order returns {ok:true}; no auth required.
  * /orders/{id}/track by a non-owner buyer → 403.
  * /shipping/rates (buyer) with destination + items returns pricing OR
    structured 402 (reported).
  * Admin /orders list exposes no_resi + biteship_* fields on shipped order.
  * Soft-cleanup of created orders via direct Mongo write at end.

Biteship key is biteship_test. Topped-up balance so Rates/Orders now work.
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://diana-store-2.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _ah(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_token(http):
    r = http.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_token(http):
    r = http.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"})
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text[:200]}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_me_patched(http, buyer_token):
    """Ensure buyer has nama/wa/alamat/kota + latitude/longitude set."""
    payload = {
        "nama": "TEST Iter32 Buyer",
        "wa": "081200012345",
        "alamat": "TEST Jl. Pin Point 10",
        "kota": "Jakarta Selatan",
        "kode_pos": "12730",
        "latitude": -6.2615,
        "longitude": 106.8106,
    }
    r = http.put(f"{API}/me", json=payload, headers=_ah(buyer_token))
    assert r.status_code == 200, r.text[:200]
    return payload


@pytest.fixture(scope="module")
def second_buyer_token(http, admin_token, mongo):
    """Register a second buyer, approve via Mongo, log in. If anything fails,
    return None so the 403 test is skipped (not failed)."""
    import secrets
    uname = f"test_iter32_{secrets.token_hex(3)}"
    pwd = "testpass123"
    r = http.post(f"{API}/auth/register-whitelist", json={
        "username": uname, "password": pwd, "nama": "TEST Iter32 Second Buyer",
        "wa": "081200099999",
    })
    if r.status_code not in (200, 201):
        return None
    # approve via Mongo
    mongo.users.update_one({"username": uname}, {"$set": {"status": "approved"}})
    r = http.post(f"{API}/auth/login-whitelist", json={"username": uname, "password": pwd})
    if r.status_code != 200:
        return None
    tok = r.json().get("session_token")
    # Record for cleanup
    second_buyer_token._cleanup_username = uname  # type: ignore
    return tok


# Shared mutable state across tests (we need the E2E chain to be stateful).
STATE: dict = {
    "biteship_order_id": None,
    "manual_order_id": None,
    "created_order_ids": [],
}


# ---------------------------------------------------------------------------
# 1. E2E courier × manual-payment
# ---------------------------------------------------------------------------
class TestBiteshipE2E:
    def test_a_create_order_with_courier_and_coord(self, http, buyer_token, buyer_me_patched):
        prods = http.get(f"{API}/products").json()
        if not prods:
            pytest.skip("no products available")
        prod = prods[0]
        payload = {
            "items": [{"product_id": prod["id"], "qty": 1}],
            "kurir": "JNE",
            "ongkir": 15000,
            "catatan": "TEST_iter32_e2e",
            "shipping_coordinate": {"latitude": -6.1382, "longitude": 106.8286},
            "courier_company": "jne",
            "courier_type": "reg",
        }
        r = http.post(f"{API}/orders", json=payload, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        oid = d.get("id")
        assert oid, f"no id in response: {d}"
        STATE["biteship_order_id"] = oid
        STATE["created_order_ids"].append(oid)
        assert d["status"] == "menunggu_pembayaran"
        # order_public exposes courier fields (per iter31 action item)
        assert d.get("courier_company") == "jne"
        assert d.get("courier_type") == "reg"

    def test_b_upload_bukti_moves_to_konfirmasi(self, http, buyer_token):
        oid = STATE["biteship_order_id"]
        assert oid
        r = http.post(
            f"{API}/orders/{oid}/bukti",
            json={"bukti_bayar_url": "https://example.com/bukti/test.jpg"},
            headers=_ah(buyer_token),
        )
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "menunggu_konfirmasi"

    def test_c_admin_set_sedang_dikemas(self, http, admin_token):
        oid = STATE["biteship_order_id"]
        r = http.put(
            f"{API}/orders/{oid}/status",
            json={"status": "sedang_dikemas"},
            headers=_ah(admin_token),
        )
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "sedang_dikemas"

    def test_d_admin_set_dikirim_autobooks_biteship(self, http, admin_token):
        oid = STATE["biteship_order_id"]
        # NO no_resi in body — must auto-book via Biteship because
        # shipping_coordinate + courier_company are present.
        r = http.put(
            f"{API}/orders/{oid}/status",
            json={"status": "dikirim"},
            headers=_ah(admin_token),
        )
        assert r.status_code == 200, f"status update failed: {r.status_code} {r.text[:500]}"
        d = r.json()
        assert d.get("status") == "dikirim"
        assert d.get("no_resi"), f"expected non-empty no_resi after auto-book, got: {d}"
        assert d.get("biteship_order_id"), f"expected biteship_order_id in order_public, got: {d}"
        STATE["waybill"] = d["no_resi"]
        STATE["biteship_oid"] = d["biteship_order_id"]

    def test_e_admin_orders_lists_biteship_fields(self, http, admin_token):
        """GET /orders (admin) must include our shipped order with no_resi +
        biteship_order_id visible."""
        r = http.get(f"{API}/orders", headers=_ah(admin_token))
        assert r.status_code == 200
        oid = STATE["biteship_order_id"]
        mine = next((o for o in r.json() if o.get("id") == oid), None)
        assert mine is not None, "shipped order not listed"
        assert mine.get("no_resi")
        assert mine.get("biteship_order_id")
        assert mine.get("courier_company") == "jne"

    def test_f_track_returns_history(self, http, buyer_token):
        oid = STATE["biteship_order_id"]
        # Biteship may take a moment to register tracking data
        time.sleep(2)
        r = http.get(f"{API}/orders/{oid}/track", headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("tracked") is True, f"expected tracked:true, got: {d}"
        assert "status" in d
        assert "history" in d and isinstance(d["history"], list)

    def test_g_track_by_different_buyer_is_403(self, http, second_buyer_token):
        if not second_buyer_token:
            pytest.skip("could not create/approve second buyer")
        oid = STATE["biteship_order_id"]
        r = http.get(f"{API}/orders/{oid}/track", headers=_ah(second_buyer_token))
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_h_buyer_terima_moves_to_selesai(self, http, buyer_token):
        oid = STATE["biteship_order_id"]
        r = http.post(f"{API}/orders/{oid}/terima", headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "selesai"


# ---------------------------------------------------------------------------
# 2. Manual-resi fallback (no courier_company, no shipping_coordinate)
# ---------------------------------------------------------------------------
class TestManualResiFallback:
    def test_a_create_order_without_courier(self, http, buyer_token, buyer_me_patched):
        prods = http.get(f"{API}/products").json()
        if not prods:
            pytest.skip("no products")
        payload = {
            "items": [{"product_id": prods[0]["id"], "qty": 1}],
            "kurir": "JNE",
            "ongkir": 15000,
            "catatan": "TEST_iter32_manual",
            # NO shipping_coordinate / courier_company / courier_type
        }
        r = http.post(f"{API}/orders", json=payload, headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:300]
        oid = r.json()["id"]
        STATE["manual_order_id"] = oid
        STATE["created_order_ids"].append(oid)

    def test_b_pay_and_pack(self, http, buyer_token, admin_token):
        oid = STATE["manual_order_id"]
        r = http.post(f"{API}/orders/{oid}/bukti",
                      json={"bukti_bayar_url": "https://example.com/bukti/x.jpg"},
                      headers=_ah(buyer_token))
        assert r.status_code == 200
        r = http.put(f"{API}/orders/{oid}/status",
                     json={"status": "sedang_dikemas"},
                     headers=_ah(admin_token))
        assert r.status_code == 200

    def test_c_dikirim_without_resi_returns_400(self, http, admin_token):
        oid = STATE["manual_order_id"]
        r = http.put(f"{API}/orders/{oid}/status",
                     json={"status": "dikirim"},
                     headers=_ah(admin_token))
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = (r.json().get("detail") or "").lower()
        assert "resi" in detail, f"expected resi-related error, got: {detail}"

    def test_d_dikirim_with_resi_succeeds(self, http, admin_token):
        oid = STATE["manual_order_id"]
        r = http.put(f"{API}/orders/{oid}/status",
                     json={"status": "dikirim", "no_resi": "MANUALTEST12345"},
                     headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("status") == "dikirim"
        assert d.get("no_resi") == "MANUALTEST12345"
        # Should NOT be a Biteship booking
        assert not d.get("biteship_order_id"), "manual-resi order must not have biteship_order_id"


# ---------------------------------------------------------------------------
# 3. Biteship webhook
# ---------------------------------------------------------------------------
class TestBiteshipWebhook:
    def test_a_unknown_order_returns_ok(self, http):
        # No auth required for Biteship webhook.
        r = http.post(
            f"{API}/biteship/webhook",
            json={"order_id": "does-not-exist", "status": "delivered", "waybill_id": "x"},
        )
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("ok") is True

    def test_b_delivered_webhook_flips_to_selesai_and_updates_resi(self, http, buyer_token, admin_token, buyer_me_patched):
        """Create a fresh order, ship it (auto-book Biteship), then POST webhook
        {status:'delivered'} with the biteship_order_id. Order should become
        'selesai' and no_resi should reflect the webhook's waybill_id."""
        prods = http.get(f"{API}/products").json()
        if not prods:
            pytest.skip("no products")
        r = http.post(f"{API}/orders", json={
            "items": [{"product_id": prods[0]["id"], "qty": 1}],
            "kurir": "JNE", "ongkir": 15000, "catatan": "TEST_iter32_webhook",
            "shipping_coordinate": {"latitude": -6.1382, "longitude": 106.8286},
            "courier_company": "jne", "courier_type": "reg",
        }, headers=_ah(buyer_token))
        assert r.status_code == 200
        oid = r.json()["id"]
        STATE["created_order_ids"].append(oid)
        # mark bukti to allow transitions through
        http.post(f"{API}/orders/{oid}/bukti",
                  json={"bukti_bayar_url": "https://example.com/b.jpg"},
                  headers=_ah(buyer_token))
        http.put(f"{API}/orders/{oid}/status", json={"status": "sedang_dikemas"},
                 headers=_ah(admin_token))
        r = http.put(f"{API}/orders/{oid}/status", json={"status": "dikirim"},
                     headers=_ah(admin_token))
        assert r.status_code == 200, r.text[:300]
        shipped = r.json()
        bs_oid = shipped.get("biteship_order_id")
        assert bs_oid, "no biteship_order_id after auto-book"

        new_waybill = f"WYB-HOOK-{uuid.uuid4().hex[:8].upper()}"
        r = http.post(f"{API}/biteship/webhook", json={
            "order_id": bs_oid,
            "status": "delivered",
            "waybill_id": new_waybill,
        })
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("ok") is True
        # Verify DB state via API
        time.sleep(0.5)
        r = http.get(f"{API}/orders/{oid}", headers=_ah(buyer_token))
        assert r.status_code == 200, r.text[:200]
        after = r.json()
        assert after.get("status") == "selesai", f"expected selesai, got {after.get('status')}"
        assert after.get("no_resi") == new_waybill, f"webhook did not update resi: {after}"


# ---------------------------------------------------------------------------
# 4. Rates endpoint — balance topped up, should return pricing OR 402
# ---------------------------------------------------------------------------
class TestShippingRates:
    def test_rates_returns_pricing_or_402(self, http, buyer_token, buyer_me_patched):
        r = http.post(f"{API}/shipping/rates", json={
            "destination_latitude": -6.1382,
            "destination_longitude": 106.8286,
            "items": [{"name": "Barang", "value": 50000, "length": 10, "width": 10,
                       "height": 10, "weight": 500, "quantity": 1}],
        }, headers=_ah(buyer_token))
        if r.status_code == 200:
            data = r.json()
            pricing = data.get("pricing") or []
            assert isinstance(pricing, list), f"pricing not list: {data}"
            assert len(pricing) >= 1, f"expected at least 1 courier, got: {data}"
            # Each courier row has company/type fields.
            sample = pricing[0]
            assert "courier_company" in sample or "company" in sample or sample.get("courier_code")
            print(f"RATES OK — {len(pricing)} couriers returned")
        elif r.status_code == 402:
            pytest.fail(f"RATES RETURNED 402 (balance empty): {r.text[:300]}")
        else:
            # 502 means Cloudflare swallowed JSON — flag with details
            pytest.fail(f"RATES FAILED status={r.status_code}: {r.text[:300]}")


# ---------------------------------------------------------------------------
# 5. Cleanup — soft-delete every TEST order created above via Mongo
# ---------------------------------------------------------------------------
class TestZZCleanup:
    def test_soft_delete_all_test_orders(self, mongo, http, admin_token):
        from datetime import datetime, timezone
        if not STATE["created_order_ids"]:
            pytest.skip("nothing to clean")
        result = mongo.orders.update_many(
            {"id": {"$in": STATE["created_order_ids"]}, "deleted_at": None},
            {"$set": {"deleted_at": datetime.now(timezone.utc)}},
        )
        print(f"Soft-deleted {result.modified_count}/{len(STATE['created_order_ids'])} test orders")
        # Verify they no longer appear in admin /orders
        r = http.get(f"{API}/orders", headers=_ah(admin_token))
        assert r.status_code == 200
        visible = {o.get("id") for o in r.json()}
        for oid in STATE["created_order_ids"]:
            assert oid not in visible, f"order {oid} still visible after soft-delete"

    def test_cleanup_second_buyer(self, mongo):
        uname = getattr(pytest, "_iter32_second_user", None)
        # Attempt cleanup via module-level attribute stashed on the fn
        # (best-effort — not critical).
        if hasattr(TestBiteshipE2E, "_second_user"):
            uname = getattr(TestBiteshipE2E, "_second_user")
        # Hunt for TEST_iter32_* users and remove them.
        res = mongo.users.delete_many({"username": {"$regex": "^test_iter32_"}})
        print(f"Deleted {res.deleted_count} test users")
