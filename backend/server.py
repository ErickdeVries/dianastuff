from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends, UploadFile, File, Form, Request
from fastapi.responses import Response, FileResponse
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import asyncio
import os
import logging
import re
import time
import uuid
import secrets
import base64
import json
import bcrypt
import httpx
import requests
import socketio
from pathlib import Path
from urllib.parse import quote
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Socket.IO server (mounted at /api/socket.io via ASGIApp at the bottom of file).
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("diana")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DAYS = 7
DEFAULT_WHATSAPP = "6285312812452"

# ---------------------------------------------------------------------------
# Object storage — provider abstraction (local disk | S3 | Emergent legacy)
# ---------------------------------------------------------------------------
# STORAGE_PROVIDER=local (default): files on disk under STORAGE_DIR (volume).
# STORAGE_PROVIDER=s3:          S3-compatible via AWS_* env (boto3).
# STORAGE_PROVIDER=emergent:    legacy Emergent object storage (integrations...).
# Switching provider later = change env only, zero code changes.
STORAGE_PROVIDER = (os.environ.get("STORAGE_PROVIDER") or "local").strip().lower()
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR") or (ROOT_DIR / "uploads"))
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
AGORA_APP_ID = os.environ.get("AGORA_APP_ID", "")
AGORA_APP_CERTIFICATE = os.environ.get("AGORA_APP_CERTIFICATE", "")
APP_NAME = "diana-stuff"
_storage_key: Optional[str] = None


def _local_path(path: str) -> Path:
    # Keep paths inside the storage root (no traversal) and mirror the old
    # flat key layout so existing references (/api/files/<path>) keep working.
    clean = path.lstrip("/")
    target = (STORAGE_DIR / clean).resolve()
    if not str(target).startswith(str(STORAGE_DIR.resolve())):
        raise ValueError("invalid storage path")
    return target


def _storage_backend() -> str:
    p = STORAGE_PROVIDER
    if p in ("local", "s3", "emergent"):
        return p
    logger.warning(f"Unknown STORAGE_PROVIDER '{p}', falling back to local")
    return "local"


# --- local disk -----------------------------------------------------------
def _local_put(path: str, data: bytes, content_type: str) -> dict:
    target = _local_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {"path": path, "size": len(data), "content_type": content_type}


def _local_get(path: str) -> tuple[bytes, str]:
    target = _local_path(path)
    if not target.is_file():
        raise FileNotFoundError(path)
    return target.read_bytes(), "image/jpeg"


# --- S3-compatible --------------------------------------------------------
_s3_client = None


def _s3() -> "boto3.client":
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=os.environ.get("AWS_REGION") or "auto",
        )
    return _s3_client


def _s3_bucket() -> str:
    return os.environ.get("S3_BUCKET", "dianastuff")


def _s3_put(path: str, data: bytes, content_type: str) -> dict:
    _s3().put_object(Bucket=_s3_bucket(), Key=path.lstrip("/"), Body=data, ContentType=content_type)
    return {"path": path, "size": len(data), "content_type": content_type}


def _s3_get(path: str) -> tuple[bytes, str]:
    obj = _s3().get_object(Bucket=_s3_bucket(), Key=path.lstrip("/"))
    return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")


