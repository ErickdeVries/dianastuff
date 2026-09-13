import { io, Socket } from "socket.io-client";

import { getToken } from "@/src/api/client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// One shared socket connection for the whole app.
let socket: Socket | null = null;

export async function connectSocket(): Promise<Socket> {
  if (socket && socket.connected) return socket;
  const token = await getToken();
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
}
