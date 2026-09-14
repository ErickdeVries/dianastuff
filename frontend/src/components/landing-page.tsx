// Landing page dianastuff (web + app). Publik — untuk pengunjung sebelum login.
// Dipakai oleh route "/" (index) dan "/landing".
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

type Profil = {
  nama_toko: string;
  logo_url?: string | null;
  banner_url?: string | null;
  whatsapp?: string;
  rekening_bank?: { bank: string; no_rek: string; a_n: string }[];
  kurir_list?: string[];
};

const FEATURES = [
  { icon: "access-point", title: "Live Shopping", desc: "Nonton siaran langsung, lihat produk secara real, dan belanja sambil live berlangsung." },
  { icon: "chat-outline", title: "Chat Realtime", desc: "Tanya produk, ukuran, atau stok langsung ke seller — dibalas seketika." },
  { icon: "cart-outline", title: "Checkout Mudah", desc: "Keranjang, ongkir otomatis per kota & kurir, lalu transfer dan konfirmasi pembayaran." },
  { icon: "package-variant-closed", title: "Lacak Pesanan", desc: "Pantau status pesanan dari diproses, dikirim, sampai tiba — lengkap dengan nomor resi." },
];

function waLink(no: string): string {
  let d = (no || "").replace(/\D/g, "");
  if (d.startsWith("620")) d = `62${d.slice(3)}`;
  else if (d.startsWith("0")) d = `62${d.slice(1)}`;
  return `https://wa.me/${d}`;
}

function waDisplay(no: string): string {
  let d = (no || "").replace(/\D/g, "");
  if (d.startsWith("62")) d = `0${d.slice(2)}`;
  return d.replace(/(\d{4})(\d{4})(\d+)/, "$1-$2-$3");
}

