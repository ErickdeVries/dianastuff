"""Backend tests for Diana Stuff MVP.

Covers profil_admin, whitelist register/login, /auth/me, /auth/logout, and
Google OAuth endpoints (only invalid session_id rejection).
"""
import os
import uuid
import pytest
import requests

BASE_URL = "https://diana-store-2.preview.emergentagent.com"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# -- profil_admin ------------------------------------------------------------
def test_profil_admin_returns_store(s):
    r = s.get(f"{API}/profil_admin", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["nama_toko"] == "Diana Stuff"
    assert data.get("whatsapp") == "085312812452"
    assert "_id" not in data


# -- admin login -------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": "admin", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "session_token" in data and data["session_token"]
    assert data["user"]["role"] == "admin"
    assert data["user"]["username"] == "admin"
    return data["session_token"]


def test_admin_login(admin_token):
    assert admin_token


def test_login_wrong_password(s):
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": "admin", "password": "wrong-pass"}, timeout=20)
    assert r.status_code == 401


# -- register (pending) ------------------------------------------------------
@pytest.fixture(scope="module")
def pending_user():
    return {
        "username": f"test_{uuid.uuid4().hex[:8]}",
        "password": "buyer123",
        "nama": "TEST Buyer",
    }


def test_register_pending(s, pending_user):
    r = s.post(f"{API}/auth/register-whitelist", json=pending_user, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "pending"
    assert "menunggu persetujuan" in data["message"].lower()


def test_pending_login_returns_403(s, pending_user):
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": pending_user["username"], "password": pending_user["password"]},
               timeout=20)
    assert r.status_code == 403
    assert "menunggu persetujuan" in r.json()["detail"].lower()


def test_register_duplicate_username(s, pending_user):
    r = s.post(f"{API}/auth/register-whitelist", json={
        **pending_user, "nama": "Dup"
    }, timeout=20)
    assert r.status_code == 409


def test_register_short_password(s):
    r = s.post(f"{API}/auth/register-whitelist", json={
        "username": f"test_{uuid.uuid4().hex[:6]}",
        "password": "abc",
        "nama": "TEST Short",
    }, timeout=20)
    assert r.status_code == 400


# -- /auth/me + /auth/logout -------------------------------------------------
def test_me_without_token_is_401(s):
    r = requests.get(f"{API}/auth/me", timeout=20)
    assert r.status_code == 401


def test_me_with_token(s, admin_token):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


def test_logout_invalidates_token(s):
    # login fresh so we can burn the token
    r = s.post(f"{API}/auth/login-whitelist",
               json={"username": "admin", "password": "admin123"}, timeout=20)
    token = r.json()["session_token"]
    r2 = requests.post(f"{API}/auth/logout",
                       headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r2.status_code == 200
    r3 = requests.get(f"{API}/auth/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r3.status_code == 401


# -- Google OAuth endpoints exist + reject invalid ---------------------------
def test_auth_session_invalid_session_id(s):
    r = s.post(f"{API}/auth/session",
               json={"session_id": "definitely-not-valid-xyz"}, timeout=25)
    assert r.status_code == 401


def test_auth_login_email_invalid_session_id(s):
    r = s.post(f"{API}/auth/login-email",
               json={"session_id": "definitely-not-valid-xyz"}, timeout=25)
    assert r.status_code == 401
