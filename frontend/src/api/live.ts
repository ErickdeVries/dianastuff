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
  whatsapp?: string;
  status?: string;
  products?: LiveProduct[];
  started_at?: string | null;
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
    },
  });
}

export function stopLive(): Promise<{ live: boolean }> {
  return apiRequest<{ live: boolean }>("/api/live/stop", { method: "POST" });
}