# --- Emergent legacy ------------------------------------------------------
def init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _emergent_put(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def _emergent_get(path: str) -> tuple[bytes, str]:
    global _storage_key
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# --- public API (used by routes) -----------------------------------------
def put_object(path: str, data: bytes, content_type: str) -> dict:
    backend = _storage_backend()
    if backend == "local":
        return _local_put(path, data, content_type)
    if backend == "s3":
        return _s3_put(path, data, content_type)
    return _emergent_put(path, data, content_type)


def get_object(path: str) -> tuple[bytes, str]:
    backend = _storage_backend()
    if backend == "local":
        return _local_get(path)
    if backend == "s3":
        return _s3_get(path)
    return _emergent_get(path)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RekeningBank(BaseModel):
    bank: str
    no_rek: str
    a_n: str


class ProfilAdmin(BaseModel):
    nama_toko: str
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    rekening_bank: List[RekeningBank] = Field(default_factory=list)
    whatsapp: str = ""


class SessionExchange(BaseModel):
    session_id: str


class RegisterWhitelist(BaseModel):
    username: str
    password: str
    nama: str
    email: Optional[str] = None
    wa: Optional[str] = None


class LoginWhitelist(BaseModel):
    username: str
    password: str


class ProductIn(BaseModel):
    kategori: str = ""
    nama_produk: str
    deskripsi: str = ""
    harga: float = 0
    stok: int = 0
    berat_gram: int = 0
    bisa_po: bool = False
    foto_urls: List[str] = Field(default_factory=list)
    location_id: Optional[str] = None
    harga_diskon: Optional[float] = None  # harga setelah diskon; None/0 = tanpa diskon
    has_variations: bool = False
    # variations: [{"name": "Warna", "options": ["Merah", "Biru"]}, ...] (maks 2 grup)
    variations: List[dict] = Field(default_factory=list)
    # combinations: [{"options": ["Merah","S"], "harga": 100000, "harga_diskon": null,
    #                 "stok": 5, "foto": "url", "sku": ""}, ...]
    combinations: List[dict] = Field(default_factory=list)


class LocationIn(BaseModel):
    name: str
    contact_name: str
    contact_phone: str
    address: str
    postal_code: str = ""
    latitude: float
    longitude: float
    note: Optional[str] = None
    is_default: bool = True


class UserAddressIn(BaseModel):
    label_alamat: str = "Rumah"
    nama_penerima: str
    telepon: str
    alamat_lengkap: str
    postal_code: str = ""
    latitude: float
    longitude: float
    is_default: bool = False


class RatesIn(BaseModel):
    address_id: Optional[str] = None
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    location_id: Optional[str] = None
    items: List[dict] = Field(default_factory=list)


class CustomerIn(BaseModel):
    email: Optional[str] = None
    username: str
    password: Optional[str] = None
    nama: str
    wa: Optional[str] = None
    status: str = "approved"


class ProfilUpdate(BaseModel):
    nama_toko: str
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    rekening_bank: List[RekeningBank] = Field(default_factory=list)
    whatsapp: str = ""
    kurir_list: Optional[List[str]] = None
    live_welcome: Optional[str] = None


class AddressUpdate(BaseModel):
    nama: Optional[str] = None
    wa: Optional[str] = None
    alamat: str
    kota: str
    kode_pos: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class OrderItemIn(BaseModel):
    product_id: str
    qty: int
    variation_key: Optional[str] = None  # "Merah|S" bila produk bervariasi


class OrderCreate(BaseModel):
    items: List[OrderItemIn]
    kurir: Optional[str] = None
    ongkir: float = 0
    catatan: Optional[str] = None
    shipping_coordinate: Optional[dict] = None
    courier_company: Optional[str] = None
    courier_type: Optional[str] = None
    voucher_code: Optional[str] = None
    asuransi: bool = False
    asuransi_fee: float = 0
    payment_method: str = "transfer"  # transfer | cod
    cod_disbursement_type: str = "7_days"  # 7_days | 5_days | 3_days


class ShippingSettingsIn(BaseModel):
    enabled_couriers: List[str] = Field(default_factory=list)
    subsidy_mode: str = "none"       # none | discount | free
    subsidy_amount: float = 0        # potongan nominal (mode discount)


class VoucherIn(BaseModel):
    kode: str
    tipe: str = "persen"          # "persen" | "nominal" | "ongkir_persen"
    nilai: float = 0             # persen (0-100) atau nominal rupiah
    min_belanja: float = 0       # minimal subtotal agar voucher berlaku
    maks_potongan: float = 0     # batas maksimal potongan (0 = tanpa batas; utk ongkir_persen)
    kuota: int = 0               # 0 = tak terbatas
    aktif: bool = True
    kadaluarsa: Optional[str] = None  # ISO date (YYYY-MM-DD) atau None


class PlatformSettingsIn(BaseModel):
    platform_fee_percent: float = 0  # fee platform (%) dipotong dari pendapatan penjual


DEFAULT_KURIR = ["JNE", "J&T", "Lion Parcel", "Gosend Instan/Sameday"]
DEFAULT_LIVE_WELCOME = "Halo {nama}, selamat datang di live {toko}! 🎉 Selamat belanja ya 😍"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def public_user(user: dict) -> dict:
    return {
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "username": user.get("username"),
        "role": user.get("role", "buyer"),
        "nama": user.get("nama"),
        "wa": user.get("wa"),
        "alamat": user.get("alamat"),
        "kota": user.get("kota"),
        "kode_pos": user.get("kode_pos"),
        "latitude": user.get("latitude"),
        "longitude": user.get("longitude"),
        "status": user.get("status", "approved"),
        "auth_provider": user.get("auth_provider", "whitelist"),
        "picture": user.get("picture"),
    }


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=SESSION_DAYS),
    })
    return token


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Sesi tidak valid")
    expires_at = session.get("expires_at")
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Sesi telah kedaluwarsa")
    user = await db.users.find_one({"user_id": session["user_id"], "deleted_at": None}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Pengguna tidak ditemukan")
    return user


async def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    user = await get_current_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Akses khusus admin")
    return user


def _combo_effective_price(c: dict) -> float:
    harga = c.get("harga", 0) or 0
    hd = c.get("harga_diskon")
    if hd is not None and hd > 0 and hd < harga:
        return hd
    return harga


def _combo_key(options) -> str:
    return "|".join([str(o) for o in (options or [])])


def _find_combination(p: dict, variation_key: Optional[str]) -> Optional[dict]:
    if not variation_key:
        return None
    for c in p.get("combinations", []):
        if _combo_key(c.get("options")) == variation_key:
            return c
    return None


def _effective_price(p: dict) -> float:
    """Discounted price when a valid harga_diskon is set, else the normal price.
    For products with variations, use the cheapest active combination price."""
    if p.get("has_variations") and p.get("combinations"):
        prices = [_combo_effective_price(c) for c in p["combinations"] if (c.get("harga") or 0) > 0]
        return min(prices) if prices else 0
    harga = p.get("harga", 0) or 0
    hd = p.get("harga_diskon")
    if hd is not None and hd > 0 and hd < harga:
        return hd
    return harga


def product_public(p: dict, terjual: int = 0, rating: float = 0.0, rating_count: int = 0) -> dict:
    has_var = bool(p.get("has_variations") and p.get("combinations"))
    if has_var:
        combos = p.get("combinations", [])
        base_prices = [c.get("harga", 0) or 0 for c in combos if (c.get("harga") or 0) > 0]
        eff_prices = [_combo_effective_price(c) for c in combos if (c.get("harga") or 0) > 0]
        harga = min(base_prices) if base_prices else 0
        harga_max = max(base_prices) if base_prices else 0
        harga_final = min(eff_prices) if eff_prices else 0
        stok = sum(int(c.get("stok", 0) or 0) for c in combos)
    else:
        harga = p.get("harga", 0) or 0
        harga_max = harga
        harga_final = _effective_price(p)
        stok = p.get("stok", 0)
    diskon_aktif = harga_final < harga
    return {
        "id": p.get("id"),
        "kategori": p.get("kategori", ""),
        "nama_produk": p.get("nama_produk"),
        "deskripsi": p.get("deskripsi", ""),
        "harga": harga,
        "harga_max": harga_max,
        "harga_diskon": (p.get("harga_diskon") if diskon_aktif else None) if not has_var else None,
        "harga_final": harga_final,
        "diskon_persen": round((1 - harga_final / harga) * 100) if diskon_aktif and harga else 0,
        "stok": stok,
        "berat_gram": p.get("berat_gram", 0),
        "bisa_po": p.get("bisa_po", False),
        "foto_urls": p.get("foto_urls", []),
        "location_id": p.get("location_id"),
        "weight": p.get("berat_gram", 0),
        "has_variations": has_var,
        "variations": p.get("variations", []) if has_var else [],
        "combinations": p.get("combinations", []) if has_var else [],
        "terjual": terjual,
        "views": p.get("views", 0),
        "rating": rating,
        "rating_count": rating_count,
        "created_at": p.get("created_at").isoformat() if p.get("created_at") else None,
    }


async def _rating_map(product_ids: Optional[List[str]] = None) -> dict:
    """Average product star rating + count per product, from reviewed orders."""
    match: dict = {"deleted_at": None, "review": {"$ne": None}}
    pipeline: list = [
        {"$match": match},
        {"$unwind": "$items"},
    ]
    if product_ids:
        pipeline.append({"$match": {"items.product_id": {"$in": product_ids}}})
    pipeline += [
        {"$group": {
            "_id": "$items.product_id",
            "sum": {"$sum": "$review.rating"},
            "count": {"$sum": 1},
        }},
    ]
    rows = await db.orders.aggregate(pipeline).to_list(5000)
    out: dict = {}
    for r in rows:
        cnt = r.get("count", 0) or 0
        out[r["_id"]] = {"rating": round((r.get("sum", 0) or 0) / cnt, 1) if cnt else 0, "count": cnt}
    return out


async def _sold_map(product_ids: Optional[List[str]] = None) -> dict:
    """Units sold per product, counted from completed ('selesai') orders only."""
    match: dict = {"deleted_at": None, "status": "selesai"}
    pipeline = [
        {"$match": match},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.product_id", "qty": {"$sum": "$items.qty"}}},
    ]
    if product_ids:
        pipeline.insert(2, {"$match": {"items.product_id": {"$in": product_ids}}})
    rows = await db.orders.aggregate(pipeline).to_list(5000)
    return {r["_id"]: r["qty"] for r in rows}


# ---------------------------------------------------------------------------
# Biteship shipping (multi-tenant ready) — key stays server-side only
# ---------------------------------------------------------------------------
BITESHIP_API_KEY = os.environ.get("BITESHIP_API_KEY", "")
BITESHIP_BASE = "https://api.biteship.com"
DEFAULT_TENANT = "diana"


async def _biteship(method: str, path: str, json_body: Optional[dict] = None) -> dict:
    if not BITESHIP_API_KEY:
        raise HTTPException(status_code=503, detail="Biteship belum dikonfigurasi")
    async with httpx.AsyncClient(
        base_url=BITESHIP_BASE,
        timeout=httpx.Timeout(25.0),
        headers={"Authorization": BITESHIP_API_KEY, "Content-Type": "application/json"},
    ) as c:
        r = await c.request(method, path, json=json_body)
    try:
        data = r.json()
    except Exception:
        data = {"raw": r.text[:300]}
    if r.status_code >= 400 or (isinstance(data, dict) and data.get("success") is False):
        detail = data.get("error") or data.get("message") or str(data)[:300]
        # Use 402 (not 5xx) so the edge CDN doesn't replace our JSON with an
        # HTML "Bad gateway" page — the frontend needs to read `detail`.
        raise HTTPException(status_code=402, detail=f"Biteship: {detail}")
    return data


def location_public(d: dict) -> dict:
    return {
        "id": d.get("id"),
        "tenant_id": d.get("tenant_id", DEFAULT_TENANT),
        "name": d.get("name"),
        "contact_name": d.get("contact_name"),
        "contact_phone": d.get("contact_phone"),
        "address": d.get("address"),
        "postal_code": d.get("postal_code", ""),
        "latitude": d.get("latitude"),
        "longitude": d.get("longitude"),
        "note": d.get("note"),
        "is_default": d.get("is_default", False),
        "biteship_location_id": d.get("biteship_location_id"),
    }


def address_public(d: dict) -> dict:
    return {
        "id": d.get("id"),
        "label_alamat": d.get("label_alamat", "Rumah"),
        "nama_penerima": d.get("nama_penerima"),
        "telepon": d.get("telepon"),
        "alamat_lengkap": d.get("alamat_lengkap"),
        "postal_code": d.get("postal_code", ""),
        "latitude": d.get("latitude"),
        "longitude": d.get("longitude"),
        "is_default": d.get("is_default", False),
    }


async def _default_location(tenant_id: str = DEFAULT_TENANT) -> Optional[dict]:
    loc = await db.locations.find_one({"tenant_id": tenant_id, "is_default": True}, {"_id": 0})
    if not loc:
        loc = await db.locations.find_one({"tenant_id": tenant_id}, {"_id": 0})
    return loc


async def _sync_biteship_location(doc: dict) -> Optional[str]:
    payload = {
        "name": doc["name"],
        "contact_name": doc["contact_name"],
        "contact_phone": doc["contact_phone"],
        "address": doc["address"],
        "postal_code": doc.get("postal_code") or "",
        "latitude": doc["latitude"],
        "longitude": doc["longitude"],
        "type": "origin",
    }
    if doc.get("note"):
        payload["note"] = doc["note"]
    try:
        if doc.get("biteship_location_id"):
            data = await _biteship("POST", f"/v1/locations/{doc['biteship_location_id']}", payload)
        else:
            data = await _biteship("POST", "/v1/locations", payload)
        return data.get("id") or doc.get("biteship_location_id")
    except HTTPException as e:
        logger.warning(f"Biteship location sync failed: {e.detail}")
        return doc.get("biteship_location_id")


@api_router.get("/admin/locations")
async def list_locations(admin: dict = Depends(require_admin)):
    docs = await db.locations.find({"tenant_id": DEFAULT_TENANT}, {"_id": 0}).sort("is_default", -1).to_list(50)
    return [location_public(d) for d in docs]


@api_router.post("/admin/locations")
async def create_location(payload: LocationIn, admin: dict = Depends(require_admin)):
    doc = {
        "id": f"loc_{uuid.uuid4().hex[:12]}",
        "tenant_id": DEFAULT_TENANT,
        **payload.dict(),
    }
    if payload.is_default:
        await db.locations.update_many({"tenant_id": DEFAULT_TENANT}, {"$set": {"is_default": False}})
    doc["biteship_location_id"] = await _sync_biteship_location(doc)
    await db.locations.insert_one(dict(doc))
    return location_public(doc)


@api_router.put("/admin/locations/{location_id}")
async def update_location(location_id: str, payload: LocationIn, admin: dict = Depends(require_admin)):
    existing = await db.locations.find_one({"id": location_id, "tenant_id": DEFAULT_TENANT})
    if not existing:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan")
    if payload.is_default:
        await db.locations.update_many({"tenant_id": DEFAULT_TENANT}, {"$set": {"is_default": False}})
    merged = {**existing, **payload.dict()}
    merged["biteship_location_id"] = await _sync_biteship_location(merged)
    await db.locations.update_one({"id": location_id}, {"$set": {**payload.dict(), "biteship_location_id": merged["biteship_location_id"]}})
    doc = await db.locations.find_one({"id": location_id}, {"_id": 0})
    return location_public(doc)


@api_router.get("/me/addresses")
async def list_my_addresses(user: dict = Depends(get_current_user)):
    docs = await db.user_addresses.find({"user_id": user["user_id"]}, {"_id": 0}).sort("is_default", -1).to_list(50)
    return [address_public(d) for d in docs]


@api_router.post("/me/addresses")
async def create_my_address(payload: UserAddressIn, user: dict = Depends(get_current_user)):
    doc = {
        "id": f"addr_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "tenant_id": DEFAULT_TENANT,
        **payload.dict(),
    }
    count = await db.user_addresses.count_documents({"user_id": user["user_id"]})
    if payload.is_default or count == 0:
        await db.user_addresses.update_many({"user_id": user["user_id"]}, {"$set": {"is_default": False}})
        doc["is_default"] = True
    await db.user_addresses.insert_one(dict(doc))
    return address_public(doc)


@api_router.put("/me/addresses/{address_id}")
async def update_my_address(address_id: str, payload: UserAddressIn, user: dict = Depends(get_current_user)):
    existing = await db.user_addresses.find_one({"id": address_id, "user_id": user["user_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Alamat tidak ditemukan")
    if payload.is_default:
        await db.user_addresses.update_many({"user_id": user["user_id"]}, {"$set": {"is_default": False}})
    await db.user_addresses.update_one({"id": address_id}, {"$set": payload.dict()})
    doc = await db.user_addresses.find_one({"id": address_id}, {"_id": 0})
    return address_public(doc)


@api_router.delete("/me/addresses/{address_id}")
async def delete_my_address(address_id: str, user: dict = Depends(get_current_user)):
    res = await db.user_addresses.delete_one({"id": address_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alamat tidak ditemukan")
    return {"ok": True}


ALL_COURIERS = ["gojek", "grab", "jne", "jnt", "lion", "lalamove", "ninja", "paxel", "pos"]


async def _shipping_settings() -> dict:
    doc = await db.store_settings.find_one({"_id": "shipping"}) or {}
    return {
        "enabled_couriers": doc.get("enabled_couriers") or ALL_COURIERS,
        "subsidy_mode": doc.get("subsidy_mode", "none"),
        "subsidy_amount": float(doc.get("subsidy_amount", 0) or 0),
    }


def _apply_subsidy(price: float, settings: dict) -> tuple:
    """Return (buyer_price, subsidi_amount) after applying the store subsidy."""
    mode = settings.get("subsidy_mode", "none")
    if mode == "free":
        return 0.0, price
    if mode == "discount":
        amt = min(settings.get("subsidy_amount", 0) or 0, price)
        return max(0.0, price - amt), amt
    return price, 0.0


@api_router.get("/admin/shipping-settings")
async def get_shipping_settings(admin: dict = Depends(require_admin)):
    s = await _shipping_settings()
    return {**s, "all_couriers": ALL_COURIERS}


@api_router.put("/admin/shipping-settings")
async def set_shipping_settings(payload: ShippingSettingsIn, admin: dict = Depends(require_admin)):
    couriers = [c for c in (payload.enabled_couriers or []) if c in ALL_COURIERS] or ALL_COURIERS
    mode = payload.subsidy_mode if payload.subsidy_mode in ("none", "discount", "free") else "none"
    await db.store_settings.update_one(
        {"_id": "shipping"},
        {"$set": {
            "enabled_couriers": couriers,
            "subsidy_mode": mode,
            "subsidy_amount": max(0.0, payload.subsidy_amount or 0),
        }},
        upsert=True,
    )
    return await _shipping_settings()


@api_router.post("/shipping/rates")
async def shipping_rates(payload: RatesIn, user: dict = Depends(get_current_user)):
    # Origin: product location (future multi-origin) or tenant default location.
    origin = None
    if payload.location_id:
        origin = await db.locations.find_one({"id": payload.location_id}, {"_id": 0})
    if not origin:
        origin = await _default_location()
    if not origin or origin.get("latitude") is None:
        raise HTTPException(status_code=400, detail="Alamat toko (asal) belum diatur")
    # Destination: a saved address or raw coords.
    dlat, dlng = payload.destination_latitude, payload.destination_longitude
    if payload.address_id:
        addr = await db.user_addresses.find_one({"id": payload.address_id, "user_id": user["user_id"]}, {"_id": 0})
        if not addr:
            raise HTTPException(status_code=404, detail="Alamat tidak ditemukan")
        dlat, dlng = addr["latitude"], addr["longitude"]
    if dlat is None or dlng is None:
        raise HTTPException(status_code=400, detail="Titik lokasi tujuan belum dipilih")
    items = payload.items or [{"name": "Barang", "value": 10000, "weight": 250, "quantity": 1}]
    settings = await _shipping_settings()
    body = {
        "origin_latitude": origin["latitude"],
        "origin_longitude": origin["longitude"],
        "destination_latitude": dlat,
        "destination_longitude": dlng,
        "couriers": ",".join(settings["enabled_couriers"]),
        "items": items,
    }
    data = await _biteship("POST", "/v1/rates/couriers", body)
    pricing = []
    for r in data.get("pricing", []):
        price = r.get("price", 0) or 0
        buyer_price, subsidi = _apply_subsidy(price, settings)
        r = {**r, "price_asli": price, "price": buyer_price, "subsidi": subsidi}
        pricing.append(r)
    return {
        "pricing": pricing,
        "origin": data.get("origin"),
        "destination": data.get("destination"),
        "subsidy_mode": settings["subsidy_mode"],
    }


class ShipOrderIn(BaseModel):
    courier_company: str
    courier_type: str


async def _biteship_order_payload(order: dict, courier_company: Optional[str] = None, courier_type: Optional[str] = None) -> dict:
    """Build the POST /v1/orders JSON body for an order. Shared by the actual
    booking and the admin payload-preview endpoint (for Biteship support)."""
    origin = await _default_location()
    if not origin:
        raise HTTPException(status_code=400, detail="Alamat toko belum diatur")
    dest = order.get("shipping_coordinate") or {}
    alamat = order.get("alamat") or {}
    company = (courier_company or order.get("courier_company") or "").strip().lower()
    service = (courier_type or order.get("courier_type") or "").strip().lower()
    is_instant = company in {"gojek", "grab", "lalamove"} or service in {
        "instant", "instant-bike", "instant-car", "same_day", "same-day"
    }
    is_cod = (order.get("payment_method") or "").strip().lower() == "cod" or bool(order.get("is_cod"))

    required = {
        "nama kontak asal": origin.get("contact_name"),
        "telepon asal": origin.get("contact_phone"),
        "alamat asal": origin.get("address"),
        "nama penerima": alamat.get("nama"),
        "telepon penerima": alamat.get("wa"),
        "alamat tujuan": alamat.get("alamat"),
        "courier_company": company,
        "courier_type": service,
    }
    missing = [name for name, value in required.items() if not str(value or "").strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Data Biteship belum lengkap: {', '.join(missing)}")
    items = [
        {
            "name": it.get("nama_produk") or "Produk",
            "value": int(it.get("harga") or 0),
            "weight": int(it.get("weight") or it.get("berat_gram") or 250),
            "quantity": int(it.get("qty") or 1),
        }
        for it in (order.get("items") or [])
    ] or [{"name": "Pesanan", "value": int(order.get("subtotal") or 10000), "weight": 250, "quantity": 1}]
    body = {
        "reference_id": order.get("no_order") or order.get("id"),
        "shipper_contact_name": origin["contact_name"],
        "shipper_contact_phone": origin["contact_phone"],
        "origin_contact_name": origin["contact_name"],
        "origin_contact_phone": origin["contact_phone"],
        "origin_address": origin["address"],
        "origin_coordinate": {"latitude": origin["latitude"], "longitude": origin["longitude"]},
        "destination_contact_name": alamat["nama"],
        "destination_contact_phone": alamat["wa"],
        "destination_address": alamat["alamat"],
        "courier_company": company,
        "courier_type": service,
        "delivery_type": "now",
        "items": items,
    }
    if origin.get("note"):
        body["origin_note"] = origin["note"]
    if order.get("catatan"):
        body["destination_note"] = order["catatan"]
        body["order_note"] = order["catatan"]

    # Instant couriers require coordinates. Standard and COD orders follow the
    # documented postal-code payload, with coordinates as a safe fallback when
    # either postal code is unavailable.
    origin_pc = str(origin.get("postal_code") or "").strip()
    dest_pc = str(alamat.get("kode_pos") or "").strip()
    have_origin_coord = origin.get("latitude") is not None and origin.get("longitude") is not None
    have_dest_coord = dest.get("latitude") is not None and dest.get("longitude") is not None
    if is_instant:
        if not have_origin_coord or not have_dest_coord:
            raise HTTPException(status_code=400, detail="Kurir instant memerlukan koordinat asal dan tujuan")
        body["origin_coordinate"] = {"latitude": origin["latitude"], "longitude": origin["longitude"]}
        body["destination_coordinate"] = {"latitude": dest["latitude"], "longitude": dest["longitude"]}
    else:
        if origin_pc.isdigit():
            body["origin_postal_code"] = int(origin_pc)
        elif have_origin_coord:
            body["origin_coordinate"] = {"latitude": origin["latitude"], "longitude": origin["longitude"]}
        else:
            raise HTTPException(status_code=400, detail="Kode pos atau koordinat asal Biteship belum ada")
        if dest_pc.isdigit():
            body["destination_postal_code"] = int(dest_pc)
        elif have_dest_coord:
            body["destination_coordinate"] = {"latitude": dest["latitude"], "longitude": dest["longitude"]}
        else:
            raise HTTPException(status_code=400, detail="Kode pos atau koordinat tujuan Biteship belum ada")

    if is_cod:
        cod_type = (order.get("cod_disbursement_type") or "7_days").strip().lower()
        if cod_type not in {"7_days", "5_days", "3_days"}:
            raise HTTPException(status_code=400, detail="Tipe pencairan COD harus 7_days, 5_days, atau 3_days")
        cod_amount = int(order.get("total") or 0)
        if cod_amount <= 0:
            raise HTTPException(status_code=400, detail="Nilai COD harus lebih dari 0")
        body["destination_cash_on_delivery"] = cod_amount
        body["destination_cash_on_delivery_type"] = cod_type
    # Register courier insurance when the buyer paid for it (declared value = goods subtotal).
    if order.get("asuransi"):
        body["courier_insurance"] = int(order.get("subtotal") or 0)
    return body


async def _create_biteship_shipment(order: dict, courier_company: Optional[str] = None, courier_type: Optional[str] = None) -> dict:
    """Book a Biteship shipment for an order. Returns Biteship order data.
    Raises HTTPException if store origin / destination coordinate missing."""
    body = await _biteship_order_payload(order, courier_company, courier_type)
    data = await _biteship("POST", "/v1/orders", body)
    courier = data.get("courier") or {}
    waybill = courier.get("waybill_id")
    if not waybill and data.get("id"):
        # Standard couriers (JNE/Lion/dll) often allocate the AWB asynchronously —
        # fetch the order once so we don't store the Biteship id as a fake resi.
        try:
            fresh = await _biteship("GET", f"/v1/orders/{data['id']}")
            waybill = (fresh.get("courier") or {}).get("waybill_id") or waybill
        except Exception:
            pass
    data["courier"] = {**courier, "waybill_id": waybill}
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {
            "biteship_order_id": data.get("id"),
            "biteship_waybill": waybill,
            "biteship_tracking_id": courier.get("tracking_id") or data.get("id"),
        }},
    )
    return data


@api_router.post("/admin/orders/{order_id}/ship")
async def ship_order(order_id: str, payload: ShipOrderIn, admin: dict = Depends(require_admin)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    data = await _create_biteship_shipment(order, payload.courier_company, payload.courier_type)
    return {"ok": True, "biteship_order_id": data.get("id"), "courier": data.get("courier")}


@api_router.get("/admin/orders/{order_id}/biteship-payload")
async def biteship_payload_preview(order_id: str, admin: dict = Depends(require_admin)):
    """Show the exact JSON body our backend sends to Biteship POST /v1/orders for
    an order — for support tickets. Accepts the internal id or no_order (DS-...)."""
    order = await db.orders.find_one(
        {"$or": [{"id": order_id}, {"no_order": order_id}]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    try:
        payload = await _biteship_order_payload(order)
    except HTTPException as e:
        payload = {"error": e.detail}
    return {
        "no_order": order.get("no_order"),
        "biteship_order_id": order.get("biteship_order_id"),
        "biteship_waybill": order.get("biteship_waybill"),
        "no_resi": order.get("no_resi"),
        "biteship_last_status": order.get("biteship_last_status"),
        "courier_company": order.get("courier_company"),
        "courier_type": order.get("courier_type"),
        "request_payload": payload,
    }


@api_router.get("/orders/{order_id}/track")
async def track_order(order_id: str, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id, "deleted_at": None}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if user.get("role") != "admin" and order.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    tid = order.get("biteship_tracking_id")
    if not tid:
        # Non-Biteship (manual resi) order — no live tracking available.
        return {"tracked": False, "status": order.get("status"), "waybill": order.get("no_resi"), "history": []}
    data = await _biteship("GET", f"/v1/trackings/{tid}")
    # Persist the freshest waybill/status so labels & buyer pages always show the
    # real courier AWB (standard couriers assign it asynchronously after booking).
    fresh_waybill = data.get("waybill_id")
    fresh_status = (data.get("status") or "").lower() or None
    sets: dict = {}
    if fresh_waybill and fresh_waybill != order.get("biteship_waybill"):
        sets["biteship_waybill"] = fresh_waybill
        sets["no_resi"] = fresh_waybill
    if fresh_status:
        sets["biteship_last_status"] = fresh_status
    if sets:
        await db.orders.update_one({"id": order_id}, {"$set": sets})
    history = [
        {"status": h.get("status"), "note": h.get("note"), "updated_at": h.get("updated_at"), "service_type": h.get("service_type")}
        for h in (data.get("history") or [])
    ]
    return {
        "tracked": True,
        "status": data.get("status"),
        "waybill": data.get("waybill_id") or order.get("biteship_waybill"),
        "courier": data.get("courier"),
        "link": data.get("link"),
        "history": history,
    }


@api_router.post("/biteship/webhook")
async def biteship_webhook(request: Request):
    """Receive Biteship courier status updates. Keeps the order's resi/status
    in sync and auto-marks delivered orders as selesai."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}
    oid = body.get("order_id") or body.get("id")
    ref = body.get("reference_id")
    status = (body.get("status") or body.get("courier_status") or "").lower()
    query = {"biteship_order_id": oid} if oid else ({"no_order": ref} if ref else None)
    if not query:
        return {"ok": True}
    order = await db.orders.find_one(query, {"_id": 0})
    if not order:
        return {"ok": True}
    waybill = body.get("courier_waybill_id") or body.get("waybill_id")
    sets: dict = {}
    if waybill:
        sets["biteship_waybill"] = waybill
        sets["no_resi"] = waybill
    sets["biteship_last_status"] = status
    ops: dict = {"$set": sets}
    if status == "delivered" and order.get("status") == "dikirim":
        sets["status"] = "selesai"
        ops["$push"] = {"status_history": {"status": "selesai", "at": datetime.now(timezone.utc)}}
    elif status == "cancelled" and order.get("status") in ("dikirim", "sedang_dikemas"):
        sets["status"] = "dibatalkan"
        ops["$push"] = {"status_history": {"status": "dibatalkan", "at": datetime.now(timezone.utc)}}
    await db.orders.update_one({"id": order["id"]}, ops)
    await sio.emit(
        "order_status",
        {"id": order.get("id"), "no_order": order.get("no_order"), "status": sets.get("status", order.get("status")), "no_resi": sets.get("no_resi") or order.get("no_resi")},
        room=order.get("user_id"),
    )
    return {"ok": True}





# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Diana Stuff API"}


@api_router.get("/profil_admin")
async def get_profil_admin():
    profil = await db.profil_admin.find_one({}, {"_id": 0})
    if not profil:
        raise HTTPException(status_code=404, detail="Profil admin belum diatur")
    return profil


@api_router.post("/auth/session")
async def auth_session(payload: SessionExchange):
    """Exchange an Emergent Google OAuth session_id for an app session token."""
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(
            EMERGENT_SESSION_DATA_URL,
            headers={"X-Session-ID": payload.session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Sesi Google tidak valid")
    data = resp.json()
    email = data.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Data Google tidak lengkap")

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "nama": existing.get("nama") or data.get("name"),
                "picture": data.get("picture"),
                "deleted_at": None,
            }},
        )
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "username": None,
            "password_hash": None,
            "role": "buyer",
            "nama": data.get("name"),
            "wa": None,
            "alamat": None,
            "kota": None,
            "kode_pos": None,
            "status": "approved",
            "auth_provider": "google",
            "picture": data.get("picture"),
            "created_at": datetime.now(timezone.utc),
            "deleted_at": None,
        }
        await db.users.insert_one(user)

    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(user)}


@api_router.post("/auth/login-email")
async def login_email(payload: SessionExchange):
    """Alias for the Google OAuth exchange (see /auth/session)."""
    return await auth_session(payload)


@api_router.post("/auth/register-whitelist")
async def register_whitelist(payload: RegisterWhitelist):
    username = payload.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username minimal 3 karakter")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")

    if await db.users.find_one({"username": username, "deleted_at": None}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    if payload.email:
        if await db.users.find_one({"email": payload.email, "deleted_at": None}):
            raise HTTPException(status_code=409, detail="Email sudah terdaftar")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": payload.email,
        "username": username,
        "password_hash": hash_password(payload.password),
        "role": "buyer",
        "nama": payload.nama.strip(),
        "wa": payload.wa,
        "alamat": None,
        "kota": None,
        "kode_pos": None,
        "status": "pending",
        "auth_provider": "whitelist",
        "picture": None,
        "created_at": datetime.now(timezone.utc),
        "deleted_at": None,
    }
    await db.users.insert_one(user)
    return {
        "message": "Pendaftaran berhasil. Akun Anda menunggu persetujuan admin.",
        "status": "pending",
    }


@api_router.post("/auth/login-whitelist")
async def login_whitelist(payload: LoginWhitelist):
    username = payload.username.strip().lower()
    user = await db.users.find_one({"username": username, "deleted_at": None})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    if user.get("role") != "admin" and user.get("status") != "approved":
        raise HTTPException(status_code=403, detail="Akun Anda menunggu persetujuan admin")

    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"message": "Berhasil keluar"}


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePassword, authorization: Optional[str] = Header(None)):
    """Change the logged-in user's own password.

    Verifies the old password, validates the new one, replaces the bcrypt hash,
    then revokes ALL existing sessions and returns a fresh rotated token.
    """
    user = await get_current_user(authorization)
    if not payload.old_password or not payload.new_password:
        raise HTTPException(status_code=400, detail="Sandi lama dan baru wajib diisi")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Kata sandi baru minimal 6 karakter")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=400, detail="Kata sandi baru harus berbeda dari yang lama")

    full = await db.users.find_one({"user_id": user["user_id"]})
    if not full or not full.get("password_hash"):
        raise HTTPException(status_code=400, detail="Akun ini tidak memakai kata sandi")
    if not verify_password(payload.old_password, full["password_hash"]):
        raise HTTPException(status_code=401, detail="Kata sandi lama salah")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    # Revoke every existing session (including this one) and rotate.
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    new_token = await create_session(user["user_id"])
    return {"session_token": new_token, "message": "Kata sandi berhasil diubah"}


# ---------------------------------------------------------------------------
# Uploads / file serving (Emergent Object Storage)
# ---------------------------------------------------------------------------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Ukuran foto maksimal 8MB")
    content_type = file.content_type or "image/jpeg"
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    if len(ext) > 5:
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, content_type)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 500
        if status == 402:
            raise HTTPException(status_code=402, detail="Kuota penyimpanan habis")
        raise HTTPException(status_code=502, detail="Gagal mengunggah foto")
    return {"path": path, "url": f"/api/files/{path}"}


@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    # Public read: store branding + catalog photos are meant to be shown to
    # everyone, including the unauthenticated login screen.
    try:
        content, content_type = await run_in_threadpool(get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="File tidak ditemukan")
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# AI (Emergent LLM key | OpenAI-compatible fallback, e.g. 9Router)
# ---------------------------------------------------------------------------
# Product vision/image editing prefers the native Gemini API when
# GEMINI_API_KEY is present. Otherwise the OpenAI-compatible endpoint at
# OPENAI_BASE_URL is used, followed by the legacy Emergent integration.
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
AI_VISION_MODEL = os.environ.get("AI_VISION_MODEL", "gemini-3-flash-preview")
AI_IMAGE_MODEL = os.environ.get("AI_IMAGE_MODEL", "gemini-3.1-flash-image-preview")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_VISION_MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-3-flash-preview")
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")

_multi_modal_roles = None  # cached from first response


def _use_openai_compat() -> bool:
    return bool(OPENAI_BASE_URL and OPENAI_API_KEY)


def _openai_client():
    from openai import OpenAI
    return OpenAI(base_url=OPENAI_BASE_URL, api_key=OPENAI_API_KEY)


def _extract_json_obj(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL)
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        return json.loads(m.group(0)) if m else {}


def _normalize_product_info(data: object) -> dict:
    """Normalize common model field aliases into the API's Indonesian contract."""
    if not isinstance(data, dict):
        return {}
    aliases = {
        "nama_produk": ("nama_produk", "nama", "product_name", "name", "title"),
        "deskripsi": ("deskripsi", "description", "product_description"),
        "kategori": ("kategori", "category", "product_category"),
    }
    normalized: dict[str, str] = {}
    for target, candidates in aliases.items():
        for candidate in candidates:
            value = data.get(candidate)
            if isinstance(value, str) and value.strip():
                normalized[target] = value.strip()
                break
    return normalized


def _compat_response_text(resp: object) -> str:
    """Extract text from common OpenAI-compatible chat response shapes."""
    choices = getattr(resp, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    if message is None:
        return str(getattr(choices[0], "text", None) or "")

    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                value = part.get("text")
                if isinstance(value, dict):
                    value = value.get("value")
            else:
                value = getattr(part, "text", None)
                if value is not None and not isinstance(value, str):
                    value = getattr(value, "value", None)
            if isinstance(value, str):
                parts.append(value)
        return "\n".join(parts)
    return ""


# --- OpenAI-compatible fallback paths --------------------------------------
def _compat_product_info(b64: str, mime: str = "image/jpeg") -> str:
    client = _openai_client()
    resp = client.chat.completions.create(
        model=AI_VISION_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Anda asisten katalog toko online fashion di Indonesia. Lihat foto produk lalu buat "
                    "data produk dalam Bahasa Indonesia yang menjual. Balas HANYA JSON valid (tanpa teks "
                    "lain, tanpa markdown) dengan kunci persis: nama_produk (singkat & menarik, maks 8 kata), "
                    "deskripsi (2-4 kalimat, sebut bahan/warna/model/kegunaan jika terlihat), kategori "
                    "(satu kata/frasa singkat mis. Baju, Tas, Sepatu, Aksesoris, Celana). Jangan mengarang harga."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Buatkan nama_produk, deskripsi, dan kategori untuk produk pada foto ini. Balas JSON saja."},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            },
        ],
        max_tokens=700,
        temperature=0.2,
    )
    return _compat_response_text(resp)


def _image_from_data_url(value: object) -> Optional[dict]:
    if not isinstance(value, str) or not value.startswith("data:image/") or "," not in value:
        return None
    header, data = value.split(",", 1)
    mime = header[5:].split(";", 1)[0] or "image/png"
    if not data:
        return None
    return {"data": data, "mime_type": mime}


def _compat_response_images(resp: object) -> list[dict]:
    """Extract image data URLs from common OpenAI-compatible chat shapes."""
    choices = getattr(resp, "choices", None) or []
    msg = getattr(choices[0], "message", None) if choices else None
    found: list[dict] = []
    if msg is None:
        return found

    for image in (getattr(msg, "images", None) or []):
        image_url = getattr(image, "image_url", None)
        value = getattr(image_url, "url", None) if image_url is not None else None
        parsed = _image_from_data_url(value)
        if parsed:
            found.append(parsed)

    content = getattr(msg, "content", None)
    if isinstance(content, str):
        parsed = _image_from_data_url(content.strip())
        if parsed:
            found.append(parsed)
        else:
            match = re.search(r"data:image/[^;\s]+;base64,[A-Za-z0-9+/=]+", content)
            parsed = _image_from_data_url(match.group(0)) if match else None
            if parsed:
                found.append(parsed)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                image_url = part.get("image_url") or part.get("url")
                value = image_url.get("url") if isinstance(image_url, dict) else image_url
            else:
                image_url = getattr(part, "image_url", None)
                value = getattr(image_url, "url", None) if image_url is not None else getattr(part, "url", None)
            parsed = _image_from_data_url(value)
            if parsed:
                found.append(parsed)
    return found


def _compat_enhance_photo(b64: str, mime: str = "image/jpeg") -> tuple[str, list[dict]]:
    client = _openai_client()
    prompt = (
        "Edit this product photo into a clean, professional e-commerce advertising photo suitable "
        "for an online shop listing. Place the product on a soft, neutral studio background with "
        "bright, even lighting and a subtle natural shadow. Remove clutter and any distracting "
        "background. Keep the product itself EXACTLY the same (same shape, color, texture, logo) and "
        "centered. Square framing, high quality, realistic."
    )
    resp = None
    try:
        # 9Router translates OpenAI-compatible multimodal chat requests to the
        # selected image-capable provider. The model must support image output.
        resp = client.chat.completions.create(
            model=AI_IMAGE_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]}],
            modalities=["text", "image"],
            max_tokens=4000,
        )
    except Exception as e:
        logger.error(f"OpenAI-compatible image edit error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="Gagal memproses foto dengan AI")
    images = _compat_response_images(resp)
    if images:
        return "", images
    raise HTTPException(status_code=502, detail="AI tidak menghasilkan foto")


def _gemini_response_images(payload: object) -> list[dict]:
    """Extract native Gemini inline image parts without logging image data."""
    if not isinstance(payload, dict):
        return []
    found: list[dict] = []
    for candidate in payload.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline, dict):
                continue
            data = inline.get("data")
            mime_type = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            if isinstance(data, str) and data:
                found.append({"data": data, "mime_type": mime_type})
    return found


def _gemini_response_text(payload: object) -> str:
    """Extract text parts from a native Gemini generateContent response."""
    if not isinstance(payload, dict):
        return ""
    parts: list[str] = []
    for candidate in payload.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
    return "\n".join(parts)


def _gemini_product_info(b64: str, mime: str = "image/jpeg") -> str:
    """Generate catalog fields through Google's native Gemini API."""
    if not re.fullmatch(r"[A-Za-z0-9._-]+", GEMINI_VISION_MODEL):
        raise HTTPException(status_code=500, detail="Model Gemini vision tidak valid")
    prompt = (
        "Anda asisten katalog toko online fashion di Indonesia. Lihat foto produk lalu buat data "
        "produk dalam Bahasa Indonesia yang menjual. Balas HANYA JSON valid tanpa markdown dengan "
        "kunci persis: nama_produk (singkat, maksimal 8 kata), deskripsi (2-4 kalimat), dan kategori "
        "(satu kata atau frasa singkat). Sebut bahan, warna, model, dan kegunaan hanya jika terlihat. "
        "Jangan mengarang harga."
    )
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_VISION_MODEL}:generateContent"
    )
    try:
        response = requests.post(
            url,
            headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": mime, "data": b64}},
                ]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 700,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": {
                        "type": "object",
                        "properties": {
                            "nama_produk": {
                                "type": "string",
                                "description": "Nama produk dalam Bahasa Indonesia, maksimal 8 kata",
                            },
                            "deskripsi": {
                                "type": "string",
                                "description": "Deskripsi produk dalam Bahasa Indonesia, 2-4 kalimat",
                            },
                            "kategori": {
                                "type": "string",
                                "description": "Kategori produk berupa satu kata atau frasa singkat",
                            },
                        },
                        "required": ["nama_produk", "deskripsi", "kategori"],
                        "additionalProperties": False,
                    },
                },
            },
            timeout=90,
        )
        response.raise_for_status()
        return _gemini_response_text(response.json())
    except requests.RequestException as e:
        status = e.response.status_code if e.response is not None else None
        logger.error("Gemini product-info request failed (status=%s, type=%s)", status, type(e).__name__)
        raise HTTPException(status_code=502, detail="Gagal membuat data dengan Gemini")
    except (TypeError, ValueError) as e:
        logger.error("Gemini product-info response invalid (type=%s)", type(e).__name__)
        raise HTTPException(status_code=502, detail="Respons Gemini tidak valid")


