import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { getCurrentLive, LiveState, startLive, stopLive } from "@/src/api/live";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

type Product = { id: string; nama_produk: string; harga: number; foto_urls: string[] };

export default function AdminLiveScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("Live Shopping Diana Stuff");
  const [caption, setCaption] = useState("");
  const [showCart, setShowCart] = useState(true);
  const [requireLogin, setRequireLogin] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [featuredId, setFeaturedId] = useState<string | null>(null);

  const { data: live } = useQuery<LiveState>({
    queryKey: ["live", "current"],
    queryFn: getCurrentLive,
    refetchInterval: 8000,
  });
  const { data: products } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => apiRequest<Product[]>("/api/products", { auth: false }),
  });

  const isLive = !!live?.live;

  const startMut = useMutation({
    mutationFn: () => startLive({ title, caption, productIds: selected, showCart, requireLogin, featuredProductId: featuredId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "current"] });
      toast.show("Siaran live dimulai!", "success");
      router.push("/live-host");
    },
    onError: (e: any) => toast.show(e?.message || "Gagal memulai live", "error"),
  });

  const stopMut = useMutation({
    mutationFn: () => stopLive(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "current"] });
      queryClient.invalidateQueries({ queryKey: ["live", "history"] });
      toast.show("Siaran live diakhiri", "success");
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) {
        if (featuredId === id) setFeaturedId(null);
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });

  // ---- Already broadcasting: show a compact card to reopen the full-screen studio ----
  if (isLive) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
        <View style={styles.liveCard}>
          <View style={styles.liveBadge}><View style={styles.dot} /><Text style={styles.liveBadgeText}>SEDANG LIVE</Text></View>
          <Text style={styles.liveTitle} numberOfLines={2}>{live?.title}</Text>
          {live?.caption ? <Text style={styles.liveCaption}>{live.caption}</Text> : null}
        </View>
        <M3Button testID="open-studio" label="Buka Studio Live" icon="video-account" variant="filled" onPress={() => router.push("/live-host")} />
        <M3Button testID="rekap-live" label="Lihat Rekap Live" icon="chart-box-outline" variant="tonal" onPress={() => router.push("/dashboard/live-rekap")} />
        <M3Button testID="stop-live" label="Akhiri Siaran" icon="stop-circle-outline" variant="outlined" loading={stopMut.isPending} onPress={() => stopMut.mutate()} />
        <Text style={styles.hint}>Studio Live tampil layar penuh: kamera, ganti kamera depan/belakang, filter, komentar & moderasi. Kamera hanya aktif di aplikasi hasil build.</Text>
      </ScrollView>
    );
  }

  // ---- Setup (not live) ----
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      <View style={styles.setupHeadRow}>
        <Text style={styles.heading}>Mulai Live Shopping</Text>
        <Pressable testID="rekap-live-setup" style={styles.rekapLink} onPress={() => router.push("/dashboard/live-rekap")}>
          <MaterialDesignIcons name="chart-box-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.rekapLinkText}>Rekap Live</Text>
        </Pressable>
      </View>
      <M3TextField label="Judul Siaran" icon="format-title" value={title} onChangeText={setTitle} containerTestID="live-title" />
      <M3TextField label="Caption / Deskripsi (opsional)" icon="text" value={caption} onChangeText={setCaption} multiline containerTestID="live-caption" />

      <Pressable testID="toggle-cart" style={styles.toggleRow} onPress={() => setShowCart((v) => !v)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Tampilkan Keranjang Produk</Text>
          <Text style={styles.toggleSub}>Penonton bisa lihat & buka produk saat live</Text>
        </View>
        <MaterialDesignIcons name={showCart ? "toggle-switch" : "toggle-switch-off-outline"} size={40} color={showCart ? colors.brandPrimary : colors.muted} />
      </Pressable>

      <Pressable testID="toggle-login" style={styles.toggleRow} onPress={() => setRequireLogin((v) => !v)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Wajib Login untuk Menonton</Text>
          <Text style={styles.toggleSub}>{requireLogin ? "Hanya pengguna login bisa menonton" : "Tamu boleh menonton tanpa login"}</Text>
        </View>
        <MaterialDesignIcons name={requireLogin ? "toggle-switch" : "toggle-switch-off-outline"} size={40} color={requireLogin ? colors.brandPrimary : colors.muted} />
      </Pressable>

      <Text style={styles.label}>Pilih Produk Dipajang ({selected.length}) · ⭐ = disorot</Text>
      <View style={{ gap: 8 }}>
        {(products ?? []).map((p) => {
          const on = selected.includes(p.id);
          const isFeat = featuredId === p.id;
          const uri = resolveImageUrl(p.foto_urls?.[0] ?? null);
          return (
            <Pressable key={p.id} testID={`live-pick-${p.id}`} style={[styles.pick, on && styles.pickOn]} onPress={() => toggle(p.id)}>
              {uri ? <Image source={{ uri }} style={styles.pickImg} contentFit="cover" /> : <View style={styles.pickImg} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.pickName} numberOfLines={1}>{p.nama_produk}</Text>
                <Text style={styles.pickPrice}>{formatRupiah(p.harga)}</Text>
              </View>
              {on ? (
                <Pressable testID={`setup-feature-${p.id}`} hitSlop={8} onPress={() => setFeaturedId(isFeat ? null : p.id)} style={styles.starBtn}>
                  <MaterialDesignIcons name={isFeat ? "star" : "star-outline"} size={22} color={isFeat ? colors.warning : colors.muted} />
                </Pressable>
              ) : null}
              <MaterialDesignIcons name={on ? "check-circle" : "circle-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
            </Pressable>
          );
        })}
      </View>
      <M3Button testID="start-live" label="Mulai Siaran Live" icon="access-point" variant="filled" loading={startMut.isPending} onPress={() => startMut.mutate()} />
      <Text style={styles.hint}>Setelah mulai, Anda masuk ke Studio Live layar penuh. Siaran kamera hanya aktif di aplikasi hasil build (bukan Expo Go/web).</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  setupHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  rekapLink: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandTertiary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  rekapLinkText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, lineHeight: 18 },
  liveCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  liveBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  liveTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  liveCaption: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12 },
  toggleTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  toggleSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  pick: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 10, borderWidth: 1.5, borderColor: "transparent" },
  pickOn: { borderColor: colors.brandPrimary },
  pickImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  pickName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  pickPrice: { fontFamily: fonts.body, fontSize: 13, color: colors.brandPrimary, marginTop: 2 },
  starBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
}));
