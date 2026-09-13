"""Tests for buyer receipt-confirmation flow (POST /api/orders/{id}/terima).

Covers:
- Happy path: buyer confirms a 'dikirim' order -> status becomes 'selesai'
  and status_history gains a 'selesai' entry.
- Idempotency: second call on the same (now 'selesai') order returns 400
  with 'Pesanan belum dikirim'.
- 400 when order status != 'dikirim' (uses a non-dikirim order).
- 403 when a non-owner (different buyer) tries to confirm.
- 404 when order id does not exist.
- Regression: after confirmation the order remains fetchable via /api/orders/{id}
  and its status_history includes 'selesai'.
- Realtime: connect a socket as admin and assert 'order_received' fires when
  a buyer confirms receipt.
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://diana-store-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# --- fixtures ---------------------------------------------------------------

@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def buyer_token(s):
    r = s.post(f"{API}/auth/login-whitelist", json={"username": "buyer", "password": "buyer123"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def orders(s, admin_token):
    r = s.get(f"{API}/orders", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def dikirim_order(orders):
    """Any order currently in status 'dikirim'."""
    picks = [o for o in orders if o.get("status") == "dikirim"]
    if not picks:
        pytest.skip("No 'dikirim' order available for receipt-confirmation test")
    return picks[0]


@pytest.fixture(scope="module")
def non_dikirim_order(orders):
    picks = [o for o in orders if o.get("status") not in ("dikirim",)]
    if not picks:
        pytest.skip("No non-dikirim order available")
    return picks[0]


# --- happy path -------------------------------------------------------------

def test_buyer_confirm_receipt_success(s, buyer_token, dikirim_order):
    oid = dikirim_order["id"]
    r = s.post(f"{API}/orders/{oid}/terima", headers=_h(buyer_token), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == oid
    assert body["status"] == "selesai"
    # status_history should contain selesai entry
    hist = body.get("status_history") or []
    assert any(h.get("status") == "selesai" for h in hist), f"status_history missing selesai: {hist}"


def test_get_order_after_confirm_shows_selesai(s, buyer_token, dikirim_order):
    oid = dikirim_order["id"]
    r = s.get(f"{API}/orders/{oid}", headers=_h(buyer_token), timeout=20)
    assert r.status_code == 200
    assert r.json()["status"] == "selesai"


def test_second_confirm_is_400_belum_dikirim(s, buyer_token, dikirim_order):
    """Once selesai, re-confirming must return 400."""
    oid = dikirim_order["id"]
    r = s.post(f"{API}/orders/{oid}/terima", headers=_h(buyer_token), timeout=20)
    assert r.status_code == 400, r.text
    assert "belum dikirim" in r.json().get("detail", "").lower()


# --- negative branches ------------------------------------------------------

def test_confirm_receipt_on_non_dikirim_order_returns_400(s, buyer_token, non_dikirim_order):
    oid = non_dikirim_order["id"]
    r = s.post(f"{API}/orders/{oid}/terima", headers=_h(buyer_token), timeout=20)
    # Buyer might not own this order -> could be 403; only care that it is not 200
    assert r.status_code in (400, 403), r.text
    if r.status_code == 400:
        assert "belum dikirim" in r.json().get("detail", "").lower()


def test_confirm_receipt_missing_order_returns_404(s, buyer_token):
    fake_id = uuid.uuid4().hex
    r = s.post(f"{API}/orders/{fake_id}/terima", headers=_h(buyer_token), timeout=20)
    assert r.status_code == 404


def test_confirm_receipt_without_auth_returns_401(s):
    fake_id = uuid.uuid4().hex
    r = s.post(f"{API}/orders/{fake_id}/terima", timeout=20)
    assert r.status_code in (401, 403)


# --- 403 for non-owner ------------------------------------------------------

def test_non_owner_buyer_gets_403(s):
    """Register a fresh buyer, get them approved via admin, then attempt to
    confirm an order they don't own -> expect 403."""
    admin = s.post(f"{API}/auth/login-whitelist", json={"username": "admin", "password": "admin123"}, timeout=20).json()["session_token"]
    orders = s.get(f"{API}/orders", headers=_h(admin), timeout=20).json()
    # Need to find a dikirim OR still-active order owned by seeded 'buyer'.
    # If none dikirim remain (they were consumed above), fall back to any order
    # owned by seeded buyer to at least test the ownership branch (server order
    # is: 404 -> 403 -> 400, so a valid id with foreign user hits 403 first).
    target = next((o for o in orders if o.get("user_id") and o.get("status") != "selesai"), None)
    if not target:
        target = next((o for o in orders if o.get("user_id")), None)
    if not target:
        pytest.skip("no order available to test 403 branch")

    # Register fresh other-buyer
    uname = f"TESTother_{uuid.uuid4().hex[:6]}"
    reg = s.post(f"{API}/auth/register-whitelist", json={"username": uname, "password": "pass1234", "nama": "Other Buyer"}, timeout=20)
    assert reg.status_code in (200, 201), reg.text

    # Admin approves via /users/{id}/status or similar; try common endpoints.
    approved = False
    users = s.get(f"{API}/users", headers=_h(admin), timeout=20)
    if users.status_code == 200:
        u = next((u for u in users.json() if u.get("username") == uname), None)
        if u:
            uid = u.get("id") or u.get("user_id")
            for path, body in [
                (f"/users/{uid}/approve", {}),
                (f"/users/{uid}/status", {"status": "approved"}),
                (f"/users/{uid}", {"status": "approved"}),
            ]:
                rr = s.put(f"{API}{path}", headers=_h(admin), json=body, timeout=20) if not path.endswith("approve") else s.post(f"{API}{path}", headers=_h(admin), json=body, timeout=20)
                if rr.status_code in (200, 204):
                    approved = True
                    break
    if not approved:
        pytest.skip("Could not approve fresh buyer via known admin endpoints; ownership branch not asserted here")

    tok = s.post(f"{API}/auth/login-whitelist", json={"username": uname, "password": "pass1234"}, timeout=20).json().get("session_token")
    if not tok:
        pytest.skip("Fresh buyer login failed")

    r = s.post(f"{API}/orders/{target['id']}/terima", headers=_h(tok), timeout=20)
    assert r.status_code == 403, r.text