def _gemini_enhance_photo(b64: str, mime: str = "image/jpeg") -> list[dict]:
    """Edit a product image through Google's native Gemini generateContent API."""
    if not re.fullmatch(r"[A-Za-z0-9._-]+", GEMINI_IMAGE_MODEL):
        raise HTTPException(status_code=500, detail="Model Gemini tidak valid")
    prompt = (
        "Edit this product photo into a clean, professional e-commerce advertising photo suitable "
        "for an online shop listing. Replace only the background with a soft neutral studio setting, "
        "bright even lighting, and a subtle natural shadow. Remove clutter. Preserve the product "
        "exactly: same shape, proportions, color, texture, pattern, text, and logo. Do not add or "
        "remove product details. Center the product in a square, realistic composition."
    )
    url = (
        "https://generativelanguage.googleapis.com/v1/models/"
        f"{GEMINI_IMAGE_MODEL}:generateContent"
    )
    try:
        response = requests.post(
            url,
            headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": mime, "data": b64}},
                ]}],
                "generationConfig": {"responseModalities": ["IMAGE"]},
            },
            timeout=120,
        )
        response.raise_for_status()
        images = _gemini_response_images(response.json())
    except requests.RequestException as e:
        status = e.response.status_code if e.response is not None else None
        logger.error("Gemini image edit request failed (status=%s, type=%s)", status, type(e).__name__)
        raise HTTPException(status_code=502, detail="Gagal memproses foto dengan Gemini")
    except (TypeError, ValueError) as e:
        logger.error("Gemini image edit response invalid (type=%s)", type(e).__name__)
        raise HTTPException(status_code=502, detail="Respons Gemini tidak valid")
    if not images:
        logger.warning("Gemini image edit returned no image (model=%s)", GEMINI_IMAGE_MODEL)
        raise HTTPException(status_code=502, detail="Gemini tidak menghasilkan foto")
    return images
