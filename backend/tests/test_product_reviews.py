# Backend tests for GET /api/products/{id}/reviews and related product endpoints.
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")
PRODUCT_ID = "83eb256eba3c4507bff619b294699876"  # Blouse Katun Premium (seeded with a review)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestProductPublic:
    def test_get_product_ok(self, api):
        r = api.get(f"{BASE_URL}/api/products/{PRODUCT_ID}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == PRODUCT_ID
        assert data["nama_produk"] == "Blouse Katun Premium"
        assert isinstance(data.get("foto_urls"), list)
        assert "_id" not in data

    def test_get_product_404(self, api):
        r = api.get(f"{BASE_URL}/api/products/does-not-exist-xyz")
        assert r.status_code == 404


class TestProductReviews:
    def test_reviews_shape(self, api):
        r = api.get(f"{BASE_URL}/api/products/{PRODUCT_ID}/reviews")
        assert r.status_code == 200, r.text
        data = r.json()
        # Shape validation
        assert set(["average", "count", "items"]).issubset(data.keys())
        assert isinstance(data["count"], int)
        assert isinstance(data["items"], list)
        assert isinstance(data["average"], (int, float))

    def test_reviews_has_at_least_one_item(self, api):
        r = api.get(f"{BASE_URL}/api/products/{PRODUCT_ID}/reviews")
        data = r.json()
        # Seeded review exists for this product id
        assert data["count"] >= 1
        assert len(data["items"]) == data["count"]

    def test_review_item_fields(self, api):
        r = api.get(f"{BASE_URL}/api/products/{PRODUCT_ID}/reviews")
        data = r.json()
        item = data["items"][0]
        for k in ("rating", "komentar", "nama", "created_at"):
            assert k in item, f"Missing field {k} in review item"
        assert 1 <= item["rating"] <= 5

    def test_reviews_average_consistency(self, api):
        r = api.get(f"{BASE_URL}/api/products/{PRODUCT_ID}/reviews")
        data = r.json()
        if data["count"] > 0:
            ratings = [i["rating"] for i in data["items"]]
            expected_avg = round(sum(ratings) / len(ratings), 1)
            assert abs(data["average"] - expected_avg) < 0.05

    def test_reviews_empty_for_unknown_product(self, api):
        r = api.get(f"{BASE_URL}/api/products/nonexistent-product-id/reviews")
        # Endpoint tolerates unknown ids and returns empty aggregation
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0
        assert data["average"] == 0
        assert data["items"] == []


class TestUploadEndpointReachable:
    def test_upload_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/upload")
        # Missing auth or missing file — accept 401/403/422
        assert r.status_code in (401, 403, 422), r.text
