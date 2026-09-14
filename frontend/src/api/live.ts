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