def _storage_path_from_url(foto_url: str) -> Optional[str]:
    """Resolve an app photo reference to its object-storage path."""
    if not foto_url:
        return None
    marker = "/api/files/"
    if marker in foto_url:
        return foto_url.split(marker, 1)[1]
    if foto_url.startswith("http://") or foto_url.startswith("https://"):
        return None
    return foto_url.lstrip("/")


def _load_image_b64(foto_url: str) -> tuple[str, str]:
    """Return (base64_str, mime) for a product photo (storage path or http url)."""
    path = _storage_path_from_url(foto_url)
    if path:
        content, mime = get_object(path)
    else:
        resp = requests.get(foto_url, timeout=60)
        resp.raise_for_status()
        content, mime = resp.content, resp.headers.get("Content-Type", "image/jpeg")
    if not mime or not mime.startswith("image/"):
        mime = "image/jpeg"
    return base64.b64encode(content).decode("utf-8"), mime


class AiPhotoIn(BaseModel):
    foto_url: str


@api_router.post("/admin/ai/product-info")
async def ai_product_info(payload: AiPhotoIn, admin: dict = Depends(require_admin)):
    if not GEMINI_API_KEY and not _use_openai_compat() and not EMERGENT_KEY:
        raise HTTPException(status_code=503, detail="AI belum dikonfigurasi")
    try:
        b64, mime = await run_in_threadpool(_load_image_b64, payload.foto_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Foto tidak dapat dibaca")

    if GEMINI_API_KEY or _use_openai_compat():
        try:
            if GEMINI_API_KEY:
                raw = await run_in_threadpool(_gemini_product_info, b64, mime)
                provider = "Gemini"
                model = GEMINI_VISION_MODEL
            else:
                raw = await run_in_threadpool(_compat_product_info, b64, mime)
                provider = "OpenAI-compatible"
                model = AI_VISION_MODEL
            data = _normalize_product_info(_extract_json_obj(raw))
            if not isinstance(data, dict) or not any(
                str(data.get(key) or "").strip()
                for key in ("nama_produk", "deskripsi", "kategori")
            ):
                logger.warning(
                    "%s product-info returned no usable fields "
                    "(model=%s, content_length=%d)",
                    provider,
                    model,
                    len(raw),
                )
                raise HTTPException(
                    status_code=502,
                    detail="AI tidak menghasilkan data produk yang valid",
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"OpenAI-compatible product-info error: {type(e).__name__}: {e}")
            raise HTTPException(status_code=502, detail="Gagal membuat data AI")
        return {
            "nama_produk": (data.get("nama_produk") or "").strip()[:120],
            "deskripsi": (data.get("deskripsi") or "").strip()[:1500],
            "kategori": (data.get("kategori") or "").strip()[:60],
        }

    from emergentintegrations.llm.chat import ImageContent, LlmChat, StreamDone, TextDelta, UserMessage

    chat = LlmChat(
        api_key=EMERGENT_KEY,
        session_id=f"prodinfo_{uuid.uuid4().hex[:8]}",
        system_message=(
            "Anda asisten katalog toko online fashion di Indonesia. Lihat foto produk lalu buat "
            "data produk dalam Bahasa Indonesia yang menjual. Balas HANYA JSON valid (tanpa teks "
            "lain, tanpa markdown) dengan kunci persis: nama_produk (singkat & menarik, maks 8 kata), "
            "deskripsi (2-4 kalimat, sebut bahan/warna/model/kegunaan jika terlihat), kategori "
            "(satu kata/frasa singkat mis. Baju, Tas, Sepatu, Aksesoris, Celana). Jangan mengarang harga."
        ),
    ).with_model("gemini", "gemini-3-flash-preview")

    msg = UserMessage(
        text="Buatkan nama_produk, deskripsi, dan kategori untuk produk pada foto ini. Balas JSON saja.",
        file_contents=[ImageContent(image_base64=b64)],
    )
    buf = ""
    try:
        async for ev in chat.stream_message(msg):
            if isinstance(ev, TextDelta):
                buf += ev.content
            elif isinstance(ev, StreamDone):
                break
    except Exception as e:
        logger.error(f"AI product-info error: {e}")
        raise HTTPException(status_code=502, detail="Gagal membuat data AI")

    raw = buf.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.DOTALL)
    try:
        data = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
    return {
        "nama_produk": (data.get("nama_produk") or "").strip()[:120],
        "deskripsi": (data.get("deskripsi") or "").strip()[:1500],
        "kategori": (data.get("kategori") or "").strip()[:60],
    }


@api_router.post("/admin/ai/enhance-photo")
async def ai_enhance_photo(payload: AiPhotoIn, admin: dict = Depends(require_admin)):
    if not GEMINI_API_KEY and not _use_openai_compat() and not EMERGENT_KEY:
        raise HTTPException(status_code=503, detail="AI belum dikonfigurasi")
    try:
        b64, mime = await run_in_threadpool(_load_image_b64, payload.foto_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Foto tidak dapat dibaca")

    if GEMINI_API_KEY:
        images = await run_in_threadpool(_gemini_enhance_photo, b64, mime)
    elif _use_openai_compat():
        _text, images = await run_in_threadpool(_compat_enhance_photo, b64, mime)
    else:
        from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

        chat = LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"enhance_{uuid.uuid4().hex[:8]}",
            system_message="You are a professional e-commerce product photo retoucher.",
        ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

        prompt = (
            "Edit this product photo into a clean, professional e-commerce advertising photo suitable "
            "for an online shop listing. Place the product on a soft, neutral studio background with "
            "bright, even lighting and a subtle natural shadow. Remove clutter and any distracting "
            "background. Keep the product itself EXACTLY the same (same shape, color, texture, logo) and "
            "centered. Square framing, high quality, realistic."
        )
        msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
        try:
            _text, images = await chat.send_message_multimodal_response(msg)
        except Exception as e:
            logger.error(f"AI enhance error: {e}")
            raise HTTPException(status_code=502, detail="Gagal memproses foto dengan AI")
    if not images:
        raise HTTPException(status_code=502, detail="AI tidak menghasilkan foto")

    img = images[0]
    out_bytes = base64.b64decode(img["data"])
    out_mime = img.get("mime_type") or "image/png"
    ext = "png" if "png" in out_mime else "jpg"
    out_path = f"{APP_NAME}/uploads/{admin['user_id']}/ai_{uuid.uuid4().hex}.{ext}"
    try:
        await run_in_threadpool(put_object, out_path, out_bytes, out_mime)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 500
        if status == 402:
            raise HTTPException(status_code=402, detail="Kuota penyimpanan habis")
        raise HTTPException(status_code=502, detail="Gagal menyimpan foto AI")
    return {"path": out_path, "url": f"/api/files/{out_path}"}


@api_router.api_route("/download/web.zip", methods=["GET", "HEAD"])
async def download_web_bundle():
    zip_path = ROOT_DIR / "static_downloads" / "web.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Bundle belum tersedia")
    return FileResponse(
        path=str(zip_path),
        filename="dianastuff-web.zip",
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dianastuff-web.zip"'},
    )


@api_router.api_route("/download/landing.zip", methods=["GET", "HEAD"])
async def download_landing_bundle():
    zip_path = ROOT_DIR / "static_downloads" / "landing.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Bundle belum tersedia")
    return FileResponse(
        path=str(zip_path),
        filename="dianastuff-landing.zip",
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dianastuff-landing.zip"'},
    )


@api_router.api_route("/download/app.apk", methods=["GET", "HEAD"])
async def download_app_apk():
    apk_path = ROOT_DIR / "static_downloads" / "app.apk"
    if not apk_path.exists():
        raise HTTPException(status_code=404, detail="APK belum tersedia")
    return FileResponse(
        path=str(apk_path),
        filename="dianastuff.apk",
        media_type="application/vnd.android.package-archive",
        headers={"Content-Disposition": 'attachment; filename="dianastuff.apk"'},
    )


@api_router.api_route("/download/backup.zip", methods=["GET", "HEAD"])
async def download_backup_bundle():
    zip_path = ROOT_DIR / "static_downloads" / "backup.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Backup belum tersedia")
    return FileResponse(
        path=str(zip_path),
        filename="dianastuff-backup.zip",
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dianastuff-backup.zip"'},
    )


@api_router.api_route("/download/db-dump.zip", methods=["GET", "HEAD"])
async def download_db_dump():
    zip_path = ROOT_DIR / "static_downloads" / "db-dump.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="DB dump belum tersedia")
    return FileResponse(
        path=str(zip_path),
        filename="dianastuff-db-dump.zip",
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dianastuff-db-dump.zip"'},
    )

@api_router.api_route("/download/BASELINE_AUDIT.md", methods=["GET", "HEAD"])
async def download_baseline_audit():
    doc_path = ROOT_DIR.parent / "BASELINE_AUDIT.md"
    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="Audit belum tersedia")
    return FileResponse(
        path=str(doc_path),
        filename="BASELINE_AUDIT.md",
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="BASELINE_AUDIT.md"'},
    )





