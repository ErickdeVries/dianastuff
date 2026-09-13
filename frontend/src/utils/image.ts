// Resolve a stored image reference to a full URL.
// - Full http(s) URLs are returned as-is (e.g. seeded Unsplash images).
// - "/api/files/..." or bare storage paths are prefixed with the backend URL.

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export function resolveImageUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `${BASE}${value}`;
  return `${BASE}/api/files/${value}`;
}
