"""Iteration 29 tests.

Covers:
- POST /api/admin/ai/product-info  (Gemini vision auto-fill)
- POST /api/admin/ai/enhance-photo (Nano Banana image edit)
- Anti-spoofing on POST /api/live/chat and /api/live/presence
- Product regression (create/update/delete)
"""
import io
import os
import time
import uuid
import pytest
import requests
from PIL import Image, ImageDraw

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login-whitelist",
        json={"username": username, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


def _make_apparel_image_bytes() -> bytes:
    """Create a JPEG with real visual features (shape, gradient, edges)."""
    img = Image.new("RGB", (512, 512), (220, 210, 200))
    d = ImageDraw.Draw(img)
    # gradient background
    for y in range(512):
        v = 200 + int(y / 512 * 40)
        d.line([(0, y), (512, y)], fill=(v, v - 10, v - 20))
    # a "t-shirt" silhouette
    d.polygon([(140, 130), (200, 100), (312, 100), (372, 130), (400, 190),
               (350, 210), (350, 420), (162, 420), (162, 210), (112, 190)],
              fill=(30, 90, 180), outline=(10, 30, 90))
    # collar
    d.polygon([(232, 100), (256, 130), (280, 100)], fill=(20, 60, 140))
    # logo dot
    d.ellipse([(240, 230), (272, 262)], fill=(255, 220, 60), outline=(50, 40, 0))
    # decorative stripes
    for i in range(3):
        y = 320 + i * 20
        d.line([(180, y), (332, y)], fill=(255, 255, 255), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def buyer_token():
    return _login("buyer", "buyer123")


@pytest.fixture(scope="module")
def uploaded_photo(admin_token):
    img_bytes = _make_apparel_image_bytes()
    r = requests.post(
        f"{BASE_URL}/api/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("tshirt.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
    body = r.json()
    assert "url" in body and body["url"].startswith("/api/files/")
    return body  # {path, url}


# ---------------------------------------------------------------------------
# 1) AI product-info
# ---------------------------------------------------------------------------
class TestAiProductInfo:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/admin/ai/product-info",
                          json={"foto_url": "/api/files/does-not-matter"}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_non_admin_forbidden(self, buyer_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/ai/product-info",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"foto_url": "/api/files/whatever"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_bad_foto_url_returns_400(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/ai/product-info",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"foto_url": "/api/files/nonexistent/path.jpg"},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 for bad foto_url, got {r.status_code} {r.text}"

    def test_generates_indonesian_fields(self, admin_token, uploaded_photo):
        r = requests.post(
            f"{BASE_URL}/api/admin/ai/product-info",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"foto_url": uploaded_photo["url"]},
            timeout=90,
        )
        assert r.status_code == 200, f"AI product-info failed: {r.status_code} {r.text}"
        data = r.json()
        for key in ("nama_produk", "deskripsi", "kategori"):
            assert key in data, f"missing key {key} in {data}"
            assert isinstance(data[key], str) and data[key].strip(), f"empty {key}: {data[key]!r}"
        # small sanity - keep values in reasonable length
        assert len(data["nama_produk"]) <= 120
        assert len(data["deskripsi"]) <= 1500
        assert len(data["kategori"]) <= 60


# ---------------------------------------------------------------------------
# 2) AI enhance-photo
# ---------------------------------------------------------------------------
class TestAiEnhancePhoto:
    def test_requires_admin(self, buyer_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/ai/enhance-photo",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"foto_url": "/api/files/anything"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_enhance_returns_fetchable_image(self, admin_token, uploaded_photo):
        r = requests.post(
            f"{BASE_URL}/api/admin/ai/enhance-photo",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"foto_url": uploaded_photo["url"]},
            timeout=180,  # Nano Banana can take up to ~40s
        )
        assert r.status_code == 200, f"enhance failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("path") and body.get("url", "").startswith("/api/files/")
        # Fetch the returned url and validate image content-type + non-empty bytes
        g = requests.get(f"{BASE_URL}{body['url']}", timeout=60)
        assert g.status_code == 200
        assert (g.headers.get("Content-Type") or "").startswith("image/")
        assert len(g.content) > 1000


# ---------------------------------------------------------------------------
# 3) Anti-spoofing on live chat + presence
# ---------------------------------------------------------------------------
class TestAntiSpoofing:
    @pytest.fixture(scope="class")
    def live_session(self, admin_token):
        # ensure any previous live is stopped, then start fresh
        requests.post(f"{BASE_URL}/api/live/stop",
                      headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        r = requests.post(
            f"{BASE_URL}/api/live/start",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"title": "TEST_iter29_live", "product_ids": [], "featured_product_id": None},
            timeout=30,
        )
        assert r.status_code == 200, f"live start failed: {r.status_code} {r.text}"
        yield
        # teardown: stop live and remove recap for cleanliness
        r2 = requests.post(f"{BASE_URL}/api/live/stop",
                           headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        # try to find and delete the recap
        try:
            hist = requests.get(
                f"{BASE_URL}/api/admin/live-history",
                headers={"Authorization": f"Bearer {admin_token}"}, timeout=15,
            ).json()
            for h in hist:
                if h.get("title") == "TEST_iter29_live":
                    requests.delete(
                        f"{BASE_URL}/api/admin/live-history/{h['id']}",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=15,
                    )
        except Exception:
            pass

    def test_authenticated_buyer_chat_uses_account_name(self, buyer_token, admin_token, live_session):
        vid = uuid.uuid4().hex
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"viewer_id": vid, "name": "admin", "text": "TEST_spoof_attempt"},
            timeout=15,
        )
        assert r.status_code == 200, f"chat post failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        msg = body.get("message") or {}
        # anti-spoof: name must NOT be 'admin', must equal the buyer's account name
        assert msg.get("name") != "admin", f"anti-spoof failed, msg={msg}"
        # buyer account seeded name: 'Pembeli Demo' (fall back to any non-admin non-guest)
        assert msg.get("role") == "buyer", f"expected role=buyer, got {msg.get('role')}"
        assert msg.get("name"), "empty enforced name"

    def test_authenticated_buyer_presence_uses_account_name(self, buyer_token, admin_token, live_session):
        vid = uuid.uuid4().hex
        # Post presence as buyer trying to spoof 'admin'
        r = requests.post(
            f"{BASE_URL}/api/live/presence",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"viewer_id": vid, "name": "admin"},
            timeout=15,
        )
        assert r.status_code == 200
        # Pull last chat messages via feed - the join announcement should have buyer's name, not 'admin'
        time.sleep(0.5)
        feed = requests.get(f"{BASE_URL}/api/live/feed?since_seq=0", timeout=15).json()
        msgs = feed.get("messages") or []
        joins = [m for m in msgs if m.get("kind") == "join"]
        assert joins, "no join announcement in feed"
        # find the buyer join (role should be system, but the announced name should not be 'admin')
        buyer_joins = [j for j in joins if "admin" not in (j.get("name") or "").lower()]
        # more strictly, ensure no join announcement uses the spoofed name 'admin'
        for j in joins:
            assert (j.get("name") or "") != "admin", f"presence spoof succeeded: {j}"

    def test_guest_can_still_pick_name(self, live_session):
        # No auth header - anonymous guest
        vid = uuid.uuid4().hex
        r = requests.post(
            f"{BASE_URL}/api/live/chat",
            json={"viewer_id": vid, "name": "TestTamu", "text": "hi from guest"},
            timeout=15,
        )
        assert r.status_code == 200
        msg = r.json().get("message") or {}
        assert msg.get("role") == "guest"
        assert msg.get("name") == "TestTamu"


# ---------------------------------------------------------------------------
# 4) Product regression
# ---------------------------------------------------------------------------
class TestProductRegression:
    def test_create_update_delete_product(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        payload = {
            "kategori": "Baju",
            "nama_produk": "TEST_iter29_produk",
            "deskripsi": "Deskripsi uji",
            "harga": 12345,
            "stok": 5,
            "berat_gram": 200,
            "bisa_po": False,
            "foto_urls": [],
        }
        r = requests.post(f"{BASE_URL}/api/products", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # verify GET
        g = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=15)
        assert g.status_code == 200
        assert g.json()["nama_produk"] == "TEST_iter29_produk"

        # update
        payload["harga"] = 22222
        u = requests.put(f"{BASE_URL}/api/products/{pid}", headers=headers, json=payload, timeout=15)
        assert u.status_code == 200
        g2 = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=15).json()
        assert float(g2["harga"]) == 22222

        # delete + verify 404
        d = requests.delete(f"{BASE_URL}/api/products/{pid}", headers=headers, timeout=15)
        assert d.status_code == 200
        g3 = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=15)
        assert g3.status_code == 404
