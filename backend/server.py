from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends, UploadFile, File, Form, Request
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import secrets
import bcrypt
import httpx
import requests
from pathlib import Path
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
# Emergent Object Storage
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "diana-stuff"
_storage_key: Optional[str] = None


def init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
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


def product_public(p: dict) -> dict:
    return {
        "id": p.get("id"),
        "kategori": p.get("kategori", ""),
        "nama_produk": p.get("nama_produk"),
        "deskripsi": p.get("deskripsi", ""),
        "harga": p.get("harga", 0),
        "stok": p.get("stok", 0),
        "berat_gram": p.get("berat_gram", 0),
        "bisa_po": p.get("bisa_po", False),
        "foto_urls": p.get("foto_urls", []),
        "created_at": p.get("created_at").isoformat() if p.get("created_at") else None,
    }


# ---------------------------------------------------------------------------
# Routes
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


# ---------------------------------------------------------------------------
# Uploads / file serving (Emergent Object Storage)
# ---------------------------------------------------------------------------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Ukuran foto maksimal 8MB")
    content_type = file.content_type or "image/jpeg"
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    if len(ext) > 5:
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{admin['user_id']}/{uuid.uuid4().hex}.{ext}"
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
    return [product_public(d) for d in docs]


@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    doc = await db.products.find_one({"id": product_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    return product_public(doc)


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
    await db.profil_admin.update_one({}, {"$set": data}, upsert=True)
    profil = await db.profil_admin.find_one({}, {"_id": 0})
    return profil


# ---------------------------------------------------------------------------
# Dashboard stats — admin only
# ---------------------------------------------------------------------------
@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    produk = await db.products.count_documents({"deleted_at": None})
    pelanggan = await db.users.count_documents({"role": "buyer", "deleted_at": None})
    pending = await db.users.count_documents({"role": "buyer", "status": "pending", "deleted_at": None})
    return {"produk": produk, "pelanggan": pelanggan, "pending": pending, "pesanan": 0}



# ---------------------------------------------------------------------------
# Startup: indexes + seed data
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
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
        })
        logger.info("Seeded profil_admin")
    else:
        # Ensure the store WhatsApp is set (in international 62 format).
        profil = await db.profil_admin.find_one({})
        if not (profil or {}).get("whatsapp"):
            await db.profil_admin.update_one({}, {"$set": {"whatsapp": DEFAULT_WHATSAPP}})

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


app.include_router(api_router)

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
