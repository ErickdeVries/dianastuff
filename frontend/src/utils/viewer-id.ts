// Stable per-device identifier for live-shopping presence & moderation.
// Guests (not logged in) are identified by this id so the host can mute/kick them
// and so viewer counts dedup correctly across polls.
import { storage } from "@/src/utils/storage";

const VIEWER_ID_KEY = "diana_live_viewer_id";

let cached: string | null = null;

function randomId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getViewerId(): Promise<string> {
  if (cached) return cached;
  const stored = await storage.getItem<string | null>(VIEWER_ID_KEY, null);
  if (stored) {
    cached = stored;
    return stored;
  }
  const fresh = randomId();
  cached = fresh;
  await storage.setItem(VIEWER_ID_KEY, fresh);
  return fresh;
}

// ---- Guest display name for live chat (no login required) ----
const GUEST_NAME_KEY = "diana_live_name";

export async function getGuestName(): Promise<string | null> {
  const stored = await storage.getItem<string | null>(GUEST_NAME_KEY, null);
  return stored && stored.trim() ? stored.trim() : null;
}

export async function setGuestName(name: string): Promise<void> {
  await storage.setItem(GUEST_NAME_KEY, name.trim());
}
