// Live shopping API helpers (Agora).
import { apiRequest } from "@/src/api/client";

export type LiveProduct = {
  id: string;
  nama_produk: string;
  harga: number;
  stok: number;
  bisa_po: boolean;
  foto_urls: string[];
};

export type LiveState = {
  live: boolean;
  channel?: string;
  title?: string;
  caption?: string;
  show_cart?: boolean;
  require_login?: boolean;
  featured?: LiveProduct | null;
  whatsapp?: string;
  status?: string;
  products?: LiveProduct[];
  started_at?: string | null;
};

export type LiveRecap = {
  peak_viewers: number;
  total_likes: number;
  orders_count: number;
  orders_total: number;
};

export type LiveHistoryItem = {
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  recap: LiveRecap;
};

export type LiveToken = {
  appId: string;
  channel: string;
  uid: number;
  token: string;
  role: string;
  expiresIn: number;
};

export function getCurrentLive(): Promise<LiveState> {
  return apiRequest<LiveState>("/api/live/current", { auth: false });
}

export function getLiveToken(role: "host" | "audience", uid: number): Promise<LiveToken> {
  return apiRequest<LiveToken>(`/api/live/token?role=${role}&uid=${uid}`, { auth: role === "host" });
}

export type StartLiveOptions = {
  title: string;
  caption?: string;
  productIds: string[];
  showCart?: boolean;
  requireLogin?: boolean;
  featuredProductId?: string | null;
};

export function startLive(opts: StartLiveOptions): Promise<LiveState> {
  return apiRequest<LiveState>("/api/live/start", {
    method: "POST",
    body: {
      title: opts.title,
      caption: opts.caption ?? "",
      product_ids: opts.productIds,
      show_cart: opts.showCart ?? true,
      require_login: opts.requireLogin ?? false,
      featured_product_id: opts.featuredProductId ?? null,
    },
  });
}

export function setFeatured(productId: string | null): Promise<{ featured: LiveProduct | null }> {
  return apiRequest("/api/live/feature", { method: "POST", body: { product_id: productId } });
}

export function getLiveHistory(): Promise<LiveHistoryItem[]> {
  return apiRequest<LiveHistoryItem[]>("/api/admin/live-history");
}

export function deleteLiveRecap(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/live-history/${id}`, { method: "DELETE" });
}

export function stopLive(): Promise<{ live: boolean }> {
  return apiRequest<{ live: boolean }>("/api/live/stop", { method: "POST" });
}

// ---- Realtime via MongoDB + REST polling (multi-worker safe) ----
export type LiveFeedMsg = {
  id: string;
  seq: number;
  uid?: string;
  name: string;
  role: string;
  text: string;
  ts?: string;
};

export type LiveFeedReaction = { seq: number; emoji: string };

export type LiveViewer = { name: string; role: string; uid: string; muted: boolean };

export type LivePinned = { id?: string; name: string; role: string; text: string } | null;

export type LiveFeed = {
  live: boolean;
  messages: LiveFeedMsg[];
  last_seq: number;
  reactions: LiveFeedReaction[];
  last_react: number;
  total_likes: number;
  pinned: LivePinned;
  featured: LiveProduct | null;
  viewers: LiveViewer[];
  viewers_count: number;
  muted: boolean;
  kicked: boolean;
};

export function getLiveFeed(opts: {
  sinceSeq: number;
  sinceReact: number;
  viewerId: string;
}): Promise<LiveFeed> {
  const qs = `since_seq=${opts.sinceSeq}&since_react=${opts.sinceReact}&viewer_id=${encodeURIComponent(opts.viewerId)}`;
  return apiRequest<LiveFeed>(`/api/live/feed?${qs}`);
}

export function sendLiveChat(opts: { viewerId: string; name?: string; text: string }): Promise<{ ok: boolean; muted?: boolean }> {
  return apiRequest("/api/live/chat", {
    method: "POST",
    body: { viewer_id: opts.viewerId, name: opts.name, text: opts.text },
  });
}

export function sendLiveReaction(opts: { viewerId: string; emoji: string }): Promise<{ ok: boolean }> {
  return apiRequest("/api/live/react", {
    method: "POST",
    body: { viewer_id: opts.viewerId, emoji: opts.emoji },
  });
}

export function sendLivePresence(opts: { viewerId: string; name?: string }): Promise<{ ok: boolean; muted: boolean; kicked: boolean }> {
  return apiRequest("/api/live/presence", {
    method: "POST",
    body: { viewer_id: opts.viewerId, name: opts.name },
  });
}

export function leaveLive(opts: { viewerId: string }): Promise<{ ok: boolean }> {
  return apiRequest("/api/live/leave", { method: "POST", body: { viewer_id: opts.viewerId } });
}

export function pinLiveComment(message: { id?: string; name: string; role: string; text: string }): Promise<{ pinned: LivePinned }> {
  return apiRequest("/api/live/pin", { method: "POST", body: { message } });
}

export function unpinLiveComment(): Promise<{ pinned: null }> {
  return apiRequest("/api/live/unpin", { method: "POST" });
}

export function muteLiveViewer(uid: string, mute: boolean): Promise<{ ok: boolean }> {
  return apiRequest("/api/live/mute", { method: "POST", body: { uid, mute } });
}

export function kickLiveViewer(uid: string): Promise<{ ok: boolean }> {
  return apiRequest("/api/live/kick", { method: "POST", body: { uid, mute: false } });
}