# ---------------------------------------------------------------------------
# Products (public read; admin write)
# ---------------------------------------------------------------------------
@api_router.get("/products")
async def list_products(search: Optional[str] = None):
    query: dict = {"deleted_at": None}
    if search:
        query["$or"] = [
            {"nama_produk": {"$regex": search, "$options": "i"}},
            {"kategori": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.products.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    ids = [d.get("id") for d in docs]
    sold = await _sold_map(ids)
    rmap = await _rating_map(ids)
    return [
        product_public(d, sold.get(d.get("id"), 0), rmap.get(d.get("id"), {}).get("rating", 0), rmap.get(d.get("id"), {}).get("count", 0))
        for d in docs
    ]


@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    doc = await db.products.find_one({"id": product_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    sold = await _sold_map([product_id])
    rmap = await _rating_map([product_id])
    rm = rmap.get(product_id, {})
    return product_public(doc, sold.get(product_id, 0), rm.get("rating", 0), rm.get("count", 0))


async def _user_from_bearer(authorization: Optional[str]) -> Optional[dict]:
    """Resolve the logged-in user from a Bearer token, or None for guests."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    return await db.users.find_one({"user_id": session["user_id"], "deleted_at": None}, {"_id": 0})


@api_router.post("/products/{product_id}/view")
async def track_product_view(product_id: str, authorization: Optional[str] = Header(None)):
    """Record a storefront product view (buyers & guests). Powers the
    'Dilihat X' counter and the seller visitor analytics."""
    doc = await db.products.find_one({"id": product_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    user = await _user_from_bearer(authorization)
    await db.products.update_one({"id": product_id}, {"$inc": {"views": 1}})
    await db.product_views.insert_one({
        "product_id": product_id,
        "product_nama": doc.get("nama_produk"),
        "user_id": user.get("user_id") if user else None,
        "viewer_name": (user.get("nama") or user.get("username")) if user else "Tamu",
        "at": datetime.now(timezone.utc),
    })
    return {"ok": True, "views": doc.get("views", 0) + 1}


# ---------------------------------------------------------------------------
# Live shopping (Agora) — single active show for this single-tenant store.
# ---------------------------------------------------------------------------
from agora_token_builder import RtcTokenBuilder  # noqa: E402

LIVE_CHANNEL = "dianastuff_live"
# ---- Live session state disimpan di MongoDB (bukan memori) supaya realtime ----
# ---- tetap konsisten walau produksi jalan di banyak worker/replika.      ----
LIVE_REACTIONS = {"❤️", "👍", "😍", "🔥", "👏", "😮"}


async def _live_state() -> dict:
    doc = await db.live_state.find_one({"_id": "current"})
    if not doc:
        doc = {
            "_id": "current",
            "pinned": None,
            "total_likes": 0,
            "peak_viewers": 0,
            "muted": [],
            "kicked": [],
            "react_seq": 0,
        }
        await db.live_state.insert_one(doc)
    return doc


async def _reset_live_state() -> None:
    await db.live_state.update_one(
        {"_id": "current"},
        {"$set": {"pinned": None, "total_likes": 0, "peak_viewers": 0, "muted": [], "kicked": [], "react_seq": 0, "msg_seq": 0}},
        upsert=True,
    )
    await db.live_messages.delete_many({})
    await db.live_reactions.delete_many({})
    await db.live_presence.delete_many({})


async def _optional_user(request: Request) -> Optional[dict]:
    token = request.headers.get("authorization", "").replace("Bearer ", "").strip()
    if not token:
        return None
    return await _user_from_token(token)


class LiveStart(BaseModel):
    title: str = "Live Shopping"
    caption: str = ""
    product_ids: List[str] = []
    show_cart: bool = True
    require_login: bool = False
    featured_product_id: Optional[str] = None


class LiveFeature(BaseModel):
    product_id: Optional[str] = None


async def live_public(show: dict) -> dict:
    prods = []
    if show.get("product_ids"):
        docs = await db.products.find(
            {"id": {"$in": show["product_ids"]}, "deleted_at": None}, {"_id": 0}
        ).to_list(50)
        by_id = {p["id"]: product_public(p) for p in docs}
        prods = [by_id[pid] for pid in show["product_ids"] if pid in by_id]
    featured = None
    fid = show.get("featured_product_id")
    if fid:
        fdoc = await db.products.find_one({"id": fid, "deleted_at": None}, {"_id": 0})
        if fdoc:
            featured = product_public(fdoc)
    profil = await db.profil_admin.find_one({}, {"_id": 0}) or {}
    return {
        "channel": show.get("channel", LIVE_CHANNEL),
        "title": show.get("title", "Live Shopping"),
        "caption": show.get("caption", ""),
        "show_cart": show.get("show_cart", True),
        "require_login": show.get("require_login", False),
        "featured": featured,
        "whatsapp": profil.get("whatsapp", ""),
        "status": show.get("status", "ended"),
        "products": prods,
        "started_at": show["started_at"].isoformat() if show.get("started_at") else None,
    }


@api_router.get("/live/current")
async def live_current():
    show = await db.live_shows.find_one({"status": "live"}, {"_id": 0})
    if not show:
        return {"live": False}
    return {"live": True, **(await live_public(show))}


@api_router.post("/live/start")
async def live_start(payload: LiveStart, admin: dict = Depends(require_admin)):
    await db.live_shows.update_many({"status": "live"}, {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc)}})
    featured = payload.featured_product_id
    if featured and featured not in payload.product_ids:
        featured = None
    show = {
        "id": f"live_{uuid.uuid4().hex[:12]}",
        "channel": LIVE_CHANNEL,
        "title": payload.title.strip() or "Live Shopping",
        "caption": (payload.caption or "").strip(),
        "product_ids": payload.product_ids,
        "show_cart": bool(payload.show_cart),
        "require_login": bool(payload.require_login),
        "featured_product_id": featured,
        "status": "live",
        "host_uid": 1,
        "started_at": datetime.now(timezone.utc),
    }
    await db.live_shows.insert_one(show)
    await _reset_live_state()
    doc = await db.live_shows.find_one({"id": show["id"]}, {"_id": 0})
    await sio.emit("live_status", {"live": True, "channel": LIVE_CHANNEL})
    return {"live": True, **(await live_public(doc))}


@api_router.post("/live/feature")
async def live_feature(payload: LiveFeature, admin: dict = Depends(require_admin)):
    show = await db.live_shows.find_one({"status": "live"})
    if not show:
        raise HTTPException(status_code=400, detail="Tidak ada siaran live")
    fid = payload.product_id
    if fid and fid not in (show.get("product_ids") or []):
        raise HTTPException(status_code=400, detail="Produk tidak ada di daftar live")
    await db.live_shows.update_one({"id": show["id"]}, {"$set": {"featured_product_id": fid}})
    featured = None
    if fid:
        fdoc = await db.products.find_one({"id": fid, "deleted_at": None}, {"_id": 0})
        if fdoc:
            featured = product_public(fdoc)
    await sio.emit("live_feature", {"featured": featured}, room=["live", "admins"])
    return {"featured": featured}


async def _build_recap(show: dict) -> dict:
    started = show.get("started_at")
    ended = show.get("ended_at") or datetime.now(timezone.utc)
    orders_count = 0
    orders_total = 0.0
    if started:
        cur = db.orders.find({"created_at": {"$gte": started, "$lte": ended}}, {"_id": 0, "total": 1})
        async for o in cur:
            orders_count += 1
            orders_total += float(o.get("total") or 0)
    state = await _live_state()
    return {
        "peak_viewers": int(state.get("peak_viewers", 0)),
        "total_likes": int(state.get("total_likes", 0)),
        "orders_count": orders_count,
        "orders_total": orders_total,
    }


@api_router.post("/live/stop")
async def live_stop(admin: dict = Depends(require_admin)):
    show = await db.live_shows.find_one({"status": "live"})
    ended_at = datetime.now(timezone.utc)
    if show:
        show["ended_at"] = ended_at
        recap = await _build_recap(show)
        # Snapshot the live chat transcript so admin can review it afterwards.
        chat_log = await db.live_messages.find({}, {"_id": 0}).sort("seq", 1).to_list(500)
        await db.live_shows.update_one(
            {"id": show["id"]},
            {"$set": {"status": "ended", "ended_at": ended_at, "recap": recap, "chat_log": chat_log}},
        )
    else:
        await db.live_shows.update_many({"status": "live"}, {"$set": {"status": "ended", "ended_at": ended_at}})
    await _reset_live_state()
    await sio.emit("live_status", {"live": False})
    await sio.emit("live_viewers", {"count": 0, "viewers": []}, room=["live", "admins"])
    return {"live": False}


@api_router.get("/admin/live-history")
async def live_history(admin: dict = Depends(require_admin)):
    docs = await db.live_shows.find({"status": "ended"}, {"_id": 0}).sort("started_at", -1).to_list(50)
    out = []
    for d in docs:
        out.append({
            "id": d.get("id"),
            "title": d.get("title", "Live Shopping"),
            "started_at": d["started_at"].isoformat() if d.get("started_at") else None,
            "ended_at": d["ended_at"].isoformat() if d.get("ended_at") else None,
            "recap": d.get("recap") or {"peak_viewers": 0, "total_likes": 0, "orders_count": 0, "orders_total": 0},
        })
    return out


@api_router.delete("/admin/live-history/{show_id}")
async def delete_live_history(show_id: str, admin: dict = Depends(require_admin)):
    res = await db.live_shows.delete_one({"id": show_id, "status": "ended"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rekap tidak ditemukan")
    return {"ok": True}


@api_router.get("/admin/live-history/{show_id}/chat")
async def live_history_chat(show_id: str, admin: dict = Depends(require_admin)):
    doc = await db.live_shows.find_one({"id": show_id}, {"_id": 0, "title": 1, "chat_log": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Rekap tidak ditemukan")
    return {"title": doc.get("title", "Live Shopping"), "messages": doc.get("chat_log") or []}


# ---- Live shopping realtime via MongoDB + REST polling (multi-worker safe) ----
class LiveChatIn(BaseModel):
    viewer_id: Optional[str] = None
    name: Optional[str] = None
    text: str = ""


class LiveReactIn(BaseModel):
    emoji: Optional[str] = "❤️"
    viewer_id: Optional[str] = None


class LivePresenceIn(BaseModel):
    viewer_id: Optional[str] = None
    name: Optional[str] = None


class LivePinIn(BaseModel):
    message: Optional[dict] = None


class LiveModIn(BaseModel):
    uid: str
    mute: bool = True


async def _live_viewer(request: Request, viewer_id: Optional[str]) -> dict:
    user = await _optional_user(request)
    if user:
        return {
            "uid": user["user_id"],
            "user_id": user["user_id"],
            "name": user.get("nama") or user.get("username") or "Tamu",
            "role": user.get("role", "buyer"),
        }
    vid = (viewer_id or "").strip() or uuid.uuid4().hex
    return {"uid": f"guest_{vid}", "user_id": f"guest_{vid}", "name": "Tamu", "role": "guest"}


async def _next_seq(field: str) -> int:
    doc = await db.live_state.find_one_and_update(
        {"_id": "current"},
        {"$inc": {field: 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc.get(field, 1))


@api_router.post("/live/chat")
async def live_chat_post(payload: LiveChatIn, request: Request):
    show = await db.live_shows.find_one({"status": "live"})
    if not show:
        raise HTTPException(status_code=400, detail="Tidak ada siaran live")
    viewer = await _live_viewer(request, payload.viewer_id)
    state = await _live_state()
    if viewer["uid"] in (state.get("kicked") or []):
        raise HTTPException(status_code=403, detail="Anda dikeluarkan dari live")
    if viewer["uid"] in (state.get("muted") or []):
        return {"ok": False, "muted": True}
    text = (payload.text or "").strip()[:300]
    if not text:
        return {"ok": False}
    # Anti-spoofing: authenticated users always chat under their account name;
    # only guests may pick a display name.
    if viewer["role"] != "guest":
        name = viewer["name"]
    else:
        name = ((payload.name or viewer["name"]) or "Tamu").strip()[:40] or "Tamu"
    seq = await _next_seq("msg_seq")
    msg = {
        "id": uuid.uuid4().hex[:12],
        "seq": seq,
        "uid": viewer["uid"],
        "name": name,
        "role": viewer["role"],
        "text": text,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await db.live_messages.insert_one(dict(msg))
    return {"ok": True, "message": msg}


@api_router.post("/live/react")
async def live_react_post(payload: LiveReactIn):
    show = await db.live_shows.find_one({"status": "live"})
    if not show:
        return {"ok": False}
    emoji = payload.emoji if payload.emoji in LIVE_REACTIONS else "❤️"
    seq = await _next_seq("react_seq")
    await db.live_state.update_one({"_id": "current"}, {"$inc": {"total_likes": 1}}, upsert=True)
    await db.live_reactions.insert_one({"seq": seq, "emoji": emoji, "ts": datetime.now(timezone.utc).isoformat()})
    return {"ok": True}


@api_router.post("/live/presence")
async def live_presence_post(payload: LivePresenceIn, request: Request):
    viewer = await _live_viewer(request, payload.viewer_id)
    state = await _live_state()
    if viewer["uid"] in (state.get("kicked") or []):
        return {"ok": True, "muted": False, "kicked": True}
    now = datetime.now(timezone.utc)
    # Anti-spoofing: authenticated users always appear under their account name.
    if viewer["role"] != "guest":
        name = viewer["name"]
    else:
        name = ((payload.name or viewer["name"]) or "Tamu").strip()[:40] or "Tamu"
    existing = await db.live_presence.find_one({"uid": viewer["uid"]}, {"_id": 1})
    await db.live_presence.update_one(
        {"uid": viewer["uid"]},
        {"$set": {"uid": viewer["uid"], "user_id": viewer["user_id"], "name": name, "role": viewer["role"], "last_seen": now}},
        upsert=True,
    )
    if not existing:
        # First join this session -> announce in the live chat column.
        show = await db.live_shows.find_one({"status": "live"}, {"_id": 1})
        if show:
            seq = await _next_seq("msg_seq")
            await db.live_messages.insert_one({
                "id": uuid.uuid4().hex[:12],
                "seq": seq,
                "uid": viewer["uid"],
                "name": name,
                "role": "system",
                "kind": "join",
                "text": f"{name} bergabung ke live",
                "ts": now.isoformat(),
            })
            # Auto welcome greeting from the store, addressed to the viewer.
            profil = await db.profil_admin.find_one({}, {"_id": 0, "live_welcome": 1, "nama_toko": 1}) or {}
            template = (profil.get("live_welcome") or DEFAULT_LIVE_WELCOME).strip()
            if template:
                toko = profil.get("nama_toko") or "toko kami"
                greeting = template.replace("{nama}", name).replace("{toko}", toko)
                wseq = await _next_seq("msg_seq")
                await db.live_messages.insert_one({
                    "id": uuid.uuid4().hex[:12],
                    "seq": wseq,
                    "uid": "toko",
                    "name": toko,
                    "role": "admin",
                    "kind": "welcome",
                    "text": greeting[:300],
                    "ts": now.isoformat(),
                })
    return {"ok": True, "muted": viewer["uid"] in (state.get("muted") or []), "kicked": False}


@api_router.post("/live/leave")
async def live_leave_post(payload: LivePresenceIn, request: Request):
    viewer = await _live_viewer(request, payload.viewer_id)
    await db.live_presence.delete_one({"uid": viewer["uid"]})
    return {"ok": True}


async def _viewers_now() -> list:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=12)
    # prune very stale presence
    await db.live_presence.delete_many({"last_seen": {"$lt": datetime.now(timezone.utc) - timedelta(seconds=60)}})
    state = await _live_state()
    muted = set(state.get("muted") or [])
    seen: dict = {}
    order: list = []
    cur = db.live_presence.find({"last_seen": {"$gte": cutoff}}, {"_id": 0})
    async for v in cur:
        uid = v.get("user_id") or v.get("uid")
        if uid in seen:
            continue
        entry = {"name": v.get("name") or "Tamu", "role": v.get("role", "guest"), "uid": v.get("uid"), "muted": v.get("uid") in muted}
        seen[uid] = entry
        order.append(entry)
    return order


@api_router.get("/live/feed")
async def live_feed(
    request: Request,
    since_seq: int = 0,
    since_react: int = 0,
    viewer_id: Optional[str] = None,
):
    show = await db.live_shows.find_one({"status": "live"}, {"_id": 0})
    if not show:
        return {"live": False}
    viewer = await _live_viewer(request, viewer_id)
    state = await _live_state()

    messages = await db.live_messages.find({"seq": {"$gt": since_seq}}, {"_id": 0}).sort("seq", 1).to_list(100)
    reactions = await db.live_reactions.find({"seq": {"$gt": since_react}}, {"_id": 0}).sort("seq", 1).to_list(50)
    viewers = await _viewers_now()
    count = len(viewers)
    if count > int(state.get("peak_viewers", 0)):
        await db.live_state.update_one({"_id": "current"}, {"$set": {"peak_viewers": count}}, upsert=True)

    last_seq = messages[-1]["seq"] if messages else since_seq
    last_react = reactions[-1]["seq"] if reactions else since_react

    featured = None
    fid = show.get("featured_product_id")
    if fid:
        fdoc = await db.products.find_one({"id": fid, "deleted_at": None}, {"_id": 0})
        if fdoc:
            featured = product_public(fdoc)

    return {
        "live": True,
        "messages": messages,
        "last_seq": last_seq,
        "reactions": reactions,
        "last_react": last_react,
        "total_likes": int(state.get("total_likes", 0)),
        "pinned": state.get("pinned"),
        "featured": featured,
        "viewers": viewers,
        "viewers_count": count,
        "muted": viewer["uid"] in (state.get("muted") or []),
        "kicked": viewer["uid"] in (state.get("kicked") or []),
    }


@api_router.post("/live/pin")
async def live_pin(payload: LivePinIn, admin: dict = Depends(require_admin)):
    msg = payload.message or {}
    pinned = {
        "id": msg.get("id"),
        "name": msg.get("name") or "Tamu",
        "role": msg.get("role", "guest"),
        "text": (msg.get("text") or "")[:300],
    }
    if not pinned["text"]:
        raise HTTPException(status_code=400, detail="Komentar kosong")
    await db.live_state.update_one({"_id": "current"}, {"$set": {"pinned": pinned}}, upsert=True)
    return {"pinned": pinned}


@api_router.post("/live/unpin")
async def live_unpin(admin: dict = Depends(require_admin)):
    await db.live_state.update_one({"_id": "current"}, {"$set": {"pinned": None}}, upsert=True)
    return {"pinned": None}


@api_router.post("/live/mute")
async def live_mute(payload: LiveModIn, admin: dict = Depends(require_admin)):
    op = "$addToSet" if payload.mute else "$pull"
    await db.live_state.update_one({"_id": "current"}, {op: {"muted": payload.uid}}, upsert=True)
    return {"ok": True, "uid": payload.uid, "muted": payload.mute}


@api_router.post("/live/kick")
async def live_kick(payload: LiveModIn, admin: dict = Depends(require_admin)):
    await db.live_state.update_one({"_id": "current"}, {"$addToSet": {"kicked": payload.uid}}, upsert=True)
    await db.live_presence.delete_one({"uid": payload.uid})
    return {"ok": True, "uid": payload.uid}



@api_router.get("/live/token")
async def live_token(role: str = "audience", uid: int = 0, authorization: Optional[str] = Header(None)):
    """Issue an Agora RTC token. Audience is public (guests allowed);
    host (publisher) token requires the caller to be the admin."""
    if not AGORA_APP_ID or not AGORA_APP_CERTIFICATE:
        raise HTTPException(status_code=503, detail="Live belum dikonfigurasi")
    if role == "host":
        # Only the store admin may publish to the channel.
        user = await get_current_user(authorization)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Hanya admin yang bisa siaran")
    agora_role = 1 if role == "host" else 2  # 1=publisher, 2=subscriber
    expire = 3600
    current_ts = int(time.time())
    privilege_expire = current_ts + expire
    token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID, AGORA_APP_CERTIFICATE, LIVE_CHANNEL, uid, agora_role, privilege_expire
    )
    return {"appId": AGORA_APP_ID, "channel": LIVE_CHANNEL, "uid": uid, "token": token, "role": role, "expiresIn": expire}


@api_router.get("/products/{product_id}/reviews")
async def product_reviews(product_id: str):
    """Aggregate buyer reviews (star + comment) for a product from its orders."""
    cursor = db.orders.find(
        {"deleted_at": None, "review": {"$ne": None}, "items.product_id": product_id},
        {"_id": 0, "review": 1, "alamat": 1},
    )
    items = []
    total = 0
    sum_pelayanan = 0
    cnt_pelayanan = 0
    sum_pengiriman = 0
    cnt_pengiriman = 0
    async for o in cursor:
        rv = o.get("review") or {}
        rating = int(rv.get("rating", 0) or 0)
        if rating < 1:
            continue
        total += rating
        rp = rv.get("rating_pelayanan")
        rk = rv.get("rating_pengiriman")
        if rp:
            sum_pelayanan += int(rp); cnt_pelayanan += 1
        if rk:
            sum_pengiriman += int(rk); cnt_pengiriman += 1
        items.append({
            "rating": rating,
            "rating_pelayanan": rp,
            "rating_pengiriman": rk,
            "komentar": rv.get("komentar", ""),
            "foto_url": rv.get("foto_url"),
            "nama": (o.get("alamat") or {}).get("nama") or "Pembeli",
            "created_at": rv["created_at"].isoformat() if rv.get("created_at") else None,
        })
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    count = len(items)
    average = round(total / count, 1) if count else 0
    return {
        "average": average,
        "count": count,
        "average_pelayanan": round(sum_pelayanan / cnt_pelayanan, 1) if cnt_pelayanan else 0,
        "average_pengiriman": round(sum_pengiriman / cnt_pengiriman, 1) if cnt_pengiriman else 0,
        "items": items,
    }


@api_router.post("/products")
async def create_product(payload: ProductIn, admin: dict = Depends(require_admin)):
    doc = payload.dict()
    doc["id"] = uuid.uuid4().hex
    doc["created_at"] = datetime.now(timezone.utc)
    doc["deleted_at"] = None
    await db.products.insert_one(doc)
    return product_public(doc)


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, payload: ProductIn, admin: dict = Depends(require_admin)):
    res = await db.products.update_one(
        {"id": product_id, "deleted_at": None},
        {"$set": payload.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    doc = await db.products.find_one({"id": product_id}, {"_id": 0})
    return product_public(doc)


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, admin: dict = Depends(require_admin)):
    res = await db.products.update_one(
        {"id": product_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    return {"message": "Produk dihapus"}


# ---------------------------------------------------------------------------
# Customers (whitelist buyers) — admin only
# ---------------------------------------------------------------------------
@api_router.get("/admin/customers")
async def list_customers(search: Optional[str] = None, admin: dict = Depends(require_admin)):
    query: dict = {"role": "buyer", "deleted_at": None}
    if search:
        query["$or"] = [
            {"nama": {"$regex": search, "$options": "i"}},
            {"username": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.users.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [public_user(d) for d in docs]


@api_router.post("/admin/customers")
async def create_customer(payload: CustomerIn, admin: dict = Depends(require_admin)):
    username = payload.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username minimal 3 karakter")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    if await db.users.find_one({"username": username, "deleted_at": None}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    if payload.email and await db.users.find_one({"email": payload.email, "deleted_at": None}):
        raise HTTPException(status_code=409, detail="Email sudah terdaftar")
    user = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": payload.email,
        "username": username,
        "password_hash": hash_password(payload.password),
        "role": "buyer",
        "nama": payload.nama.strip(),
        "wa": payload.wa,
        "alamat": None,
        "kota": None,
        "kode_pos": None,
        "status": payload.status or "approved",
        "auth_provider": "whitelist",
        "picture": None,
        "created_at": datetime.now(timezone.utc),
        "deleted_at": None,
    }
    await db.users.insert_one(user)
    return public_user(user)


@api_router.put("/admin/customers/{user_id}")
async def update_customer(user_id: str, payload: CustomerIn, admin: dict = Depends(require_admin)):
    existing = await db.users.find_one({"user_id": user_id, "role": "buyer", "deleted_at": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    update: dict = {
        "email": payload.email,
        "nama": payload.nama.strip(),
        "wa": payload.wa,
        "status": payload.status or existing.get("status", "approved"),
    }
    new_username = payload.username.strip().lower()
    if new_username and new_username != existing.get("username"):
        if await db.users.find_one({"username": new_username, "deleted_at": None}):
            raise HTTPException(status_code=409, detail="Username sudah digunakan")
        update["username"] = new_username
    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        update["password_hash"] = hash_password(payload.password)
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return public_user(doc)


@api_router.delete("/admin/customers/{user_id}")
async def delete_customer(user_id: str, admin: dict = Depends(require_admin)):
    res = await db.users.update_one(
        {"user_id": user_id, "role": "buyer", "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"message": "Pelanggan dihapus"}


# ---------------------------------------------------------------------------
# Store profile update — admin only
# ---------------------------------------------------------------------------
@api_router.put("/profil_admin")
async def update_profil(payload: ProfilUpdate, admin: dict = Depends(require_admin)):
    if not payload.whatsapp or not payload.whatsapp.strip():
        raise HTTPException(status_code=400, detail="Nomor WA wajib diisi")
    if not payload.nama_toko or not payload.nama_toko.strip():
        raise HTTPException(status_code=400, detail="Nama toko wajib diisi")
    data = {
        "nama_toko": payload.nama_toko.strip(),
        "logo_url": payload.logo_url,
        "banner_url": payload.banner_url,
        "rekening_bank": [r.dict() for r in payload.rekening_bank],
        "whatsapp": payload.whatsapp.strip(),
    }
    if payload.kurir_list is not None:
        data["kurir_list"] = payload.kurir_list
    if payload.live_welcome is not None:
        data["live_welcome"] = payload.live_welcome.strip()
    await db.profil_admin.update_one({}, {"$set": data}, upsert=True)
    profil = await db.profil_admin.find_one({}, {"_id": 0})
    return profil


# ---------------------------------------------------------------------------
# Buyer: address + ongkir + orders
# ---------------------------------------------------------------------------
def order_public(o: dict) -> dict:
    return {
        "id": o.get("id"),
        "no_order": o.get("no_order"),
        "user_id": o.get("user_id"),
        "items": o.get("items", []),
        "subtotal": o.get("subtotal", 0),
        "voucher_code": o.get("voucher_code"),
        "voucher_diskon": o.get("voucher_diskon", 0),
        "ongkir": o.get("ongkir", 0),
        "asuransi": o.get("asuransi", False),
        "asuransi_fee": o.get("asuransi_fee", 0),
        "payment_method": o.get("payment_method", "transfer"),
        "cod_disbursement_type": o.get("cod_disbursement_type"),
        "total": o.get("total", 0),
        "status": o.get("status"),
        "no_resi": o.get("no_resi"),
        "alamat": o.get("alamat"),
        "kurir": o.get("kurir"),
        "catatan": o.get("catatan"),
        "shipping_coordinate": o.get("shipping_coordinate"),
        "courier_company": o.get("courier_company"),
        "courier_type": o.get("courier_type"),
        "biteship_order_id": o.get("biteship_order_id"),
        "biteship_waybill": o.get("biteship_waybill"),
        "biteship_tracking_id": o.get("biteship_tracking_id"),
        "bukti_bayar_url": o.get("bukti_bayar_url"),
        "review": o.get("review"),
        "status_history": [
            {"status": h.get("status"), "at": h["at"].isoformat() if h.get("at") else None}
            for h in (o.get("status_history") or [])
        ],
        "created_at": o.get("created_at").isoformat() if o.get("created_at") else None,
    }


@api_router.put("/me")
async def update_me(payload: AddressUpdate, user: dict = Depends(get_current_user)):
    if not payload.alamat or not payload.alamat.strip():
        raise HTTPException(status_code=400, detail="Alamat wajib diisi")
    if not payload.kota or not payload.kota.strip():
        raise HTTPException(status_code=400, detail="Kota wajib diisi")
    update = {
        "alamat": payload.alamat.strip(),
        "kota": payload.kota.strip(),
        "kode_pos": (payload.kode_pos or "").strip() or None,
    }
    if payload.nama:
        update["nama"] = payload.nama.strip()
    if payload.wa:
        update["wa"] = payload.wa.strip()
    if payload.latitude is not None:
        update["latitude"] = payload.latitude
    if payload.longitude is not None:
        update["longitude"] = payload.longitude
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(doc)


# ---------------------------------------------------------------------------
# Vouchers / discount codes
# ---------------------------------------------------------------------------
def voucher_public(v: dict) -> dict:
    return {
        "id": v.get("id"),
        "kode": v.get("kode", ""),
        "tipe": v.get("tipe", "persen"),
        "nilai": v.get("nilai", 0),
        "min_belanja": v.get("min_belanja", 0),
        "maks_potongan": v.get("maks_potongan", 0),
        "kuota": v.get("kuota", 0),
        "terpakai": v.get("terpakai", 0),
        "aktif": v.get("aktif", True),
        "kadaluarsa": v.get("kadaluarsa"),
    }


def _voucher_check(v: Optional[dict], subtotal: float, ongkir: float = 0.0) -> tuple:
    """Return (diskon, error_message). diskon=0 with message when invalid.
    The discount is always a single rupiah amount deducted from the grand total,
    whether it targets subtotal (persen/nominal) or shipping (ongkir_persen)."""
    if not v:
        return 0.0, "Kode voucher tidak ditemukan"
    if not v.get("aktif", True):
        return 0.0, "Voucher tidak aktif"
    if v.get("kadaluarsa"):
        try:
            exp = datetime.fromisoformat(str(v["kadaluarsa"]))
            if exp.date() < datetime.now(timezone(timedelta(hours=7))).date():
                return 0.0, "Voucher sudah kadaluarsa"
        except Exception:
            pass
    kuota = v.get("kuota", 0) or 0
    if kuota and v.get("terpakai", 0) >= kuota:
        return 0.0, "Kuota voucher sudah habis"
    if subtotal < (v.get("min_belanja", 0) or 0):
        return 0.0, f"Minimal belanja Rp {int(v.get('min_belanja', 0)):,} untuk voucher ini".replace(",", ".")
    tipe = v.get("tipe")
    nilai = float(v.get("nilai", 0) or 0)
    maks = float(v.get("maks_potongan", 0) or 0)
    if tipe == "ongkir_persen":
        diskon = ongkir * nilai / 100.0
        if maks > 0:
            diskon = min(diskon, maks)
        diskon = min(diskon, ongkir)  # never exceed the shipping cost itself
    elif tipe == "nominal":
        diskon = min(nilai, subtotal)
    else:
        diskon = subtotal * nilai / 100.0
    return round(diskon), ""


@api_router.post("/voucher/validate")
async def validate_voucher(payload: dict, user: dict = Depends(get_current_user)):
    kode = (payload.get("kode") or "").strip().upper()
    subtotal = float(payload.get("subtotal", 0) or 0)
    ongkir = float(payload.get("ongkir", 0) or 0)
    v = await db.vouchers.find_one({"kode": kode}, {"_id": 0})
    diskon, msg = _voucher_check(v, subtotal, ongkir)
    if msg:
        return {"valid": False, "diskon": 0, "message": msg}
    return {"valid": True, "diskon": diskon, "voucher": voucher_public(v), "message": "Voucher diterapkan"}


@api_router.get("/admin/vouchers")
async def list_vouchers(admin: dict = Depends(require_admin)):
    docs = await db.vouchers.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [voucher_public(d) for d in docs]


@api_router.post("/admin/vouchers")
async def create_voucher(payload: VoucherIn, admin: dict = Depends(require_admin)):
    kode = payload.kode.strip().upper()
    if not kode:
        raise HTTPException(status_code=400, detail="Kode voucher wajib diisi")
    if payload.tipe not in ("persen", "nominal", "ongkir_persen"):
        raise HTTPException(status_code=400, detail="Tipe voucher tidak valid")
    if payload.nilai <= 0:
        raise HTTPException(status_code=400, detail="Nilai diskon harus lebih dari 0")
    if payload.tipe in ("persen", "ongkir_persen") and payload.nilai > 100:
        raise HTTPException(status_code=400, detail="Diskon persen maksimal 100")
    if await db.vouchers.find_one({"kode": kode}):
        raise HTTPException(status_code=409, detail="Kode voucher sudah ada")
    doc = {
        "id": f"vcr_{uuid.uuid4().hex[:12]}",
        "kode": kode,
        "tipe": payload.tipe,
        "nilai": payload.nilai,
        "min_belanja": max(0.0, payload.min_belanja),
        "maks_potongan": max(0.0, payload.maks_potongan),
        "kuota": max(0, payload.kuota),
        "aktif": payload.aktif,
        "kadaluarsa": payload.kadaluarsa or None,
        "terpakai": 0,
        "created_at": datetime.now(timezone.utc),
    }
    await db.vouchers.insert_one(doc)
    return voucher_public(doc)


@api_router.put("/admin/vouchers/{voucher_id}")
async def update_voucher(voucher_id: str, payload: VoucherIn, admin: dict = Depends(require_admin)):
    existing = await db.vouchers.find_one({"id": voucher_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Voucher tidak ditemukan")
    kode = payload.kode.strip().upper()
    if not kode:
        raise HTTPException(status_code=400, detail="Kode voucher wajib diisi")
    dup = await db.vouchers.find_one({"id": {"$ne": voucher_id}, "kode": kode})
    if dup:
        raise HTTPException(status_code=409, detail="Kode voucher sudah ada")
    await db.vouchers.update_one({"id": voucher_id}, {"$set": {
        "kode": kode,
        "tipe": payload.tipe,
        "nilai": payload.nilai,
        "min_belanja": max(0.0, payload.min_belanja),
        "maks_potongan": max(0.0, payload.maks_potongan),
        "kuota": max(0, payload.kuota),
        "aktif": payload.aktif,
        "kadaluarsa": payload.kadaluarsa or None,
    }})
    doc = await db.vouchers.find_one({"id": voucher_id}, {"_id": 0})
    return voucher_public(doc)


@api_router.delete("/admin/vouchers/{voucher_id}")
async def delete_voucher(voucher_id: str, admin: dict = Depends(require_admin)):
    res = await db.vouchers.delete_one({"id": voucher_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Voucher tidak ditemukan")
    return {"message": "Voucher dihapus"}


@api_router.post("/orders")
async def create_order(payload: OrderCreate, user: dict = Depends(get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")
    if not user.get("alamat") or not user.get("kota"):
        raise HTTPException(status_code=400, detail="Lengkapi alamat pengiriman terlebih dahulu")
    payment_method = (payload.payment_method or "transfer").strip().lower()
    if payment_method not in {"transfer", "cod"}:
        raise HTTPException(status_code=400, detail="Metode pembayaran tidak valid")
    cod_disbursement_type = (payload.cod_disbursement_type or "7_days").strip().lower()
    if payment_method == "cod" and cod_disbursement_type not in {"7_days", "5_days", "3_days"}:
        raise HTTPException(status_code=400, detail="Tipe pencairan COD tidak valid")

    # Load products and validate stock.
    order_items = []
    subtotal = 0.0
    for it in payload.items:
        if it.qty <= 0:
            continue
        product = await db.products.find_one({"id": it.product_id, "deleted_at": None})
        if not product:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
        has_var = bool(product.get("has_variations") and product.get("combinations"))
        combo = None
        var_label = None
        if has_var:
            combo = _find_combination(product, it.variation_key)
            if not combo:
                raise HTTPException(status_code=400, detail=f"Pilih variasi untuk {product['nama_produk']}")
            if not product.get("bisa_po") and int(combo.get("stok", 0) or 0) < it.qty:
                raise HTTPException(status_code=400, detail=f"Stok variasi {product['nama_produk']} tidak cukup")
            unit = _combo_effective_price(combo)
            var_label = ", ".join([str(o) for o in (combo.get("options") or [])])
            foto = combo.get("foto") or (product.get("foto_urls") or [None])[0]
            harga_asli = combo.get("harga", 0)
        else:
            if not product.get("bisa_po") and product.get("stok", 0) < it.qty:
                raise HTTPException(status_code=400, detail=f"Stok {product['nama_produk']} tidak cukup")
            unit = _effective_price(product)
            foto = (product.get("foto_urls") or [None])[0]
            harga_asli = product.get("harga", 0)
        line = unit * it.qty
        subtotal += line
        order_items.append({
            "product_id": it.product_id,
            "nama_produk": product.get("nama_produk"),
            "harga": unit,
            "harga_asli": harga_asli,
            "qty": it.qty,
            "foto": foto,
            "subtotal": line,
            "variation_key": it.variation_key if has_var else None,
            "variation_label": var_label,
            "weight": combo.get("berat_gram") if (combo and combo.get("berat_gram")) else product.get("berat_gram", 0),
        })

    if not order_items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")

    # Decrement stock (PO products may go negative). Variation combos decrement
    # their own stock; simple products decrement the product-level stock.
    for it in order_items:
        if it.get("variation_key"):
            await db.products.update_one(
                {"id": it["product_id"], "combinations.options": it["variation_key"].split("|")},
                {"$inc": {"combinations.$.stok": -it["qty"]}},
            )
        else:
            await db.products.update_one({"id": it["product_id"]}, {"$inc": {"stok": -it["qty"]}})

    # Compute shipping first so an ongkir_persen voucher can discount it.
    ongkir = max(0.0, payload.ongkir or 0)
    asuransi_fee = max(0.0, payload.asuransi_fee or 0) if payload.asuransi else 0.0

    # Apply voucher (server-side validated so the discount can't be forged).
    voucher_code = None
    voucher_diskon = 0.0
    if payload.voucher_code:
        kode = payload.voucher_code.strip().upper()
        v = await db.vouchers.find_one({"kode": kode})
        diskon, msg = _voucher_check(v, subtotal, ongkir)
        if msg:
            raise HTTPException(status_code=400, detail=msg)
        voucher_code = kode
        voucher_diskon = diskon
        await db.vouchers.update_one({"id": v["id"]}, {"$inc": {"terpakai": 1}})

    total = max(0.0, subtotal + ongkir + asuransi_fee - voucher_diskon)
    now = datetime.now(timezone.utc)
    no_order = f"DS-{now.strftime('%y%m%d')}-{secrets.token_hex(2).upper()}"

    initial_status = "sedang_dikemas" if payment_method == "cod" else "menunggu_pembayaran"
    order = {
        "id": uuid.uuid4().hex,
        "no_order": no_order,
        "user_id": user["user_id"],
        "items": order_items,
        "subtotal": subtotal,
        "voucher_code": voucher_code,
        "voucher_diskon": voucher_diskon,
        "ongkir": ongkir,
        "asuransi": bool(payload.asuransi),
        "asuransi_fee": asuransi_fee,
        "total": total,
        "status": initial_status,
        "status_history": [{"status": initial_status, "at": now}],
        "alamat": {
            "nama": user.get("nama"),
            "wa": user.get("wa"),
            "alamat": user.get("alamat"),
            "kota": user.get("kota"),
            "kode_pos": user.get("kode_pos"),
        },
        "kurir": payload.kurir,
        "catatan": payload.catatan,
        "shipping_coordinate": payload.shipping_coordinate,
        "courier_company": payload.courier_company,
        "courier_type": payload.courier_type,
        "payment_method": payment_method,
        "cod_disbursement_type": cod_disbursement_type if payment_method == "cod" else None,
        "bukti_bayar_url": None,
        "created_at": now,
        "deleted_at": None,
    }
    await db.orders.insert_one(order)
    await sio.emit("new_order", order_public(order), room="admins")
    return order_public(order)


# Auto-complete: orders left in "dikirim" for this many days are marked
# "selesai" automatically (buyer never confirmed receipt).
AUTO_COMPLETE_DAYS = 3


async def auto_complete_orders() -> None:
    """Mark shipped orders as completed after AUTO_COMPLETE_DAYS days.

    Uses `dikirim_at` when present, otherwise falls back to the newest
    'dikirim' entry in status_history (for orders shipped before this field
    existed).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=AUTO_COMPLETE_DAYS)
    candidates = await db.orders.find(
        {"status": "dikirim", "deleted_at": None}
    ).to_list(500)
    for o in candidates:
        shipped_at = o.get("dikirim_at")
        if not shipped_at:
            hist = [h for h in (o.get("status_history") or []) if h.get("status") == "dikirim" and h.get("at")]
            shipped_at = hist[-1]["at"] if hist else o.get("created_at")
        if not shipped_at:
            continue
        # Normalise to aware datetime for safe comparison.
        if shipped_at.tzinfo is None:
            shipped_at = shipped_at.replace(tzinfo=timezone.utc)
        if shipped_at <= cutoff:
            await db.orders.update_one(
                {"id": o["id"]},
                {"$set": {"status": "selesai"},
                 "$push": {"status_history": {"status": "selesai", "at": now}}},
            )
            await sio.emit(
                "order_status",
                {"id": o.get("id"), "no_order": o.get("no_order"), "status": "selesai", "no_resi": o.get("no_resi")},
                room=o.get("user_id"),
            )


@api_router.get("/orders")
async def list_orders(user: dict = Depends(get_current_user)):
    await auto_complete_orders()
    if user.get("role") == "admin":
        query: dict = {"deleted_at": None}
    else:
        query = {"user_id": user["user_id"], "deleted_at": None}
    docs = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [order_public(d) for d in docs]


@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, user: dict = Depends(get_current_user)):
    await auto_complete_orders()
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if user.get("role") != "admin" and doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    return order_public(doc)


@api_router.post("/orders/{order_id}/bukti")
async def set_bukti_bayar(order_id: str, body: dict, user: dict = Depends(get_current_user)):
    url = (body or {}).get("bukti_bayar_url")
    if not url:
        raise HTTPException(status_code=400, detail="URL bukti bayar diperlukan")
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if user.get("role") != "admin" and doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"bukti_bayar_url": url, "status": "menunggu_konfirmasi"}},
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return order_public(updated)