# --- realtime emit ----------------------------------------------------------

def test_admin_receives_order_received_socket_event(s, admin_token, buyer_token, orders):
    """Confirm receipt on a dikirim order emits 'order_received' to admins room.

    Skips if no dikirim order remains (previous tests may have consumed the
    only available one) — in that case the happy-path test above already
    exercised the endpoint.
    """
    picks = [o for o in orders if o.get("status") == "dikirim"]
    # re-fetch to get a fresh dikirim (previous test consumed one)
    fresh = s.get(f"{API}/orders", headers=_h(admin_token), timeout=20).json()
    picks = [o for o in fresh if o.get("status") == "dikirim"]
    if not picks:
        pytest.skip("No remaining dikirim order to trigger a realtime emit")

    try:
        import socketio  # type: ignore
    except Exception:
        pytest.skip("python-socketio not installed")

    events = []
    sio = socketio.Client(reconnection=False, request_timeout=10)

    @sio.on("order_received")
    def _on_recv(data):
        events.append(data)

    sio.connect(
        BASE_URL,
        socketio_path="/api/socket.io",
        transports=["websocket"],
        auth={"token": admin_token},
        wait_timeout=10,
    )
    time.sleep(0.6)

    oid = picks[0]["id"]
    r = s.post(f"{API}/orders/{oid}/terima", headers=_h(buyer_token), timeout=20)
    assert r.status_code == 200, r.text

    # Give the server a moment to emit
    for _ in range(20):
        if events:
            break
        time.sleep(0.25)
    sio.disconnect()

    assert events, "Expected 'order_received' event on admins room but none received"
    payload = events[0]
    assert payload.get("id") == oid
    assert payload.get("no_order") == picks[0].get("no_order")