export function LandingPage() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: profil } = useQuery<Profil | null>({
    queryKey: ["profil-public"],
    queryFn: async () => {
      try {
        return await apiRequest<Profil>("/api/profil_admin", { auth: false });
      } catch {
        return null;
      }
    },
  });

  const banner = resolveImageUrl(profil?.banner_url ?? null);
  const logo = resolveImageUrl(profil?.logo_url ?? null);
  const namaToko = profil?.nama_toko || "Diana Stuff";
  const wa = profil?.whatsapp || "";
  const rekening = profil?.rekening_bank?.[0];
  const kurir = profil?.kurir_list ?? [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: insets.bottom }}>
      {/* ===== HERO ===== */}
      <View style={[styles.hero, { paddingTop: insets.top + 18 }]}>
        {banner ? <Image source={{ uri: banner }} style={styles.heroBg} contentFit="cover" /> : null}
        <View style={styles.heroOverlay} />

        <View style={styles.navbar}>
          <View style={styles.brandRow}>
            <View style={styles.logoBox}>
              {logo ? (
                <Image source={{ uri: logo }} style={styles.logoImg} contentFit="cover" />
              ) : (
                <Text style={styles.logoText}>D</Text>
              )}
            </View>
            <Text style={styles.brandName}>dianastuff</Text>
          </View>
          <Pressable testID="landing-login-top" style={styles.loginBtn} onPress={() => router.push("/login")}>
            <Text style={styles.loginBtnText}>Masuk</Text>
          </Pressable>
        </View>

        <View style={styles.heroBody}>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>LIVE SHOPPING & TOKO ONLINE</Text>
          </View>
          <Text style={styles.heroTitle}>
            Belanja Seru di{"\n"}
            <Text style={styles.heroTitleAccent}>dianastuff</Text>
          </Text>
          <Text style={styles.tagline}>
            Produk pilihan, harga bersahabat — nonton live shopping, chat langsung dengan seller, dan checkout tanpa ribet.
          </Text>
          <Pressable testID="landing-belanja" style={styles.ctaPrimary} onPress={() => router.push("/login")}>
            <MaterialDesignIcons name="cart-outline" size={20} color="#fff" />
            <Text style={styles.ctaPrimaryText}>Belanja Sekarang</Text>
          </Pressable>
          <Pressable testID="landing-live" style={styles.ctaGhost} onPress={() => router.push("/live")}>
            <MaterialDesignIcons name="access-point" size={20} color={colors.onSurfaceInverse} />
            <Text style={styles.ctaGhostText}>Tonton Live</Text>
          </Pressable>
          <View style={styles.trustRow}>
            <View style={styles.trustItem}>
              <MaterialDesignIcons name="check-circle" size={16} color={colors.success} />
              <Text style={styles.trustText}>Ongkir otomatis</Text>
            </View>
            <View style={styles.trustItem}>
              <MaterialDesignIcons name="check-circle" size={16} color={colors.success} />
              <Text style={styles.trustText}>Chat langsung seller</Text>
            </View>
            <View style={styles.trustItem}>
              <MaterialDesignIcons name="check-circle" size={16} color={colors.success} />
              <Text style={styles.trustText}>Ulasan berfoto</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ===== FITUR ===== */}
      <View style={styles.section}>
        <Text style={styles.eyebrow}>KENAPA DIANASTUFF</Text>
        <Text style={styles.sectionTitle}>Belanja Lebih Interaktif & Mudah</Text>
        <Text style={styles.sectionSub}>Semua kebutuhan belanja Anda dalam satu aplikasi — dari nonton live sampai pesanan tiba.</Text>
        <View style={styles.featGrid}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featCard}>
              <View style={styles.featIcon}>
                <MaterialDesignIcons name={f.icon as any} size={26} color={colors.brandPrimary} />
              </View>
              <Text style={styles.featTitle}>{f.title}</Text>
              <Text style={styles.featDesc}>{f.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ===== LIVE ===== */}
      <View style={styles.section}>
        <View style={styles.liveCard}>
          <View style={styles.liveBadge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>SEDANG / AKAN LIVE</Text>
          </View>
          <Text style={styles.liveTitle}>Jangan Lewatkan Live Shopping!</Text>
          <Text style={styles.liveDesc}>
            Diskon spesial & produk sorotan hanya saat live. Komen langsung, kirim like, dan checkout produk favorit tanpa ribet.
          </Text>
          <View style={styles.liveCtas}>
            <Pressable testID="landing-live-cta" style={styles.ctaPrimary} onPress={() => router.push("/live")}>
              <Text style={styles.ctaPrimaryText}>Gabung Live Sekarang</Text>
            </Pressable>
            <Pressable testID="landing-toko-cta" style={styles.ctaOutline} onPress={() => router.push("/toko")}>
              <Text style={styles.ctaOutlineText}>Lihat Etalase</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* ===== TENTANG & KONTAK ===== */}
      <View style={[styles.section, styles.aboutSection]}>
        <Text style={styles.eyebrow}>TENTANG KAMI</Text>
        <Text style={styles.sectionTitle}>{namaToko}</Text>
        <Text style={styles.sectionSub}>Toko online terpercaya dengan pengalaman belanja live yang menyenangkan.</Text>

        {wa ? (
          <Pressable style={styles.infoRow} onPress={() => Linking.openURL(waLink(wa))}>
            <View style={styles.infoIcon}><MaterialDesignIcons name="whatsapp" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>WhatsApp</Text>
              <Text style={styles.infoLink}>{waDisplay(wa)} — klik untuk chat langsung</Text>
            </View>
          </Pressable>
        ) : null}

        {rekening ? (
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><MaterialDesignIcons name="bank-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Pembayaran Transfer</Text>
              <Text style={styles.infoDesc}>{rekening.bank} {rekening.no_rek} a.n. {rekening.a_n}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <View style={styles.infoIcon}><MaterialDesignIcons name="clock-outline" size={20} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Jam Operasional</Text>
            <Text style={styles.infoDesc}>Senin – Sabtu, 09.00 – 21.00 WIB</Text>
          </View>
        </View>

        {kurir.length ? (
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><MaterialDesignIcons name="truck-delivery-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Pengiriman</Text>
              <View style={styles.chips}>
                {kurir.map((k) => (
                  <View key={k} style={styles.chip}><Text style={styles.chipText}>{k}</Text></View>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      {/* ===== FOOTER ===== */}
      <View style={styles.footer}>
        <Text style={styles.footerBrand}>dianastuff</Text>
        <Text style={styles.footerText}>© {new Date().getFullYear()} {namaToko}. Semua hak dilindungi.</Text>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },

  // Hero
  hero: { backgroundColor: colors.surfaceInverse, paddingBottom: 48 },
  heroBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.28 },
  heroOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(42,29,56,0.55)" },
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, width: "100%", maxWidth: 1100, alignSelf: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImg: { width: "100%", height: "100%" },
  logoText: { fontFamily: fonts.heading, fontSize: 18, color: colors.onBrandPrimary },
  brandName: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurfaceInverse },
  loginBtn: { borderWidth: 1.5, borderColor: colors.onSurfaceInverse, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  loginBtnText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceInverse },
  heroBody: { paddingHorizontal: 20, marginTop: 52, maxWidth: 720, width: "100%", alignSelf: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: "rgba(168,85,247,0.22)", borderWidth: 1, borderColor: colors.brandSecondary, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#F472B6" },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 1, color: colors.brandTertiary },
  heroTitle: { fontFamily: fonts.heading, fontSize: 40, lineHeight: 48, color: colors.onSurfaceInverse, marginTop: 22 },
  heroTitleAccent: { color: colors.brandSecondary },
  tagline: { fontFamily: fonts.body, fontSize: 16, lineHeight: 26, color: "#D9C6F5", marginTop: 14, marginBottom: 30 },
  ctaPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 999, paddingVertical: 16, paddingHorizontal: 28, alignSelf: "flex-start" },
  ctaPrimaryText: { fontFamily: fonts.heading, fontSize: 16, color: colors.onBrandPrimary },
  ctaGhost: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)", borderRadius: 999, paddingVertical: 14, paddingHorizontal: 28, alignSelf: "flex-start", marginTop: 12 },
  ctaGhostText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurfaceInverse },
  trustRow: { marginTop: 34, gap: 10 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  trustText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#C9B8E8" },

  // Sections
  section: { paddingHorizontal: 20, paddingVertical: 56, maxWidth: 1100, width: "100%", alignSelf: "center" },
  eyebrow: { fontFamily: fonts.heading, fontSize: 12, letterSpacing: 2, color: colors.brandPrimary },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 28, color: colors.onSurface, marginTop: 8 },
  sectionSub: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, marginTop: 10, marginBottom: 28 },

  // Fitur
  featGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  featCard: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: colors.divider },
  featIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  featTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface, marginBottom: 6 },
  featDesc: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.muted },

  // Live
  liveCard: { backgroundColor: colors.surfaceInverse, borderRadius: 26, padding: 28 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  liveTitle: { fontFamily: fonts.heading, fontSize: 26, color: colors.onSurfaceInverse, marginTop: 16 },
  liveDesc: { fontFamily: fonts.body, fontSize: 14, lineHeight: 22, color: "#D9C6F5", marginTop: 10, marginBottom: 22 },
  liveCtas: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  ctaOutline: { borderWidth: 1.5, borderColor: colors.onSurfaceInverse, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 24 },
  ctaOutlineText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurfaceInverse },

  // Tentang
  aboutSection: { backgroundColor: colors.surfaceTertiary },
  infoRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  infoTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  infoLink: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary, marginTop: 2 },
  infoDesc: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brandTertiary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceTertiary },

  // Footer
  footer: { backgroundColor: colors.surfaceInverse, paddingVertical: 32, alignItems: "center", gap: 4 },
  footerBrand: { fontFamily: fonts.heading, fontSize: 17, color: colors.onSurfaceInverse },
  footerText: { fontFamily: fonts.body, fontSize: 12, color: "#C9B8E8" },
}));
