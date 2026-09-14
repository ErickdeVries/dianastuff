"""Iteration 16 — review with photo (foto_url) end-to-end backend tests.

Covers:
- POST /api/orders/{id}/review now accepts {rating, komentar, foto_url}
- Order response echoes review.foto_url
- GET /api/products/{id}/reviews items include foto_url
- Regression: rating validation (1..5), 403 for non-owner, 404 unknown order
- Regression: review without foto_url (null) still works
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

TEST_ORDER_ID = "841439d641a4418c978769116b2d72c2"
TEST_PRODUCT_ID = "83eb256eba3c4507bff619b294699876"


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": "buyer", "password": "buyer123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": "admin", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _reset_review():
    """Ensure the test order starts with review=None and restore after each test."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def reset():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.orders.update_one({"id": TEST_ORDER_ID}, {"$set": {"review": None}})
        c.close()
    asyncio.get_event_loop().run_until_complete(reset())
    yield
    asyncio.get_event_loop().run_until_complete(reset())


# ------------------------- REVIEW SUBMIT WITH PHOTO -------------------------
class TestReviewWithPhoto:

    def test_submit_review_with_foto_url_persists(self, buyer_token):
        foto = "/api/files/test/review_photo.jpg"
        r = requests.post(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
            headers=_auth(buyer_token),
            json={"rating": 5, "komentar": "Bagus banget", "foto_url": foto},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["id"] == TEST_ORDER_ID
        assert order["review"] is not None
        assert order["review"]["rating"] == 5
        assert order["review"]["komentar"] == "Bagus banget"
        assert order["review"]["foto_url"] == foto
        assert order["review"].get("created_at")

        # GET the order confirms persistence
        g = requests.get(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}",
            headers=_auth(buyer_token), timeout=10,
        )
        assert g.status_code == 200
        got = g.json()
        assert got["review"]["foto_url"] == foto
        assert got["review"]["rating"] == 5

    def test_submit_review_without_foto_still_works(self, buyer_token):
        r = requests.post(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
            headers=_auth(buyer_token),
            json={"rating": 4, "komentar": "Oke"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["review"]["rating"] == 4
        assert order["review"]["komentar"] == "Oke"
        # foto_url should be null (not missing key)
        assert order["review"]["foto_url"] is None

    def test_submit_review_invalid_rating(self, buyer_token):
        for bad in (0, 6, -1):
            r = requests.post(
                f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
                headers=_auth(buyer_token),
                json={"rating": bad, "komentar": "x"},
                timeout=10,
            )
            assert r.status_code == 400, f"rating {bad} → {r.status_code}"

    def test_submit_review_unknown_order_404(self, buyer_token):
        r = requests.post(
            f"{BASE_URL}/api/orders/NONEXISTENT/review",
            headers=_auth(buyer_token),
            json={"rating": 5},
            timeout=10,
        )
        assert r.status_code == 404

    def test_submit_review_forbidden_for_other_user(self, admin_token):
        # admin is not the owner of the buyer's order → 403
        r = requests.post(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
            headers=_auth(admin_token),
            json={"rating": 5, "komentar": "hack"},
            timeout=10,
        )
        assert r.status_code == 403


# ------------------------- PRODUCT REVIEWS AGGREGATE ------------------------
class TestProductReviewsFotoUrl:

    def test_product_reviews_include_foto_url_field(self, buyer_token):
        foto = "/api/files/test/agg_photo.jpg"
        # submit review with photo
        r = requests.post(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
            headers=_auth(buyer_token),
            json={"rating": 5, "komentar": "Foto test", "foto_url": foto},
            timeout=15,
        )
        assert r.status_code == 200

        # fetch aggregate
        g = requests.get(
            f"{BASE_URL}/api/products/{TEST_PRODUCT_ID}/reviews", timeout=15
        )
        assert g.status_code == 200
        data = g.json()
        assert "average" in data and "count" in data and "items" in data
        assert isinstance(data["items"], list) and data["count"] >= 1
        # find our review (may be multiple across seeds) — every item MUST have foto_url key
        for it in data["items"]:
            assert "foto_url" in it, "foto_url key missing in review item"
            assert "rating" in it and "komentar" in it and "nama" in it
        matched = [it for it in data["items"] if it.get("foto_url") == foto]
        assert matched, f"expected review with foto_url={foto}, got items={data['items']}"
        assert matched[0]["rating"] == 5
        assert matched[0]["komentar"] == "Foto test"

    def test_product_reviews_no_photo_returns_null_foto_url(self, buyer_token):
        r = requests.post(
            f"{BASE_URL}/api/orders/{TEST_ORDER_ID}/review",
            headers=_auth(buyer_token),
            json={"rating": 3, "komentar": "no foto"},
            timeout=15,
        )
        assert r.status_code == 200

        g = requests.get(
            f"{BASE_URL}/api/products/{TEST_PRODUCT_ID}/reviews", timeout=15
        )
        assert g.status_code == 200
        items = g.json()["items"]
        no_photo = [it for it in items if it.get("komentar") == "no foto"]
        assert no_photo, "review with no foto not aggregated"
        assert no_photo[0]["foto_url"] is None