@api_router.post("/orders/{order_id}/konfirmasi-bayar")
async def konfirmasi_bayar(order_id: str, user: dict = Depends(get_current_user)):
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if user.get("role") != "admin" and doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "menunggu_konfirmasi"}, "$push": {"status_history": {"status": "menunggu_konfirmasi", "at": datetime.now(timezone.utc)}}})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return order_public(updated)


@api_router.post("/orders/{order_id}/terima")
async def konfirmasi_terima(order_id: str, user: dict = Depends(get_current_user)):
    """Buyer confirms they received the package -> order becomes 'selesai'.

    This is how the seller learns the parcel arrived: an admin notification is
    emitted in realtime.
    """
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if user.get("role") != "admin" and doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    if doc.get("status") != "dikirim":
        raise HTTPException(status_code=400, detail="Pesanan belum dikirim")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"status": "selesai"}, "$push": {"status_history": {"status": "selesai", "at": datetime.now(timezone.utc)}}},
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    # Let the seller know the parcel has been received.
    await sio.emit(
        "order_received",
        {"id": updated.get("id"), "no_order": updated.get("no_order"), "nama": (updated.get("alamat") or {}).get("nama")},
        room="admins",
    )
    return order_public(updated)


ALLOWED_STATUS = {"menunggu_pembayaran", "menunggu_konfirmasi", "sedang_dikemas", "dikirim", "selesai", "dibatalkan"}


