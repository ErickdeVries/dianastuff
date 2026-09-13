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
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return { ok: true, canAskAgain: true };
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return { ok: req.granted, canAskAgain: req.canAskAgain };
}

export async function pickImages(limit: number): Promise<ImagePicker.ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.7,
  });
  if (result.canceled) return [];
  return result.assets ?? [];
}

export async function uploadAsset(asset: ImagePicker.ImagePickerAsset): Promise<{ path: string; url: string }> {
  const token = await getToken();
  const name = asset.fileName || `photo_${Date.now()}.jpg`;
  const type = asset.mimeType || "image/jpeg";

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: asset.uri, name, type } as any);
  }

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
  const assets = await pickImages(limit);
  if (assets.length === 0) return { urls: [] };
  try {
    const results = await Promise.all(assets.slice(0, limit).map((a) => uploadAsset(a)));
    return { urls: results.map((r) => r.url) };
  } catch (e) {
    return { urls: [], error: e instanceof ApiError ? e.message : "Gagal mengunggah foto" };
  }
}
