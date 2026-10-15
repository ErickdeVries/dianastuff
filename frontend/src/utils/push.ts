// Push notifications (Emergent-managed relay). Native-only; no-ops on web /
// Expo Go. Registers the device's native FCM/APNs token against the logged-in
// user so the backend can target pushes by user_id.
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { apiRequest } from "@/src/api/client";

// Show banner + play sound when a push arrives in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(userId: string): Promise<void> {
  // Push only works in a real build on a physical device.
  if (Platform.OS === "web" || !Device.isDevice) return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted" && existing.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const tokenResp = await Notifications.getDevicePushTokenAsync();
    const deviceToken = typeof tokenResp.data === "string" ? tokenResp.data : JSON.stringify(tokenResp.data);
    await apiRequest("/api/register-push", {
      method: "POST",
      body: { user_id: userId, platform: Platform.OS, device_token: deviceToken },
    });
  } catch (e) {
    // Non-blocking: a failed registration must never break the app.
    console.log("[push] register skipped:", e instanceof Error ? e.message : e);
  }
}

// Cold-start tap: the notification that launched the app (consumed once per
// session). Read by the root-layout gate so its default landing redirect
// (buyer -> /toko, admin -> /home) doesn't clobber the deep-link.
let coldHandledId: string | null = null;
export async function getColdStartActionUrl(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const resp = await Notifications.getLastNotificationResponseAsync();
    if (!resp) return null;
    const id = resp.notification.request.identifier;
    if (coldHandledId === id) return null;
    coldHandledId = id;
    const data = resp.notification.request.content.data as { action_url?: string } | undefined;
    return data?.action_url ?? null;
  } catch {
    return null;
  }
}

// Navigate when the user taps a notification that carries an action_url.
// Warm taps only — cold-start is owned by the root gate in app/_layout.tsx.
export function useNotificationTap(onNavigate: (url: string) => void) {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === "web") return; // expo-notifications tap APIs are native-only
    const go = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const id = resp.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = resp.notification.request.content.data as { action_url?: string } | undefined;
      if (data?.action_url) onNavigate(data.action_url);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [onNavigate]);
}
