import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { LiveVideo } from "@/src/components/live-video";
import { getCurrentLive, LiveState, startLive, stopLive } from "@/src/api/live";
import { connectSocket } from "@/src/lib/socket";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

type Product = { id: string; nama_produk: string; harga: number; foto_urls: string[] };

export default function AdminLiveScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("Live Shopping Diana Stuff");
  const [caption, setCaption] = useState("");
  const [showCart, setShowCart] = useState(true);
  const [requireLogin, setRequireLogin] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewers, setViewers] = useState<{ count: number; list: { name: string; role: string }[] }>({ count: 0, list: [] });
  const [viewersOpen, setViewersOpen] = useState(false);

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

  useEffect(() => {
    if (isLive && live?.products) setSelected(live.products.map((p) => p.id));
  }, [isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for realtime viewer presence while broadcasting.
  useEffect(() => {
    if (!isLive) {
      setViewers({ count: 0, list: [] });
      return;
    }
    let alive = true;
    let socket: any = null;
    const onViewers = (p: { count: number; viewers: { name: string; role: string }[] }) =>
      alive && setViewers({ count: p?.count ?? 0, list: p?.viewers ?? [] });
    (async () => {
      socket = await connectSocket();
      if (!alive) return;
      socket.on("live_viewers", onViewers);
    })();
    return () => {
      alive = false;
      if (socket) socket.off("live_viewers", onViewers);
    };
  }, [isLive]);

  const startMut = useMutation({
    mutationFn: () => startLive({ title, caption, productIds: selected, showCart, requireLogin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "current"] });
      toast.show("Siaran live dimulai!", "success");
    },
    onError: (e: any) => toast.show(e?.message || "Gagal memulai live", "error"),
  });

  const stopMut = useMutation({
    mutationFn: () => stopLive(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "current"] });
      toast.show("Siaran live diakhiri", "success");
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onShare = async () => {
    const link = `${BASE}/live`;
    const msg = `🔴 LIVE sekarang di Diana Stuff! Nonton & belanja: ${link}`;
    try {
      await Share.share({ message: msg });
    } catch {
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      {isLive ? (
        <>
          <View style={styles.videoWrap}>
            <LiveVideo role="host" style={{ flex: 1 }} />
            <View style={styles.liveBadge}><View style={styles.dot} /><Text style={styles.liveBadgeText}>LIVE</Text></View>
            <Pressable testID="viewer-count" style={styles.eyeBtn} onPress={() => setViewersOpen(true)}>
              <MaterialDesignIcons name="eye" size={18} color="#fff" />
              <Text style={styles.eyeText}>{viewers.count}</Text>
            </Pressable>
          </View>
          <Text style={styles.heading} numberOfLines={2}>{live?.title}</Text>
          {live?.caption ? <Text style={styles.captionText}>{live.caption}</Text> : null}
          <View style={styles.liveMetaRow}>
            <MaterialDesignIcons name={live?.show_cart ? "cart" : "cart-off"} size={16} color={colors.brandPrimary} />
            <Text style={styles.liveMeta}>{live?.show_cart ? "Keranjang tampil" : "Tanpa keranjang"}</Text>
            <MaterialDesignIcons name={live?.require_login ? "lock" : "lock-open-variant"} size={16} color={colors.brandPrimary} />
            <Text style={styles.liveMeta}>{live?.require_login ? "Wajib login" : "Tamu boleh nonton"}</Text>
          </View>
          <M3Button testID="share-live" label="Bagikan Link Live via WhatsApp" icon="whatsapp" variant="tonal" onPress={onShare} />
          <M3Button testID="stop-live" label="Akhiri Siaran" icon="stop-circle-outline" variant="filled" loading={stopMut.isPending} onPress={() => stopMut.mutate()} />
          <Text style={styles.hint}>Penonton dapat menonton lewat link. Kamera hanya aktif di aplikasi hasil build.</Text>
        </>
      ) : (
        <>
          <Text style={styles.heading}>Mulai Live Shopping</Text>
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

          <Text style={styles.label}>Pilih Produk Dipajang ({selected.length})</Text>
          <View style={{ gap: 8 }}>
            {(products ?? []).map((p) => {
              const on = selected.includes(p.id);
              const uri = resolveImageUrl(p.foto_urls?.[0] ?? null);
              return (
                <Pressable key={p.id} testID={`live-pick-${p.id}`} style={[styles.pick, on && styles.pickOn]} onPress={() => toggle(p.id)}>
                  {uri ? <Image source={{ uri }} style={styles.pickImg} contentFit="cover" /> : <View style={styles.pickImg} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName} numberOfLines={1}>{p.nama_produk}</Text>
                    <Text style={styles.pickPrice}>{formatRupiah(p.harga)}</Text>
                  </View>
                  <MaterialDesignIcons name={on ? "check-circle" : "circle-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
                </Pressable>
              );
            })}
          </View>
          <M3Button testID="start-live" label="Mulai Siaran Live" icon="access-point" variant="filled" loading={startMut.isPending} onPress={() => startMut.mutate()} />
          <Text style={styles.hint}>Setelah mulai, bagikan link ke pelanggan. Siaran kamera hanya aktif di aplikasi hasil build (bukan Expo Go/web).</Text>
        </>
      )}

      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={() => setViewersOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setViewersOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Penonton ({viewers.count})</Text>
              <Pressable testID="viewers-close" onPress={() => setViewersOpen(false)} hitSlop={10}>
                <MaterialDesignIcons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            {viewers.list.length ? (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                {viewers.list.map((v, i) => (
                  <View key={`${v.name}-${i}`} style={styles.viewerRow}>
                    <MaterialDesignIcons
                      name={v.role === "guest" ? "account-outline" : "account-circle"}
                      size={22}
                      color={v.role === "admin" ? colors.brandPrimary : colors.onSurfaceTertiary}
                    />
                    <Text style={styles.viewerName}>{v.role === "admin" ? "👑 " : ""}{v.name}</Text>
                    {v.role === "guest" ? <Text style={styles.viewerTag}>Tamu</Text> : null}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.viewerEmpty}>Belum ada penonton.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  heading: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  captionText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  liveMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  liveMeta: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceTertiary, marginRight: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12 },
  toggleTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  toggleSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, lineHeight: 18 },
  videoWrap: { height: 360, backgroundColor: "#000", borderRadius: 18, overflow: "hidden" },
  liveBadge: { position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  eyeBtn: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  eyeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  viewerName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  viewerTag: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  viewerEmpty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, paddingVertical: 20, textAlign: "center" },
  pick: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 10, borderWidth: 1.5, borderColor: "transparent" },
  pickOn: { borderColor: colors.brandPrimary },
  pickImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  pickName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  pickPrice: { fontFamily: fonts.body, fontSize: 13, color: colors.brandPrimary, marginTop: 2 },
}));
