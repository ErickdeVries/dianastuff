from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends, UploadFile, File, Form, Request
from fastapi.responses import Response, FileResponse
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
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
# Emergent Object Storage
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
AGORA_APP_ID = os.environ.get("AGORA_APP_ID", "")
AGORA_APP_CERTIFICATE = os.environ.get("AGORA_APP_CERTIFICATE", "")
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
    kurir_list: Optional[List[str]] = None
    live_welcome: Optional[str] = None


class AddressUpdate(BaseModel):
    nama: Optional[str] = None
    wa: Optional[str] = None
    alamat: str
    kota: str
    kode_pos: Optional[str] = None


class OrderItemIn(BaseModel):
    product_id: str
    qty: int


class OrderCreate(BaseModel):
    items: List[OrderItemIn]
    kurir: Optional[str] = None
    ongkir: float = 0
    catatan: Optional[str] = None


class OngkirIn(BaseModel):
    kota: str
    kurir: str
    harga: float = 0


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
# AI helpers (Emergent Universal LLM key) — auto product info + photo enhance
# ---------------------------------------------------------------------------
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
    if not EMERGENT_KEY:
        raise HTTPException(status_code=503, detail="AI belum dikonfigurasi")
    try:
        b64, _mime = await run_in_threadpool(_load_image_b64, payload.foto_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Foto tidak dapat dibaca")

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
    if not EMERGENT_KEY:
        raise HTTPException(status_code=503, detail="AI belum dikonfigurasi")
    try:
        b64, _mime = await run_in_threadpool(_load_image_b64, payload.foto_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Foto tidak dapat dibaca")

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
    async for o in cursor:
        rv = o.get("review") or {}
        rating = int(rv.get("rating", 0) or 0)
        if rating < 1:
            continue
        total += rating
        items.append({
            "rating": rating,
            "komentar": rv.get("komentar", ""),
            "foto_url": rv.get("foto_url"),
            "nama": (o.get("alamat") or {}).get("nama") or "Pembeli",
            "created_at": rv["created_at"].isoformat() if rv.get("created_at") else None,
        })
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    count = len(items)
    average = round(total / count, 1) if count else 0
    return {"average": average, "count": count, "items": items}


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
        "ongkir": o.get("ongkir", 0),
        "total": o.get("total", 0),
        "status": o.get("status"),
        "no_resi": o.get("no_resi"),
        "alamat": o.get("alamat"),
        "kurir": o.get("kurir"),
        "catatan": o.get("catatan"),
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
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(doc)


@api_router.get("/ongkir")
async def cek_ongkir(kota: str, kurir: str, user: dict = Depends(get_current_user)):
    row = await db.ongkir_manual.find_one(
        {"kota": {"$regex": f"^{re.escape(kota.strip())}$", "$options": "i"}, "kurir": kurir},
        {"_id": 0},
    )
    if not row:
        return {"found": False, "harga": None}
    return {"found": True, "harga": row.get("harga", 0)}


# ---------------------------------------------------------------------------
# Admin: manual shipping cost (ongkir) management
# ---------------------------------------------------------------------------
def ongkir_public(o: dict) -> dict:
    return {
        "id": o.get("id"),
        "kota": o.get("kota", ""),
        "kurir": o.get("kurir", ""),
        "harga": o.get("harga", 0),
    }


@api_router.get("/admin/ongkir")
async def list_ongkir(admin: dict = Depends(require_admin)):
    docs = await db.ongkir_manual.find({}, {"_id": 0}).sort([("kota", 1), ("kurir", 1)]).to_list(1000)
    return [ongkir_public(d) for d in docs]


@api_router.post("/admin/ongkir")
async def create_ongkir(payload: OngkirIn, admin: dict = Depends(require_admin)):
    kota = payload.kota.strip()
    kurir = payload.kurir.strip()
    if not kota or not kurir:
        raise HTTPException(status_code=400, detail="Kota dan kurir wajib diisi")
    if payload.harga < 0:
        raise HTTPException(status_code=400, detail="Harga tidak valid")
    existing = await db.ongkir_manual.find_one(
        {"kota": {"$regex": f"^{re.escape(kota)}$", "$options": "i"}, "kurir": kurir}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tarif untuk kota & kurir ini sudah ada")
    doc = {
        "id": f"ongkir_{uuid.uuid4().hex[:12]}",
        "kota": kota,
        "kurir": kurir,
        "harga": payload.harga,
        "created_at": datetime.now(timezone.utc),
    }
    await db.ongkir_manual.insert_one(doc)
    return ongkir_public(doc)


@api_router.put("/admin/ongkir/{ongkir_id}")
async def update_ongkir(ongkir_id: str, payload: OngkirIn, admin: dict = Depends(require_admin)):
    existing = await db.ongkir_manual.find_one({"id": ongkir_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Tarif tidak ditemukan")
    kota = payload.kota.strip()
    kurir = payload.kurir.strip()
    if not kota or not kurir:
        raise HTTPException(status_code=400, detail="Kota dan kurir wajib diisi")
    if payload.harga < 0:
        raise HTTPException(status_code=400, detail="Harga tidak valid")
    dup = await db.ongkir_manual.find_one({
        "id": {"$ne": ongkir_id},
        "kota": {"$regex": f"^{re.escape(kota)}$", "$options": "i"},
        "kurir": kurir,
    })
    if dup:
        raise HTTPException(status_code=409, detail="Tarif untuk kota & kurir ini sudah ada")
    await db.ongkir_manual.update_one(
        {"id": ongkir_id},
        {"$set": {"kota": kota, "kurir": kurir, "harga": payload.harga}},
    )
    doc = await db.ongkir_manual.find_one({"id": ongkir_id}, {"_id": 0})
    return ongkir_public(doc)


@api_router.delete("/admin/ongkir/{ongkir_id}")
async def delete_ongkir(ongkir_id: str, admin: dict = Depends(require_admin)):
    res = await db.ongkir_manual.delete_one({"id": ongkir_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tarif tidak ditemukan")
    return {"message": "Tarif dihapus"}


@api_router.post("/orders")
async def create_order(payload: OrderCreate, user: dict = Depends(get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")
    if not user.get("alamat") or not user.get("kota"):
        raise HTTPException(status_code=400, detail="Lengkapi alamat pengiriman terlebih dahulu")

    # Load products and validate stock.
    order_items = []
    subtotal = 0.0
    for it in payload.items:
        if it.qty <= 0:
            continue
        product = await db.products.find_one({"id": it.product_id, "deleted_at": None})
        if not product:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
        if not product.get("bisa_po") and product.get("stok", 0) < it.qty:
            raise HTTPException(status_code=400, detail=f"Stok {product['nama_produk']} tidak cukup")
        line = product.get("harga", 0) * it.qty
        subtotal += line
        order_items.append({
            "product_id": it.product_id,
            "nama_produk": product.get("nama_produk"),
            "harga": product.get("harga", 0),
            "qty": it.qty,
            "foto": (product.get("foto_urls") or [None])[0],
            "subtotal": line,
        })

    if not order_items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")

    # Decrement stock (PO products may go negative).
    for it in order_items:
        await db.products.update_one({"id": it["product_id"]}, {"$inc": {"stok": -it["qty"]}})

    ongkir = max(0.0, payload.ongkir or 0)
    total = subtotal + ongkir
    now = datetime.now(timezone.utc)
    no_order = f"DS-{now.strftime('%y%m%d')}-{secrets.token_hex(2).upper()}"

    order = {
        "id": uuid.uuid4().hex,
        "no_order": no_order,
        "user_id": user["user_id"],
        "items": order_items,
        "subtotal": subtotal,
        "ongkir": ongkir,
        "total": total,
        "status": "menunggu_pembayaran",
        "status_history": [{"status": "menunggu_pembayaran", "at": now}],
        "alamat": {
            "nama": user.get("nama"),
            "wa": user.get("wa"),
            "alamat": user.get("alamat"),
            "kota": user.get("kota"),
            "kode_pos": user.get("kode_pos"),
        },
        "kurir": payload.kurir,
        "catatan": payload.catatan,
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
        no_resi = (body or {}).get("no_resi")
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
    doc = await db.orders.find_one({"id": order_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Pesanan tidak ditemukan")
    if doc.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"review": {
            "rating": rating,
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
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("user_id")
    await db.ongkir_manual.create_index([("kota", 1), ("kurir", 1)])

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

    # Seed sample manual shipping rates (only when empty) so checkout works.
    if await db.ongkir_manual.count_documents({}) == 0:
        ongkir_samples = [
            {"kota": "Jakarta", "kurir": "JNE", "harga": 12000},
            {"kota": "Jakarta", "kurir": "J&T", "harga": 11000},
            {"kota": "Bandung", "kurir": "JNE", "harga": 15000},
            {"kota": "Surabaya", "kurir": "JNE", "harga": 20000},
        ]
        for o in ongkir_samples:
            o["id"] = f"ongkir_{uuid.uuid4().hex[:12]}"
            o["created_at"] = datetime.now(timezone.utc)
        await db.ongkir_manual.insert_many(ongkir_samples)
        logger.info("Seeded sample ongkir_manual")



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




# Wrap FastAPI with Socket.IO. Uvicorn serves this combined `app`.
app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="api/socket.io")

