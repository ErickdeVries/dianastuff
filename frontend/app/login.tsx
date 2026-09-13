import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQuery } from "@tanstack/react-query";

import { apiRequest, ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

type Profil = {
  nama_toko: string;
  logo_url?: string;
  banner_url?: string;
  whatsapp?: string;
};

type Tab = "google" | "whitelist";

function buildWaLink(whatsapp: string, namaToko: string) {
  let num = whatsapp.replace(/\D/g, "");
  if (num.startsWith("0")) num = "62" + num.slice(1);
  const text = `Halo Admin ${namaToko}, saya mau minta akun untuk belanja. Nama: `;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithGoogle, signingInGoogle, loginWhitelist } = useAuth();

  const [tab, setTab] = useState<Tab>("google");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: profil, isLoading: profilLoading } = useQuery<Profil>({
    queryKey: ["profil_admin"],
    queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }),
  });

  const namaToko = profil?.nama_toko ?? "Diana Stuff";
  const whatsapp = profil?.whatsapp?.trim() ?? "";

  const waLink = useMemo(
    () => (whatsapp ? buildWaLink(whatsapp, namaToko) : null),
    [whatsapp, namaToko],
  );

  const onGoogle = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal masuk dengan Google.");
    }
  };

  const onWhitelistLogin = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }
    setSubmitting(true);
    try {
      await loginWhitelist(username.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal masuk. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const openWa = () => {
    if (waLink) Linking.openURL(waLink);
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        style={styles.root}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 170 + insets.bottom }]}
        bottomOffset={130}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner + logo header */}
        <View style={styles.header}>
          <Image
            source={{ uri: resolveImageUrl(profil?.banner_url) }}
            style={styles.banner}
            contentFit="cover"
            transition={300}
          />
          <LinearGradient
            colors={["transparent", colors.surface]}
            style={styles.scrim}
          />
          <View style={styles.logoWrap}>
            <View style={styles.logoRing}>
              <Image source={{ uri: resolveImageUrl(profil?.logo_url) }} style={styles.logo} contentFit="cover" />
            </View>
          </View>
        </View>

        <Text style={styles.storeName} testID="store-name">
          {namaToko}
        </Text>
        <Text style={styles.tagline}>Masuk untuk mulai belanja</Text>

        {/* Auth card */}
        <View style={styles.card} testID="login-card">
          <View style={styles.segment}>
            <Pressable
              testID="tab-google"
              onPress={() => {
                setTab("google");
                setError(null);
              }}
              style={[styles.segmentItem, tab === "google" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, tab === "google" && styles.segmentTextActive]}>
                Login Gmail
              </Text>
            </Pressable>
            <Pressable
              testID="tab-whitelist"
              onPress={() => {
                setTab("whitelist");
                setError(null);
              }}
              style={[styles.segmentItem, tab === "whitelist" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, tab === "whitelist" && styles.segmentTextActive]}>
                Login Whitelist
              </Text>
            </Pressable>
          </View>

          {error ? (
            <Text style={styles.error} testID="login-error">
              {error}
            </Text>
          ) : null}

          {tab === "google" ? (
            <View style={styles.tabBody}>
              <Text style={styles.helper}>
                Masuk cepat dan aman dengan akun Google Anda.
              </Text>
              <M3Button
                testID="google-signin-button"
                label="Login dengan Google"
                icon="google"
                variant="outlined"
                loading={signingInGoogle}
                onPress={onGoogle}
              />
            </View>
          ) : (
            <View style={styles.tabBody}>
              <M3TextField
                label="Username"
                icon="account-outline"
                placeholder="username kamu"
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                containerTestID="username-input"
              />
              <M3TextField
                label="Password"
                icon="lock-outline"
                placeholder="••••••••"
                password
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
                containerTestID="password-input"
              />
              <M3Button
                testID="whitelist-login-button"
                label="Masuk"
                variant="filled"
                loading={submitting}
                onPress={onWhitelistLogin}
              />
              <Pressable
                testID="go-register"
                onPress={() => router.push("/register")}
                style={styles.registerLink}
              >
                <Text style={styles.registerText}>
                  Belum punya akun? <Text style={styles.registerTextBold}>Daftar</Text>
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>

      {/* Sticky WhatsApp CTA / fallback */}
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {profilLoading ? null : waLink ? (
            <M3Button
              testID="whatsapp-button"
              label="Minta Akun via WhatsApp"
              icon="whatsapp"
              variant="fab"
              onPress={openWa}
            />
          ) : (
            <Text style={styles.contactAdmin} testID="contact-admin-text">
              Hubungi admin untuk daftar
            </Text>
          )}
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const BANNER_HEIGHT = 260;
const LOGO_SIZE = 88;
const LOGO_OVERLAP = 32;

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    height: BANNER_HEIGHT,
    marginHorizontal: -20,
    marginBottom: LOGO_OVERLAP + 8,
  },
  banner: {
    width: "100%",
    height: BANNER_HEIGHT,
    backgroundColor: colors.surfaceTertiary,
  },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: BANNER_HEIGHT,
  },
  logoWrap: {
    position: "absolute",
    bottom: -LOGO_OVERLAP,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  logoRing: {
    width: LOGO_SIZE + 8,
    height: LOGO_SIZE + 8,
    borderRadius: (LOGO_SIZE + 8) / 2,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    backgroundColor: colors.surfaceTertiary,
  },
  storeName: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.onSurface,
    textAlign: "center",
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 24,
    padding: 20,
    gap: 16,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 999,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: colors.brandPrimary,
  },
  segmentText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.onSurfaceTertiary,
  },
  segmentTextActive: {
    color: colors.onBrandPrimary,
  },
  tabBody: {
    gap: 16,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
  },
  registerLink: {
    alignItems: "center",
    paddingVertical: 4,
  },
  registerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  registerTextBold: {
    fontFamily: fonts.bodyMedium,
    color: colors.brandPrimary,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  contactAdmin: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    paddingVertical: 14,
  },
}));