@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, body: dict, admin: dict = Depends(require_admin)):
    status = (body or {}).get("status")
    if status not in ALLOWED_STATUS:
        raise HTTPException(status_code=400, detail="Status tidak valid")
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    update: dict = {"status": status}
    if status == "dikirim":
        already_booked = bool(doc.get("biteship_order_id"))
        is_biteship = bool(doc.get("courier_company") and (doc.get("shipping_coordinate") or {}).get("latitude"))
        if is_biteship and not already_booked:
            # Auto-book the courier the buyer picked at checkout; waybill becomes the resi.
            try:
                data = await _create_biteship_shipment(doc)
                courier = data.get("courier") or {}
                update["no_resi"] = courier.get("waybill_id") or data.get("id")
            except HTTPException as e:
                raise HTTPException(status_code=e.status_code, detail=f"Gagal booking kurir: {e.detail}")
        else:
            no_resi = (body or {}).get("no_resi") or doc.get("biteship_waybill") or doc.get("no_resi")
            if not no_resi or not str(no_resi).strip():
                raise HTTPException(status_code=400, detail="No resi wajib diisi")
            update["no_resi"] = str(no_resi).strip()
        # Timestamp used by the auto-complete sweep.
        if doc.get("status") != "dikirim":
            update["dikirim_at"] = datetime.now(timezone.utc)
    # Admin may set/adjust ongkir (manual) when packing.
    if body.get("ongkir") is not None:
        ongkir = max(0.0, float(body["ongkir"]))
        update["ongkir"] = ongkir
        update["total"] = doc.get("subtotal", 0) + ongkir
    # Only record history when the status actually changes (e.g. a resi-only
    # update on an already-dikirim order must not add a duplicate entry).
    ops: dict = {"$set": update}
    if status != doc.get("status"):
        ops["$push"] = {"status_history": {"status": status, "at": datetime.now(timezone.utc)}}
    await db.orders.update_one({"id": order_id}, ops)
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    # Notify the buyer in realtime about status/tracking changes.
    await sio.emit(
        "order_status",
        {"id": updated.get("id"), "no_order": updated.get("no_order"), "status": updated.get("status"), "no_resi": updated.get("no_resi")},
        room=updated.get("user_id"),
    )
    return order_public(updated)


@api_router.post("/orders/{order_id}/review")
async def review_order(order_id: str, body: dict, user: dict = Depends(get_current_user)):
    rating = int((body or {}).get("rating", 0))
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating 1-5")

    def _clamp(v):
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        return n if 1 <= n <= 5 else None

    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    if doc.get("status") != "selesai":
        raise HTTPException(status_code=400, detail="Ulasan hanya bisa setelah pesanan selesai")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"review": {
            "rating": rating,
            "rating_pelayanan": _clamp((body or {}).get("rating_pelayanan")),
            "rating_pengiriman": _clamp((body or {}).get("rating_pengiriman")),
            "komentar": (body or {}).get("komentar", ""),
            "foto_url": (body or {}).get("foto_url"),
            "created_at": datetime.now(timezone.utc),
        }}},
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return order_public(updated)


# ---------------------------------------------------------------------------
# Chat (REST history/rooms; realtime via Socket.IO below)
# ---------------------------------------------------------------------------
def chat_public(m: dict) -> dict:
    return {
        "id": m.get("id"),
        "room": m.get("room"),
        "sender_id": m.get("sender_id"),
        "sender_role": m.get("sender_role"),
        "sender_nama": m.get("sender_nama"),
        "text": m.get("text"),
        "image_url": m.get("image_url"),
        "created_at": m.get("created_at").isoformat() if m.get("created_at") else None,
    }


