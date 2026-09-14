"""Backend tests for Live Shopping (Agora) endpoints — iteration 17.

Covered flows:
- GET  /api/live/current (public)                            → live:false when none
- POST /api/live/start   (admin only)                        → starts a show
- GET  /api/live/current                                     → live:true + products
- POST /api/live/start   (again)                             → ends previous (single active)
- POST /api/live/stop    (admin only)                        → ends show
- GET  /api/live/token?role=audience&uid=N (public)          → returns appId/token
- GET  /api/live/token?role=host&uid=1                       → SHOULD require admin (spec)

Cleanup guarantees the live show is stopped after tests run.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to test env variable name used by main script if needed
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

ADMIN = {"username": "admin", "password": "admin123"}
BUYER = {"username": "buyer", "password": "buyer123"}


# --------------------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, creds):
    r = api.post(f"{BASE_URL}/api/auth/login-whitelist", json=creds, timeout=15)
    assert r.status_code == 200, f"login {creds['username']}: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token(api):
    return _login(api, ADMIN)


@pytest.fixture(scope="module")
def buyer_token(api):
    return _login(api, BUYER)


@pytest.fixture(scope="module")
def product_ids(api):
    r = api.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200
    prods = r.json()
    assert isinstance(prods, list)
    # Take up to first 3 product ids for live picks (fine even if fewer)
    return [p["id"] for p in prods[:3]]


@pytest.fixture(scope="module", autouse=True)
def _cleanup_after(api, admin_token):
    """Guarantee live is stopped after the module runs."""
    yield
    try:
        api.post(
            f"{BASE_URL}/api/live/stop",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
    except Exception:
        pass


# --------------------------------------------------------------------------- tests

class TestLivePublic:
    def test_current_when_no_live(self, api, admin_token):
        # Ensure no live is running
        api.post(f"{BASE_URL}/api/live/stop", headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        r = api.get(f"{BASE_URL}/api/live/current", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("live") is False


class TestLiveStartStop:
    def test_start_requires_admin(self, api, buyer_token, product_ids):
        # No auth → 401/403
        r = api.post(f"{BASE_URL}/api/live/start", json={"title": "T", "product_ids": product_ids}, timeout=15)
        assert r.status_code in (401, 403), r.status_code
        # Buyer auth → 403
        r = api.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "T", "product_ids": product_ids},
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_stop_requires_admin(self, api, buyer_token):
        r = api.post(f"{BASE_URL}/api/live/stop", timeout=15)
        assert r.status_code in (401, 403)
        r = api.post(
            f"{BASE_URL}/api/live/stop",
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_start_stop_cycle(self, api, admin_token, product_ids):
        # start
        r = api.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "TEST_LIVE_iter17", "product_ids": product_ids},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["live"] is True
        assert body["title"] == "TEST_LIVE_iter17"
        assert body["status"] == "live"
        assert body["channel"]
        assert isinstance(body["products"], list)
        # if products exist in DB and we passed ids, they should be returned
        assert len(body["products"]) == len(product_ids)
        for p in body["products"]:
            assert {"id", "nama_produk", "harga"}.issubset(p.keys())

        # current — public
        r = api.get(f"{BASE_URL}/api/live/current", timeout=15)
        assert r.status_code == 200
        cur = r.json()
        assert cur["live"] is True
        assert cur["title"] == "TEST_LIVE_iter17"

        # start again — must end previous but return single active
        r2 = api.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "TEST_LIVE_iter17_v2", "product_ids": product_ids[:1]},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["title"] == "TEST_LIVE_iter17_v2"

        r = api.get(f"{BASE_URL}/api/live/current", timeout=15)
        assert r.json()["title"] == "TEST_LIVE_iter17_v2"

        # stop
        r = api.post(
            f"{BASE_URL}/api/live/stop",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["live"] is False

        # current shows no live
        r = api.get(f"{BASE_URL}/api/live/current", timeout=15)
        assert r.json().get("live") is False


class TestLiveToken:
    def test_audience_token_is_public(self, api):
        r = api.get(f"{BASE_URL}/api/live/token", params={"role": "audience", "uid": 42}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("appId", "channel", "uid", "token"):
            assert k in body, f"missing {k}"
        assert body["uid"] == 42
        assert body["token"]
        assert body["appId"]

    def test_host_token_requires_admin(self, api, buyer_token):
        # NO auth — spec: 401 (or 403). Current impl may allow public → will fail.
        r = api.get(f"{BASE_URL}/api/live/token", params={"role": "host", "uid": 1}, timeout=15)
        assert r.status_code in (401, 403), (
            f"host token should require admin auth; got {r.status_code}. "
            f"SECURITY: any guest can mint an Agora host/publisher token."
        )
        # Buyer — 401/403
        r = api.get(
            f"{BASE_URL}/api/live/token",
            params={"role": "host", "uid": 1},
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_host_token_admin_ok(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/live/token",
            params={"role": "host", "uid": 1},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["role"] == "host"


class TestReviewWithPhotoOnProductDetail:
    """Regression: product reviews endpoint returns foto_url so product detail
    can render review photos."""

    def test_reviews_endpoint_includes_foto_url_field(self, api, product_ids):
        if not product_ids:
            pytest.skip("no products")
        r = api.get(f"{BASE_URL}/api/products/{product_ids[0]}/reviews", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert set(["average", "count", "items"]).issubset(body.keys())
        # If any item is present, ensure foto_url key exists (may be null)
        for it in body["items"]:
            assert "foto_url" in it
            assert "rating" in it
            assert "nama" in it
