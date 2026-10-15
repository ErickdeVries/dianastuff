// Image picking (expo-image-picker) + upload to the backend /api/upload route,
// which stores the file in Emergent Object Storage and returns { path, url }.
//
// The multipart body differs by runtime: react-native-web needs a real Blob,
// native needs the { uri, name, type } shape. Never set Content-Type manually.

import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { ApiError, getToken } from "@/src/api/client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// Resize (max 1280px) + compress so catalog photos are uniform & fast to load.
// Uses the SDK 54+ contextual ImageManipulator API (manipulateAsync is
// deprecated and misbehaves in release APKs). Always yields a file:// cache
// uri — the shape fetch/FormData uploads reliably on native.
async function compressAsset(asset: ImagePicker.ImagePickerAsset): Promise<{ uri: string }> {
  try {
    const needsResize = (asset.width ?? 0) > 1280 || (asset.height ?? 0) > 1280;
    const context = ImageManipulator.manipulate(asset.uri);
    if (needsResize) context.resize({ width: 1280 });
    const image = await context.renderAsync();
    const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: result.uri };
  } catch {
    // If manipulation fails, fall back to the original asset.
    return { uri: asset.uri };
  }
}

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
  if (!token) {
    throw new ApiError(401, "Sesi tidak ditemukan. Silakan login ulang.");
  }
  // Compress/resize first for uniform, lightweight catalog images.
  const compressed = await compressAsset(asset);
  const uri = compressed.uri;
  const name = `photo_${Date.now()}.jpg`;

  const form = new FormData();
  if (Platform.OS === "web") {
    // On web the Blob approach is correct; on Android it can produce zero-byte
    // payloads, so it is web-only.
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    // SDK 54+ release builds use the WinterCG fetch, whose FormData rejects the
    // legacy RN { uri, name, type } part ("Unsupported FormDataPart
    // implementation"). expo-file-system's File implements Blob and is the
    // supported native upload part (handles file:// and content:// URIs).
    form.append("file", new File(uri));
  }

  // IMPORTANT: never set Content-Type manually — fetch must add the multipart
  // boundary itself, otherwise the server receives an empty body.
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    // Network-level failure (no HTTP response at all). Surface the raw reason
    // so device-specific issues are diagnosable instead of a generic message.
    const reason = e instanceof Error ? e.message : String(e);
    throw new ApiError(0, `Gagal mengunggah foto (jaringan): ${reason}`);
  }

  if (!res.ok) {
    let msg = `Gagal mengunggah foto (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = data.detail;
    } catch {}
    if (res.status === 401) msg = "Sesi telah berakhir. Silakan login ulang.";
    if (res.status === 413) msg = "Foto terlalu besar. Coba foto lain atau perkecil ukurannya.";
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