@api_router.get("/chat/history")
async def chat_history(room: Optional[str] = None, user: dict = Depends(get_current_user)):
    target = room if user.get("role") == "admin" and room else user["user_id"]
    docs = await db.chats.find({"room": target}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return [chat_public(d) for d in docs]


@api_router.get("/chat/rooms")
async def chat_rooms(admin: dict = Depends(require_admin)):
    pipeline = [
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$room", "last": {"$first": "$$ROOT"}}},
    ]
    rooms = []
    async for g in db.chats.aggregate(pipeline):
        last = g["last"]
        buyer = await db.users.find_one({"user_id": g["_id"]}, {"_id": 0})
        unread = await db.chats.count_documents({"room": g["_id"], "read_admin": False})
        rooms.append({
            "room": g["_id"],
            "nama": (buyer or {}).get("nama") or (buyer or {}).get("username") or "Pembeli",
            "last_text": last.get("text") or ("[Gambar]" if last.get("image_url") else ""),
            "last_at": last.get("created_at").isoformat() if last.get("created_at") else None,
            "unread": unread,
        })
    rooms.sort(key=lambda r: r.get("last_at") or "", reverse=True)
    return rooms


# ---------------------------------------------------------------------------
# Push notifications (Emergent managed relay — SuprSend passthrough)
# ---------------------------------------------------------------------------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"register_push failed (non-blocking): {e}")
        return {"status": "skipped"}
    return {"status": "registered"}


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    recipients = [r for r in (recipients or []) if r]
    if not recipients or "title" not in data or "message" not in data:
        return
    for i in range(0, len(recipients), 100):  # chunk: max 100 recipients per trigger
        payload: dict = {"recipients": recipients[i:i + 100], "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = f"{idempotency_key}:{i}"
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
        resp.raise_for_status()
        logger.info(f"push trigger ok: {len(payload['recipients'])} recipient(s), title={data.get('title')!r}")


async def _admin_user_ids() -> List[str]:
    rows = await db.users.find({"role": "admin", "deleted_at": None}, {"user_id": 1, "_id": 0}).to_list(100)
    return [r["user_id"] for r in rows if r.get("user_id")]


async def _buyer_user_ids() -> List[str]:
    rows = await db.users.find(
        {"role": {"$ne": "admin"}, "status": "approved", "deleted_at": None},
        {"user_id": 1, "_id": 0},
    ).to_list(5000)
    return [r["user_id"] for r in rows if r.get("user_id")]


async def _notify_chat(doc: dict):
    """Push a new chat message to the offline party (buyer <-> admins)."""
    try:
        sender_is_admin = doc.get("sender_role") == "admin"
        if sender_is_admin:
            recipients = [doc["room"]]
            title = "Pesan dari Admin"
            action_url = "/chat"
        else:
            recipients = await _admin_user_ids()
            sender_name = doc.get("sender_nama") or "Pembeli"
            title = f"Pesan dari {sender_name}"
            # Deep-link admin langsung ke room pembeli pengirim.
            action_url = f"/chat?room={doc['room']}&title={quote(sender_name)}"
        body = doc.get("text") or ("📷 Mengirim foto" if doc.get("image_url") else "Pesan baru")
        await send_push(
            recipients,
            {"title": title, "message": body[:140], "action_url": action_url},
            idempotency_key=f"chat:{doc.get('id')}",
        )
    except Exception as e:
        logger.warning(f"chat push failed (non-blocking): {e}")


# ---------------------------------------------------------------------------
# Notifications / broadcast (multi-tenant ready)
# ---------------------------------------------------------------------------
class BroadcastIn(BaseModel):
    title: str
    message: str
    image_url: Optional[str] = None
    action_url: Optional[str] = None
    target: str = "all"            # "all" | "selected"
    user_ids: List[str] = Field(default_factory=list)


def notification_public(n: dict) -> dict:
    return {
        "id": n.get("id"),
        "tipe": n.get("tipe", "promo"),
        "title": n.get("title"),
        "message": n.get("message"),
        "image_url": n.get("image_url"),
        "action_url": n.get("action_url"),
        "target": n.get("target", "all"),
        "recipients_count": n.get("recipients_count", 0),
        "created_at": n.get("created_at").isoformat() if n.get("created_at") else None,
    }


@api_router.post("/admin/broadcast")
async def admin_broadcast(payload: BroadcastIn, admin: dict = Depends(require_admin)):
    if not payload.title.strip() or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Judul dan pesan wajib diisi")
    if payload.target == "selected":
        recipients = [u for u in payload.user_ids if u]
        if not recipients:
            raise HTTPException(status_code=400, detail="Pilih minimal 1 pelanggan")
    else:
        recipients = await _buyer_user_ids()
    doc = {
        "id": f"ntf_{uuid.uuid4().hex[:12]}",
        "tenant_id": admin.get("tenant_id", DEFAULT_TENANT),
        "tipe": "promo",
        "title": payload.title.strip(),
        "message": payload.message.strip(),
        "image_url": payload.image_url,
        "action_url": payload.action_url,
        "target": payload.target,
        "user_ids": recipients if payload.target == "selected" else [],
        "recipients_count": len(recipients),
        "created_by": admin["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.notifications.insert_one(doc)
    data = {"title": doc["title"], "message": doc["message"]}
    if doc.get("image_url"):
        data["image_url"] = doc["image_url"]
    if doc.get("action_url"):
        data["action_url"] = doc["action_url"]
    try:
        await send_push(recipients, data, idempotency_key=f"promo:{doc['id']}")
    except Exception as e:
        logger.warning(f"broadcast push failed (non-blocking): {e}")
    return notification_public(doc)


@api_router.get("/admin/broadcast")
async def list_broadcasts(admin: dict = Depends(require_admin)):
    tenant = admin.get("tenant_id", DEFAULT_TENANT)
    rows = await db.notifications.find(
        {"tenant_id": tenant, "tipe": "promo"}, {"_id": 0}
    ).sort("created_at", -1).limit(100).to_list(100)
    return [notification_public(r) for r in rows]


@api_router.get("/notifications")
async def my_notifications(user: dict = Depends(get_current_user)):
    tenant = user.get("tenant_id", DEFAULT_TENANT)
    rows = await db.notifications.find(
        {"tenant_id": tenant, "tipe": "promo",
         "$or": [{"target": "all"}, {"user_ids": user["user_id"]}]},
        {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(50)
    return [notification_public(r) for r in rows]



async def save_chat_message(room: str, sender: dict, text: Optional[str], image_url: Optional[str]) -> dict:
    is_admin = sender.get("role") == "admin"
    doc = {
        "id": uuid.uuid4().hex,
        "room": room,
        "sender_id": sender["user_id"],
        "sender_role": sender.get("role", "buyer"),
        "sender_nama": sender.get("nama") or sender.get("username"),
        "text": text,
        "image_url": image_url,
        "read_admin": is_admin,
        "read_buyer": not is_admin,
        "created_at": datetime.now(timezone.utc),
    }
    await db.chats.insert_one(doc)
    return doc


@api_router.get("/chat/unread")
async def chat_unread(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        count = await db.chats.count_documents({"read_admin": False})
    else:
        count = await db.chats.count_documents({"room": user["user_id"], "read_buyer": False})
    return {"count": count}


@api_router.post("/chat/read")
async def chat_read(body: dict, user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        room = (body or {}).get("room")
        if not room:
            raise HTTPException(status_code=400, detail="Room diperlukan")
        await db.chats.update_many({"room": room, "read_admin": False}, {"$set": {"read_admin": True}})
    else:
        await db.chats.update_many({"room": user["user_id"], "read_buyer": False}, {"$set": {"read_buyer": True}})
    return {"ok": True}


@api_router.post("/chat/send")
async def chat_send(body: dict, user: dict = Depends(get_current_user)):
    room = body.get("room") if user.get("role") == "admin" else user["user_id"]
    if not room:
        raise HTTPException(status_code=400, detail="Room diperlukan")
    text = (body or {}).get("text")
    image_url = (body or {}).get("image_url")
    if not text and not image_url:
        raise HTTPException(status_code=400, detail="Pesan kosong")
    doc = await save_chat_message(room, user, text, image_url)
    payload = chat_public(doc)
    await sio.emit("message", payload, room=[room, "admins"])
    await _notify_chat(doc)
    return payload




# ---------------------------------------------------------------------------
# Dashboard stats — admin only
# ---------------------------------------------------------------------------
@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    produk = await db.products.count_documents({"deleted_at": None})
    pelanggan = await db.users.count_documents({"role": "buyer", "deleted_at": None})
    pending = await db.users.count_documents({"role": "buyer", "status": "pending", "deleted_at": None})
    pesanan = await db.orders.count_documents({"deleted_at": None})
    perlu_konfirmasi = await db.orders.count_documents({"deleted_at": None, "status": "menunggu_konfirmasi"})

    # Sales totals (paid orders only) in WIB day/month boundaries.
    wib = timezone(timedelta(hours=7))
    now_wib = datetime.now(wib)
    start_today = now_wib.replace(hour=0, minute=0, second=0, microsecond=0)
    start_month = now_wib.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    paid_statuses = ["menunggu_konfirmasi", "sedang_dikemas", "dikirim", "selesai"]

    async def sum_sales(since: datetime) -> float:
        pipeline = [
            {"$match": {
                "deleted_at": None,
                "status": {"$in": paid_statuses},
                "created_at": {"$gte": since},
            }},
            {"$group": {"_id": None, "total": {"$sum": "$total"}}},
        ]
        res = await db.orders.aggregate(pipeline).to_list(1)
        return res[0]["total"] if res else 0

    return {
        "produk": produk,
        "pelanggan": pelanggan,
        "pending": pending,
        "pesanan": pesanan,
        "perlu_konfirmasi": perlu_konfirmasi,
        "penjualan_hari_ini": await sum_sales(start_today),
        "penjualan_bulan_ini": await sum_sales(start_month),
    }


# ---------------------------------------------------------------------------
# Platform settings (fee %) — adjustable by superadmin later (multi-tenant)
# ---------------------------------------------------------------------------
async def _platform_fee_percent() -> float:
    doc = await db.platform_settings.find_one({"_id": "current"})
    return float((doc or {}).get("platform_fee_percent", 0) or 0)


@api_router.get("/admin/platform-settings")
async def get_platform_settings(admin: dict = Depends(require_admin)):
    return {"platform_fee_percent": await _platform_fee_percent()}


@api_router.put("/admin/platform-settings")
async def set_platform_settings(payload: PlatformSettingsIn, admin: dict = Depends(require_admin)):
    fee = max(0.0, min(100.0, payload.platform_fee_percent))
    await db.platform_settings.update_one(
        {"_id": "current"}, {"$set": {"platform_fee_percent": fee}}, upsert=True
    )
    return {"platform_fee_percent": fee}


# ---------------------------------------------------------------------------
# Seller analytics — visitors, auto sales recap, best sellers
# ---------------------------------------------------------------------------
@api_router.get("/admin/analytics")
async def admin_analytics(admin: dict = Depends(require_admin)):
    # Completed sales recap (only "selesai" orders count as real sales).
    sold_pipeline = [
        {"$match": {"deleted_at": None, "status": "selesai"}},
        {"$group": {
            "_id": None,
            "orders": {"$sum": 1},
            "units": {"$sum": {"$sum": "$items.qty"}},
            "subtotal": {"$sum": "$subtotal"},
            "voucher": {"$sum": {"$ifNull": ["$voucher_diskon", 0]}},
            "ongkir": {"$sum": "$ongkir"},
            "total": {"$sum": "$total"},
        }},
    ]
    agg = await db.orders.aggregate(sold_pipeline).to_list(1)
    s = agg[0] if agg else {}
    barang_net = float(s.get("subtotal", 0) or 0) - float(s.get("voucher", 0) or 0)
    fee_percent = await _platform_fee_percent()
    platform_fee = round(barang_net * fee_percent / 100.0)
    pendapatan_bersih = round(barang_net - platform_fee)

    # Best sellers (by units, completed orders).
    top_pipeline = [
        {"$match": {"deleted_at": None, "status": "selesai"}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "nama": {"$first": "$items.nama_produk"},
            "foto": {"$first": "$items.foto"},
            "qty": {"$sum": "$items.qty"},
            "omzet": {"$sum": "$items.subtotal"},
        }},
        {"$sort": {"qty": -1}},
        {"$limit": 10},
    ]
    top_rows = await db.orders.aggregate(top_pipeline).to_list(10)
    produk_terlaris = [
        {"product_id": r["_id"], "nama": r.get("nama"), "foto": r.get("foto"),
         "terjual": r.get("qty", 0), "omzet": r.get("omzet", 0)}
        for r in top_rows
    ]

    # Visitors: total views + distinct logged-in visitors + recent viewers list.
    total_views = 0
    vp = await db.products.aggregate([
        {"$match": {"deleted_at": None}},
        {"$group": {"_id": None, "v": {"$sum": {"$ifNull": ["$views", 0]}}}},
    ]).to_list(1)
    if vp:
        total_views = vp[0].get("v", 0)
    pengunjung_login = len(await db.product_views.distinct("user_id", {"user_id": {"$ne": None}}))
    recent_rows = await db.product_views.find({}, {"_id": 0}).sort("at", -1).limit(30).to_list(30)
    pengunjung_terbaru = [
        {"viewer_name": r.get("viewer_name") or "Tamu", "produk": r.get("product_nama"),
         "login": bool(r.get("user_id")),
         "at": r["at"].isoformat() if r.get("at") else None}
        for r in recent_rows
    ]

    return {
        "pesanan_selesai": s.get("orders", 0) or 0,
        "unit_terjual": s.get("units", 0) or 0,
        "pendapatan_kotor": round(float(s.get("total", 0) or 0)),
        "ongkir_total": round(float(s.get("ongkir", 0) or 0)),
        "voucher_total": round(float(s.get("voucher", 0) or 0)),
        "platform_fee_percent": fee_percent,
        "platform_fee": platform_fee,
        "pendapatan_bersih": pendapatan_bersih,
        "produk_terlaris": produk_terlaris,
        "total_dilihat": total_views,
        "pengunjung_login": pengunjung_login,
        "pengunjung_terbaru": pengunjung_terbaru,
    }



# ---------------------------------------------------------------------------
# Startup: indexes + seed data
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    # Only the legacy Emergent backend needs a network init at boot.
    if _storage_backend() == "emergent":
        try:
            await run_in_threadpool(init_storage)
            logger.info("Object storage initialized")
        except Exception as e:
            logger.warning(f"Object storage init failed: {e}")

    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("username", sparse=True)
    await db.users.create_index("email", sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.products.create_index("id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("user_id")
    await db.locations.create_index("id", unique=True)
    await db.user_addresses.create_index("id", unique=True)
    await db.user_addresses.create_index("user_id")
    await db.vouchers.create_index("kode", unique=True)
    await db.vouchers.create_index("id", unique=True)
    await db.product_views.create_index("product_id")
    await db.product_views.create_index([("at", -1)])
    # Seed one default store Location (multi-tenant ready; single-origin for now).
    if not await db.locations.find_one({"tenant_id": DEFAULT_TENANT}):
        profil = await db.profil_admin.find_one({}) or {}
        await db.locations.insert_one({
            "id": f"loc_{uuid.uuid4().hex[:12]}",
            "tenant_id": DEFAULT_TENANT,
            "name": profil.get("nama_toko") or "Diana Stuff",
            "contact_name": profil.get("nama_toko") or "Diana Stuff",
            "contact_phone": DEFAULT_WHATSAPP,
            "address": "Jl. Contoh No. 1, Jakarta",
            "postal_code": "10110",
            "latitude": -6.2,
            "longitude": 106.816666,
            "note": "Alamat default — ubah di Pengaturan Alamat Toko",
            "is_default": True,
            "biteship_location_id": None,
        })
        logger.info("Seeded default store location")

    # Seed store profile with sample data so the app works out of the box.
    if not await db.profil_admin.find_one({}):
        await db.profil_admin.insert_one({
            "nama_toko": "Diana Stuff",
            "logo_url": "https://images.unsplash.com/photo-1638864616266-c390568f9092?crop=entropy&cs=srgb&fm=jpg&q=85&w=400",
            "banner_url": "https://images.unsplash.com/photo-1483985988355-763728e1935b?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
            "rekening_bank": [
                {"bank": "BCA", "no_rek": "1234567890", "a_n": "Diana"},
            ],
            "whatsapp": DEFAULT_WHATSAPP,
            "kurir_list": DEFAULT_KURIR,
            "live_welcome": DEFAULT_LIVE_WELCOME,
        })
        logger.info("Seeded profil_admin")
    else:
        # Ensure the store WhatsApp + kurir list are set.
        profil = await db.profil_admin.find_one({})
        patch = {}
        if not (profil or {}).get("whatsapp"):
            patch["whatsapp"] = DEFAULT_WHATSAPP
        if not (profil or {}).get("kurir_list"):
            patch["kurir_list"] = DEFAULT_KURIR
        if not (profil or {}).get("live_welcome"):
            patch["live_welcome"] = DEFAULT_LIVE_WELCOME
        if patch:
            await db.profil_admin.update_one({}, {"$set": patch})

    # Seed a default admin whitelist account.
    if not await db.users.find_one({"username": "admin"}):
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": "admin@dianastuff.local",
            "username": "admin",
            "password_hash": hash_password("admin123"),
            "role": "admin",
            "nama": "Admin Diana",
            "wa": DEFAULT_WHATSAPP,
            "alamat": None,
            "kota": None,
            "kode_pos": None,
            "status": "approved",
            "auth_provider": "whitelist",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
            "deleted_at": None,
        })
        logger.info("Seeded admin user")

    # Seed a default buyer whitelist account (approved).
    if not await db.users.find_one({"username": "buyer"}):
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": "buyer@dianastuff.local",
            "username": "buyer",
            "password_hash": hash_password("buyer123"),
            "role": "buyer",
            "nama": "Pembeli Demo",
            "wa": "081234567890",
            "alamat": None,
            "kota": None,
            "kode_pos": None,
            "status": "approved",
            "auth_provider": "whitelist",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
            "deleted_at": None,
        })
        logger.info("Seeded buyer user")

    # Seed 3 sample baju products (only when catalog is empty).
    if await db.products.count_documents({"deleted_at": None}) == 0:
        samples = [
            {
                "kategori": "Baju",
                "nama_produk": "Blouse Katun Premium",
                "deskripsi": "Blouse katun adem, nyaman dipakai harian.",
                "harga": 89000,
                "stok": 20,
                "berat_gram": 250,
                "bisa_po": False,
                "foto_urls": ["https://images.unsplash.com/photo-1554568218-0f1715e72254?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"],
            },
            {
                "kategori": "Baju",
                "nama_produk": "Dress Floral Musim Panas",
                "deskripsi": "Dress motif bunga, bahan ringan dan flowy.",
                "harga": 159000,
                "stok": 12,
                "berat_gram": 350,
                "bisa_po": True,
                "foto_urls": ["https://images.unsplash.com/photo-1595777457583-95e059d581b8?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"],
            },
            {
                "kategori": "Baju",
                "nama_produk": "Kemeja Oversize Unisex",
                "deskripsi": "Kemeja oversize kekinian, cocok untuk gaya kasual.",
                "harga": 119000,
                "stok": 15,
                "berat_gram": 300,
                "bisa_po": False,
                "foto_urls": ["https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"],
            },
        ]
        for s in samples:
            s["id"] = uuid.uuid4().hex
            s["created_at"] = datetime.now(timezone.utc)
            s["deleted_at"] = None
        await db.products.insert_many(samples)
        logger.info("Seeded sample products")



app.include_router(api_router)

# ---------------------------------------------------------------------------
# Liveness & readiness (registered on the FastAPI app BEFORE the Socket.IO
# wrapper). Docker HEALTHCHECK uses /health; Kubernetes probes may use both.
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """Application liveness — process is up. No dependency checks."""
    return Response(
        content=json.dumps({"status": "ok"}),
        media_type="application/json",
        status_code=200,
    )


@app.get("/ready")
async def ready():
    """Readiness — MongoDB reachable. 503 when the database is unavailable."""
    try:
        await asyncio.wait_for(db.command("ping"), timeout=3.0)
    except Exception:
        return Response(
            content=json.dumps({"status": "error"}),
            media_type="application/json",
            status_code=503,
        )
    return Response(
        content=json.dumps({"status": "ok"}),
        media_type="application/json",
        status_code=200,
    )

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# ---------------------------------------------------------------------------
# Socket.IO realtime chat handlers + combined ASGI app
# ---------------------------------------------------------------------------
async def _user_from_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    session = await db.user_sessions.find_one({"session_token": token})
    if not session:
        return None
    return await db.users.find_one({"user_id": session["user_id"], "deleted_at": None}, {"_id": 0})


@sio.event
async def connect(sid, environ, auth):
    token = None
    if isinstance(auth, dict):
        token = auth.get("token")
    if not token:
        qs = environ.get("QUERY_STRING", "")
        for part in qs.split("&"):
            if part.startswith("token="):
                token = part.split("=", 1)[1]
    user = await _user_from_token(token)
    if user:
        await sio.save_session(sid, {
            "user_id": user["user_id"],
            "role": user.get("role", "buyer"),
            "nama": user.get("nama") or user.get("username"),
            "username": user.get("username"),
        })
        # Everyone joins their own room so they receive chat + order events;
        # admins additionally join the broadcast room.
        await sio.enter_room(sid, user["user_id"])
        if user.get("role") == "admin":
            await sio.enter_room(sid, "admins")
        return True
    # Guests are allowed a limited connection (live shopping interactions only).
    await sio.save_session(sid, {
        "user_id": f"guest_{sid}",
        "role": "guest",
        "nama": "Tamu",
        "username": None,
    })
    return True


@sio.event
async def join(sid, data):
    session = await sio.get_session(sid)
    if session["role"] == "guest":
        return
    room = (data or {}).get("room") or session["user_id"]
    if session["role"] != "admin" and room != session["user_id"]:
        return
    await sio.enter_room(sid, room)


@sio.event
async def message(sid, data):
    session = await sio.get_session(sid)
    if session["role"] == "guest":
        return
    room = (data or {}).get("room") if session["role"] == "admin" else session["user_id"]
    if not room:
        return
    text = (data or {}).get("text")
    image_url = (data or {}).get("image_url")
    if not text and not image_url:
        return
    doc = await save_chat_message(room, session, text, image_url)
    await sio.emit("message", chat_public(doc), room=[room, "admins"])
    await _notify_chat(doc)




# Wrap FastAPI with Socket.IO. Uvicorn serves this combined `app`.
app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="api/socket.io")

