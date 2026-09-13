"""Tests for POST /api/auth/change-password (admin self password change).

Covers: validation errors (empty, <6 chars, same-as-old, wrong old),
session rotation (ALL old sessions revoked, fresh token returned),
login with old password rejected / new password accepted,
and restoration of admin password back to 'admin123'.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")

ADMIN = {"username": "admin", "password": "admin123"}
TEMP_PASSWORD = "TEST_newpass789"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def login(api, username, password):
    return api.post(f"{BASE_URL}/api/auth/login-whitelist", json={"username": username, "password": password})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


class TestChangePassword:
    def test_01_login_admin(self, api):
        r = login(api, ADMIN["username"], ADMIN["password"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data and data["user"]["role"] == "admin"
        TestChangePassword.token1 = data["session_token"]
        # second session to verify ALL sessions get revoked
        r2 = login(api, ADMIN["username"], ADMIN["password"])
        TestChangePassword.token2 = r2.json()["session_token"]
        assert r2.status_code == 200

    def test_02_empty_fields_400(self, api):
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": "", "new_password": ""},
                     headers=auth(self.token1))
        assert r.status_code == 400, r.text

    def test_03_short_new_password_400(self, api):
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": ADMIN["password"], "new_password": "abc12"},
                     headers=auth(self.token1))
        assert r.status_code == 400, r.text
        assert "6 karakter" in r.json()["detail"]

    def test_04_same_as_old_400(self, api):
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": ADMIN["password"], "new_password": ADMIN["password"]},
                     headers=auth(self.token1))
        assert r.status_code == 400, r.text
        assert "berbeda" in r.json()["detail"]

    def test_05_wrong_old_password_401(self, api):
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": "wrongpass", "new_password": TEMP_PASSWORD},
                     headers=auth(self.token1))
        assert r.status_code == 401, r.text
        assert r.json()["detail"] == "Kata sandi lama salah"

    def test_06_success_rotates_token(self, api):
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": ADMIN["password"], "new_password": TEMP_PASSWORD},
                     headers=auth(self.token1))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["message"] == "Kata sandi berhasil diubah"
        assert data["session_token"] not in (self.token1, self.token2)
        TestChangePassword.new_token = data["session_token"]

    def test_07_all_old_sessions_revoked(self, api):
        for t in (self.token1, self.token2):
            r = api.get(f"{BASE_URL}/api/auth/me", headers=auth(t))
            assert r.status_code == 401, f"old token still valid: {r.status_code}"

    def test_08_new_token_valid(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth(self.new_token))
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "admin"

    def test_09_login_old_password_rejected(self, api):
        r = login(api, ADMIN["username"], ADMIN["password"])
        assert r.status_code == 401, r.text

    def test_10_login_new_password_works(self, api):
        r = login(api, ADMIN["username"], TEMP_PASSWORD)
        assert r.status_code == 200, r.text

    def test_99_restore_admin_password(self, api):
        """CRITICAL: restore admin password to admin123 so credentials stay stable."""
        r = api.post(f"{BASE_URL}/api/auth/change-password",
                     json={"old_password": TEMP_PASSWORD, "new_password": ADMIN["password"]},
                     headers=auth(self.new_token))
        assert r.status_code == 200, r.text
        r2 = login(api, ADMIN["username"], ADMIN["password"])
        assert r2.status_code == 200, "admin123 login must work after restore"
        r3 = login(api, ADMIN["username"], TEMP_PASSWORD)
        assert r3.status_code == 401


class TestLoginRegression:
    """Whitelist login/logout + buyer regression."""

    def test_buyer_login_lands_ok(self, api):
        r = login(api, "buyer", "buyer123")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "buyer"

    def test_logout_invalidates_token(self, api):
        r = login(api, "buyer", "buyer123")
        token = r.json()["session_token"]
        r2 = api.post(f"{BASE_URL}/api/auth/logout", headers=auth(token))
        assert r2.status_code == 200
        r3 = api.get(f"{BASE_URL}/api/auth/me", headers=auth(token))
        assert r3.status_code == 401

    def test_wrong_credentials_401(self, api):
        r = login(api, "admin", "definitely-wrong")
        assert r.status_code == 401
