// Shopping cart state, persisted to local storage.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { storage } from "@/src/utils/storage";

const CART_KEY = "diana_cart";

export type CartItem = {
  product_id: string;
  nama_produk: string;
  harga: number;
  foto?: string | null;
  qty: number;
  stok: number;
  bisa_po: boolean;
  variation_key?: string | null;
  variation_label?: string | null;
  weight?: number; // berat per unit (gram) untuk hitung ongkir
};

// A cart line is unique per product + chosen variation.
export function cartLineId(i: { product_id: string; variation_key?: string | null }): string {
  return `${i.product_id}::${i.variation_key ?? ""}`;
}

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (lineId: string, qty: number) => void;
  removeItem: (lineId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<CartItem[]>(CART_KEY, []);
      if (Array.isArray(saved)) setItems(saved);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) storage.setItem(CART_KEY, items as any);
  }, [items]);

  const addItem: CartContextValue["addItem"] = (item, qty = 1) => {
    setItems((prev) => {
      const id = cartLineId(item);
      const existing = prev.find((p) => cartLineId(p) === id);
      if (existing) {
        return prev.map((p) =>
          cartLineId(p) === id ? { ...p, qty: p.qty + qty } : p,
        );
      }
      return [...prev, { ...item, qty }];
    });
  };

  const setQty: CartContextValue["setQty"] = (lineId, qty) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((p) => cartLineId(p) !== lineId)
        : prev.map((p) => (cartLineId(p) === lineId ? { ...p, qty } : p)),
    );
  };

  const removeItem = (lineId: string) =>
    setItems((prev) => prev.filter((p) => cartLineId(p) !== lineId));

  const clear = () => setItems([]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((n, i) => n + i.qty, 0);
    const subtotal = items.reduce((n, i) => n + i.harga * i.qty, 0);
    return { items, count, subtotal, addItem, setQty, removeItem, clear };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
