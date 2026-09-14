// Image picking (expo-image-picker) + upload to the backend /api/upload route,
// which stores the file in Emergent Object Storage and returns { path, url }.
//
// The multipart body differs by runtime: react-native-web needs a real Blob,
// native needs the { uri, name, type } shape. Never set Content-Type manually.

import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { ApiError, getToken } from "@/src/api/client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type PermResult = { ok: boolean; canAskAgain: boolean };

export async function ensureMediaPermission(): Promise<PermResult> {
  // Android 11+ uses the system photo picker for launchImageLibraryAsync,
  // which needs NO runtime permission. Asking for it on Android release
  // builds can hang or fail silently — so only gate iOS.
  if (Platform.OS === "android") return { ok: true, canAskAgain: false };
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return { ok: true, canAskAgain: true };
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return { ok: req.granted, canAskAgain: req.canAskAgain };
}

export async function pickImages(limit: number): Promise<ImagePicker.ImagePickerAsset[]> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit,
      quality: 0.7,
    });
    if (result.canceled) return [];
    return result.assets ?? [];
  } catch {
    // Surface native picker failures (e.g. missing image-loader module in a
    // release build) instead of dying silently.
    throw new Error("Galeri tidak bisa dibuka. Coba lagi atau restart aplikasi.");
  }
}

export async function uploadAsset(asset: ImagePicker.ImagePickerAsset): Promise<{ path: string; url: string }> {
  const token = await getToken();
  // Android often doesn't provide fileName/mimeType, so derive them from the
  // local uri to guarantee a valid multipart schema (see Expo issue #25577).
  const uriExt = (asset.uri.split("?")[0].split(".").pop() || "jpg").toLowerCase();
  const safeExt = uriExt.length <= 5 ? uriExt : "jpg";
  const name = asset.fileName || `photo_${Date.now()}.${safeExt}`;
  const type = asset.mimeType || `image/${safeExt === "jpg" ? "jpeg" : safeExt}`;

  const form = new FormData();
  if (Platform.OS === "web") {
    // On web the Blob approach is correct; on Android it can produce zero-byte
    // payloads, so it is web-only.
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: asset.uri, name, type } as any);
  }

  // IMPORTANT: never set Content-Type manually — fetch must add the multipart
  // boundary itself, otherwise the server receives an empty body.
  const res = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (!res.ok) {
    let msg = "Gagal mengunggah foto";
    try {
      const data = await res.json();
      msg = data?.detail || msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export type PickUploadResult = {
  urls: string[];
  permissionDenied?: boolean;
  canAskAgain?: boolean;
  error?: string;
};

// Full flow: ensure permission -> pick -> upload each. Returns the relative
// "/api/files/..." urls to store in the DB.
export async function pickAndUploadImages(limit: number): Promise<PickUploadResult> {
  const perm = await ensureMediaPermission();
  if (!perm.ok) {
    return { urls: [], permissionDenied: true, canAskAgain: perm.canAskAgain };
  }
  let assets: ImagePicker.ImagePickerAsset[];
  try {
    assets = await pickImages(limit);
  } catch (e) {
    return { urls: [], error: e instanceof Error ? e.message : "Galeri tidak bisa dibuka" };
  }
  if (assets.length === 0) return { urls: [] };
  try {
    const results = await Promise.all(assets.slice(0, limit).map((a) => uploadAsset(a)));
    return { urls: results.map((r) => r.url) };
  } catch (e) {
    return { urls: [], error: e instanceof ApiError ? e.message : "Gagal mengunggah foto" };
  }
}
