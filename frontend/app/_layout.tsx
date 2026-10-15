import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { NotificationListener } from "@/src/components/notification-listener";
import { AuthProvider, useAuth } from "@/src/context/auth";
import { CartProvider } from "@/src/context/cart";
import { ToastProvider } from "@/src/context/toast";
import { getColdStartActionUrl, useNotificationTap } from "@/src/utils/push";
import { queryClient } from "@/src/query-client";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);

// Push notification channel must exist at module scope (before any push
// arrives) so data-only FCM payloads render correctly even when the app is
// killed. Creating it lazily inside the register flow can drop the first push.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Umum",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#A855F7",
  }).catch(() => {});
}

function Splash() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}

function RootNav() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const root = segments[0];
    const inAuthGroup = root === "login" || root === "register";
    // Guests may browse the landing page, storefront + webview; everything else needs auth.
    const publicGroup = !root || root === "landing" || root === "toko" || root === "produk" || root === "webview" || root === "live";
    let cancelled = false;
    if (!user && !inAuthGroup && !publicGroup) {
      router.replace("/login");
    } else if (user && (inAuthGroup || !root)) {
      // After a Google OAuth redirect the user lands back on "/" — route them in.
      // Buyers go straight to the storefront; admins to their home screen.
      // A push notification that cold-started the app wins over this default
      // redirect — otherwise router.replace here clobbers the deep-link.
      (async () => {
        const pushUrl = !root ? await getColdStartActionUrl() : null;
        if (cancelled) return;
        if (pushUrl) {
          try {
            router.replace(pushUrl as any);
            return;
          } catch { /* fall through to the default landing */ }
        }
        router.replace(user.role === "admin" ? "/home" : "/toko");
      })();
    }
    return () => { cancelled = true; };
  }, [user, loading, segments, router]);

  // Deep-link when a push notification is tapped.
  useNotificationTap((url) => {
    try { router.push(url as any); } catch { /* ignore invalid routes */ }
  });

  if (loading) return <Splash />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "Poppins-Regular": require("../assets/fonts/Poppins-Regular.ttf"),
    "Poppins-Medium": require("../assets/fonts/Poppins-Medium.ttf"),
    "Poppins-SemiBold": require("../assets/fonts/Poppins-SemiBold.ttf"),
    "Inter-Regular": require("../assets/fonts/Inter-Regular.ttf"),
    "Inter-Medium": require("../assets/fonts/Inter-Medium.ttf"),
    // Prewarm the icon font so glyphs load reliably in Expo Go (Android).
    ...MaterialDesignIcons.font,
  });

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <CartProvider>
                  <ToastProvider>
                    <NotificationListener />
                    <RootNav />
                    <StatusBar style="dark" />
                  </ToastProvider>
                </CartProvider>
              </AuthProvider>
            </QueryClientProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
