"""Iter22: Live shopping backend regression for the native host black-preview fix.

Covers: admin auth, live start (host_uid=1 contract with native joinChannel),
public live state, Agora token issuance rules (audience public / host admin-only),
and live stop cleanup. Cleans up any show it starts.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_BACKEND_URL not set", allow_module_level=True)

ADMIN = {"username": "admin", "password": "admin123"}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login-whitelist", json=ADMIN, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data
    return data["session_token"]


class TestAdminAuth:
    """Admin whitelist login must work on the tested backend."""

    def test_admin_login(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json().get("role") == "admin"


class TestLiveLifecycle:
    """Start -> current -> token rules -> stop."""

    def test_start_live_host_uid_1(self, api, admin_token):
        r = api.post(
            f"{BASE_URL}/api/live/start",
            json={"title": "TEST_iter22_live", "caption": "test", "show_cart": True, "require_login": False},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"start failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["live"] is True
        assert data["channel"] == "dianastuff_live"
        assert data["title"] == "TEST_iter22_live"
        # require_login False so guests can watch (share-link flow)
        assert data["require_login"] is False

    def test_current_live_public(self, api):
        r = api.get(f"{BASE_URL}/api/live/current", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["live"] is True
        assert data["channel"] == "dianastuff_live"

    def test_audience_token_public_for_guest(self, api):
        """Guests (no login) must get an audience token — needed for share-link join."""
        r = api.get(f"{BASE_URL}/api/live/token?role=audience&uid=777", timeout=20)
        assert r.status_code == 200, f"audience token failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["role"] == "audience"
        assert data["channel"] == "dianastuff_live"
        assert data["appId"]
        assert data["token"]

    def test_host_token_requires_admin(self, api):
        r = api.get(f"{BASE_URL}/api/live/token?role=host&uid=1", timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_host_token_admin_uid_1(self, api, admin_token):
        """Native host joins with uid=1; backend must issue host token for uid=1."""
        r = api.get(
            f"{BASE_URL}/api/live/token?role=host&uid=1",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"host token failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["role"] == "host"
        assert data["uid"] == 1
        assert data["token"]

    def test_stop_live(self, api, admin_token):
        r = api.post(
            f"{BASE_URL}/api/live/stop",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"stop failed: {r.status_code} {r.text}"
        # verify stopped
        r2 = api.get(f"{BASE_URL}/api/live/current", timeout=20)
        assert r2.status_code == 200
        assert r2.json()["live"] is False
