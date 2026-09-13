from fastapi import FastAPI, APIRouter, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import secrets
import bcrypt
import httpx
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
DEFAULT_WHATSAPP = "085312812452"


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
# Startup: indexes + seed data
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("username", sparse=True)
    await db.users.create_index("email", sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)

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
