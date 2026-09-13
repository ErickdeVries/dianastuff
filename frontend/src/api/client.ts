// Thin API client for the Diana Stuff backend.
// All API routes are prefixed with /api. The auth session token is stored in
// the secure store (Keychain / EncryptedSharedPreferences / localStorage on web)
// and also cached in memory so the Authorization header is always attached.

import { storage } from "@/src/utils/storage";

export const TOKEN_KEY = "diana_session_token";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

let memToken: string | null = null;

export function setMemToken(token: string | null) {
  memToken = token;
}

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  const stored = await storage.secureGet<string | null>(TOKEN_KEY, null);
  if (stored) memToken = stored;
  return stored;
}

export async function persistToken(token: string) {
  memToken = token;
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  memToken = null;
  await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

export async function apiRequest<T = any>(
  path: string,
  { method = "GET", body, auth = true }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      (data && (data.detail || data.message)) || "Terjadi kesalahan, coba lagi.";
    throw new ApiError(res.status, typeof message === "string" ? message : "Terjadi kesalahan");
  }

  return data as T;
}
