import { io, Socket } from "socket.io-client";

import { getToken } from "@/src/api/client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// One shared socket connection for the whole app.
let socket: Socket | null = null;
// Token yang dipakai saat koneksi dibuat — untuk mendeteksi perubahan auth.
let socketToken: string | null = null;

export async function connectSocket(): Promise<Socket> {
  const token = await getToken();
  // Jika status login berubah (mis. socket tersambung sebagai tamu lalu user login),
  // buang koneksi lama agar koneksi baru membawa token & join room yang benar.
  if (socket && socketToken !== token) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch {}
    socket = null;
  }
  if (socket && socket.connected) return socket;
  socketToken = token;
  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }
  socket = io(BASE as string, {
    path: "/api/socket.io",
    transports: ["websocket", "polling"],
    auth: { token },
    reconnection: true,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socketToken = null;
}
