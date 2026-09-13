// Global realtime notification listener.
//
// Mounted once in the root layout. Whenever the user is logged in it keeps the
// shared socket connected and turns server events into in-app notifications:
//   - "message"      -> toast + refresh chat unread badges / room list
//   - "new_order"    -> admin toast + refresh order list & stats
//   - "order_status" -> buyer toast + refresh their orders
//
// Chat toasts are suppressed while the user is already viewing that chat room.

import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/context/toast";
import { connectSocket } from "@/src/lib/socket";
import { STATUS_LABEL } from "@/src/utils/order";

export function NotificationListener() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ room?: string }>();

  // Keep the current route in refs so socket handlers always see fresh values.
  const routeRef = useRef({ pathname, room: params.room });
  useEffect(() => {
    routeRef.current = { pathname, room: params.room };
  }, [pathname, params.room]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let socket: any = null;
    const handlers: { event: string; fn: (...args: any[]) => void }[] = [];

    const on = (event: string, fn: (...args: any[]) => void) => {
      handlers.push({ event, fn });
      socket?.on(event, fn);
    };

    (async () => {
      socket = await connectSocket();
      if (!alive) return;
      for (const h of handlers) socket.on(h.event, h.fn);
    })();

    on("message", (msg: any) => {
      if (!msg || msg.sender_id === user.user_id) return;
      queryClient.invalidateQueries({ queryKey: ["chat", "unread"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "rooms"] });
      const { pathname: p, room } = routeRef.current;
      const viewingThisChat =
        p === "/chat" && (user.role !== "admin" || !room || room === msg.room);
      if (viewingThisChat) return;
      const from = msg.sender_nama || (msg.sender_role === "admin" ? "Admin" : "Pembeli");
      toast.show(`Pesan baru dari ${from}`, "info");
    });

    on("new_order", (order: any) => {
      if (user.role !== "admin" || !order) return;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.show(`Pesanan baru ${order.no_order ?? ""}`.trim(), "info");
    });

    on("order_received", (order: any) => {
      if (user.role !== "admin" || !order) return;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.show(`Paket ${order.no_order ?? ""} sudah diterima ${order.nama ?? "pembeli"}`.trim(), "success");
    });

    on("order_status", (order: any) => {
      if (user.role === "admin" || !order) return;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      const label = STATUS_LABEL[order.status] ?? order.status;
      toast.show(`Pesanan ${order.no_order ?? ""}: ${label}`.trim(), "info");
    });

    return () => {
      alive = false;
      if (socket) {
        for (const h of handlers) socket.off(h.event, h.fn);
      }
    };
    // Handlers intentionally re-register only when the logged-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  return null;
}
