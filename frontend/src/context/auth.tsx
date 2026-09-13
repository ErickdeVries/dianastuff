// Auth state for Diana Stuff.
//
// - Emergent Google login (session_id -> POST /api/auth/session -> session_token)
// - Whitelist login/register (username + password)
//
// One root-layout gate (see app/_layout.tsx) owns all navigation. This context
// only sets the `user`/`loading` state; the gate reacts to it.

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { apiRequest, clearToken, getToken, persistToken, setMemToken } from "@/src/api/client";

WebBrowser.maybeCompleteAuthSession();

export type User = {
  user_id: string;
  email: string | null;
  username: string | null;
  role: "admin" | "buyer";
  nama: string | null;
  wa: string | null;
  alamat: string | null;
  kota: string | null;
  kode_pos: string | null;
  status: string;
  auth_provider: string;
  picture: string | null;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signingInGoogle: boolean;
  signInWithGoogle: () => Promise<void>;
  loginWhitelist: (username: string, password: string) => Promise<void>;
  registerWhitelist: (payload: {
    username: string;
    password: string;
    nama: string;
    email?: string;
    wa?: string;
  }) => Promise<{ message: string; status: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_URL = "https://auth.emergentagent.com/";

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/[?#&]session_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingInGoogle, setSigningInGoogle] = useState(false);
  const processedSessions = useRef<Set<string>>(new Set());

  const exchangeSession = useCallback(async (sessionId: string) => {
    if (processedSessions.current.has(sessionId)) return;
    processedSessions.current.add(sessionId);
    const data = await apiRequest<{ session_token: string; user: User }>(
      "/api/auth/session",
      { method: "POST", body: { session_id: sessionId }, auth: false },
    );
    await persistToken(data.session_token);
    setUser(data.user);
  }, []);

  const loadFromToken = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await apiRequest<User>("/api/auth/me");
      setUser(me);
    } catch {
      await clearToken();
      setMemToken(null);
      setUser(null);
    }
  }, []);

  // Bootstrap on mount: handle web OAuth redirect first, then cold-start deep
  // links (mobile), otherwise restore an existing session.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (Platform.OS === "web") {
          const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
          if (sid) {
            await exchangeSession(sid);
            try {
              window.history.replaceState(
                window.history.state,
                "",
                window.location.origin + window.location.pathname,
              );
            } catch {}
            return;
          }
        } else {
          const initialUrl = await Linking.getInitialURL();
          const sid = extractSessionId(initialUrl);
          if (sid) {
            await exchangeSession(sid);
            return;
          }
        }
        await loadFromToken();
      } catch (e) {
        console.error("[auth] bootstrap error", e);
        await loadFromToken();
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Hot deep links (mobile).
    const sub = Linking.addEventListener("url", async ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) {
        try {
          await exchangeSession(sid);
        } catch (e) {
          console.error("[auth] hot link exchange error", e);
        }
      }
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [exchangeSession, loadFromToken]);

  const signInWithGoogle = useCallback(async () => {
    setSigningInGoogle(true);
    try {
      if (Platform.OS === "web") {
        const redirectUrl = window.location.origin + "/";
        window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;
        return;
      }

      const redirectUrl = Linking.createURL("");
      const authUrl = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;

      let captured: string | null = null;
      const sub = Linking.addEventListener("url", ({ url }) => {
        if (!captured) captured = url;
      });

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      sub.remove();

      let sid: string | null = null;
      if (result.type === "success" && result.url) {
        sid = extractSessionId(result.url);
      }
      if (!sid) sid = extractSessionId(captured);
      if (!sid) sid = extractSessionId(await Linking.getInitialURL());

      if (sid) {
        await exchangeSession(sid);
      }
    } finally {
      setSigningInGoogle(false);
    }
  }, [exchangeSession]);

  const loginWhitelist = useCallback(async (username: string, password: string) => {
    const data = await apiRequest<{ session_token: string; user: User }>(
      "/api/auth/login-whitelist",
      { method: "POST", body: { username, password }, auth: false },
    );
    await persistToken(data.session_token);
    setUser(data.user);
  }, []);

  const registerWhitelist = useCallback(
    async (payload: { username: string; password: string; nama: string; email?: string; wa?: string }) => {
      return apiRequest<{ message: string; status: string }>("/api/auth/register-whitelist", {
        method: "POST",
        body: payload,
        auth: false,
      });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setMemToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signingInGoogle,
        signInWithGoogle,
        loginWhitelist,
        registerWhitelist,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
