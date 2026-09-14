import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { LiveVideo } from "@/src/components/live-video";
import { getCurrentLive, LiveState, setFeatured, startLive, stopLive } from "@/src/api/live";
import { connectSocket } from "@/src/lib/socket";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

type Product = { id: string; nama_produk: string; harga: number; foto_urls: string[] };
type LiveChatMsg = { id: string; uid?: string; name: string; role: string; text: string };

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
  const [viewers, setViewers] = useState<{ count: number; list: { name: string; role: string; uid: string; muted: boolean }[] }>({ count: 0, list: [] });
  const [viewersOpen, setViewersOpen] = useState(false);
  const [chat, setChat] = useState<LiveChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pinned, setPinned] = useState<{ name: string; role: string; text: string } | null>(null);
  const chatRef = useRef<FlatList<LiveChatMsg>>(null);

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
  const liveFeaturedId = live?.featured?.id ?? null;

  useEffect(() => {
    if (isLive && live?.products) setSelected(live.products.map((p) => p.id));
  }, [isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: viewers, chat, pinned (admin is in the "admins" room, no join_live needed).
  useEffect(() => {
    if (!isLive) {
      setViewers({ count: 0, list: [] });
      setChat([]);
      setPinned(null);
      return;
    }
    let alive = true;
    let socket: any = null;
    const onViewers = (p: { count: number; viewers: any[] }) =>
      alive && setViewers({ count: p?.count ?? 0, list: p?.viewers ?? [] });
    const onChat = (m: LiveChatMsg) =>
      alive && setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-100)));
    const onPinned = (p: { pinned: any }) => alive && setPinned(p?.pinned ?? null);
    (async () => {
      socket = await connectSocket();
      if (!alive) return;
      socket.on("live_viewers", onViewers);
      socket.on("live_chat", onChat);
      socket.on("live_pinned", onPinned);
    })();
    return () => {
      alive = false;
      if (socket) {
        socket.off("live_viewers", onViewers);
        socket.off("live_chat", onChat);
        socket.off("live_pinned", onPinned);
      }
    };
  }, [isLive]);

  useEffect(() => {
    if (chat.length) setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat.length]);

  const startMut = useMutation({
    mutationFn: () => startLive({ title, caption, productIds: selected, showCart, requireLogin, featuredProductId: featuredId }),
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

  const featureMut = useMutation({
    mutationFn: (pid: string | null) => setFeatured(pid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live", "current"] }),
    onError: (e: any) => toast.show(e?.message || "Gagal menyorot produk", "error"),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) {
        if (featuredId === id) setFeaturedId(null);
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });

  const sendComment = async () => {
    const t = chatInput.trim();
    if (!t) return;
    const socket = await connectSocket();
    socket.emit("live_chat", { text: t });
    setChatInput("");
  };

  const doPin = async (m: LiveChatMsg) => {
    const socket = await connectSocket();
    socket.emit("pin_comment", { message: m });
    toast.show("Komentar disematkan", "success");
  };
  const doUnpin = async () => {
    const socket = await connectSocket();
    socket.emit("unpin_comment", {});
  };
  const doMute = async (uid: string, mute: boolean) => {
    if (!uid) return;
    const socket = await connectSocket();
    socket.emit("mod_mute", { uid, mute });
    toast.show(mute ? "Penonton dibisukan" : "Bisukan dibuka", "info");
  };
  const doKick = async (uid: string) => {
    if (!uid) return;
    const socket = await connectSocket();
    socket.emit("mod_kick", { uid });
    toast.show("Penonton dikeluarkan", "info");
  };

  const onShare = async () => {
    const link = `${BASE}/live`;
    const msg = `🔴 LIVE sekarang di Diana Stuff! Nonton & belanja: ${link}`;
    try {
      await Share.share({ message: msg });
    } catch {
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    }
  };

  const viewersModal = (
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
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {viewers.list.map((v, i) => (
                <View key={`${v.uid}-${i}`} style={styles.viewerRow}>
                  <MaterialDesignIcons
                    name={v.role === "guest" ? "account-outline" : "account-circle"}
                    size={22}
                    color={v.role === "admin" ? colors.brandPrimary : colors.onSurfaceTertiary}
                  />
                  <Text style={styles.viewerName} numberOfLines={1}>{v.role === "admin" ? "👑 " : ""}{v.name}</Text>
                  {v.role !== "admin" ? (
                    <>
                      <Pressable testID={`mute-${v.uid}`} style={styles.modBtn} onPress={() => doMute(v.uid, !v.muted)}>
                        <MaterialDesignIcons name={v.muted ? "microphone-off" : "microphone"} size={18} color={v.muted ? colors.error : colors.onSurfaceTertiary} />
                      </Pressable>
                      <Pressable testID={`kick-${v.uid}`} style={styles.modBtn} onPress={() => doKick(v.uid)}>
                        <MaterialDesignIcons name="account-cancel-outline" size={18} color={colors.error} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.viewerEmpty}>Belum ada penonton.</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  // ---- LIVE (broadcasting) view ----
  if (isLive) {
    return (
      <View style={styles.root}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={styles.videoWrapLive}>
            <LiveVideo role="host" style={{ flex: 1 }} />
            <View style={styles.liveBadge}><View style={styles.dot} /><Text style={styles.liveBadgeText}>LIVE</Text></View>
            <Pressable testID="viewer-count" style={styles.eyeBtn} onPress={() => setViewersOpen(true)}>
              <MaterialDesignIcons name="eye" size={18} color="#fff" />
              <Text style={styles.eyeText}>{viewers.count}</Text>
            </Pressable>
          </View>

          {/* Featured product selector */}
          {live?.products?.length ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Sorot Produk (tampil "Beli Sekarang" ke penonton)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <Pressable testID="feature-none" style={[styles.featChip, !liveFeaturedId && styles.featChipOn]} onPress={() => featureMut.mutate(null)}>
                  <Text style={[styles.featChipText, !liveFeaturedId && styles.featChipTextOn]}>Tidak ada</Text>
                </Pressable>
                {live.products.map((p) => {
                  const on = liveFeaturedId === p.id;
                  return (
                    <Pressable key={p.id} testID={`feature-${p.id}`} style={[styles.featChip, on && styles.featChipOn]} onPress={() => featureMut.mutate(p.id)}>
                      <MaterialDesignIcons name={on ? "star" : "star-outline"} size={16} color={on ? colors.onBrandPrimary : colors.brandPrimary} />
                      <Text style={[styles.featChipText, on && styles.featChipTextOn]} numberOfLines={1}>{p.nama_produk}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {pinned ? (
            <View style={styles.pinnedBar}>
              <MaterialDesignIcons name="pin" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.pinnedText} numberOfLines={2}><Text style={{ fontFamily: fonts.bodyMedium }}>{pinned.name}: </Text>{pinned.text}</Text>
              <Pressable testID="unpin" onPress={doUnpin} hitSlop={8}><MaterialDesignIcons name="close" size={16} color={colors.onBrandPrimary} /></Pressable>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable testID="share-live" style={styles.actBtn} onPress={onShare}>
              <MaterialDesignIcons name="whatsapp" size={18} color={colors.brandPrimary} />
              <Text style={styles.actText}>Bagikan</Text>
            </Pressable>
            <Pressable testID="rekap-live" style={styles.actBtn} onPress={() => router.push("/dashboard/live-rekap")}>
              <MaterialDesignIcons name="chart-box-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.actText}>Rekap</Text>
            </Pressable>
            <Pressable testID="stop-live" style={[styles.actBtn, styles.stopBtn]} onPress={() => stopMut.mutate()} disabled={stopMut.isPending}>
              <MaterialDesignIcons name="stop-circle-outline" size={18} color={colors.onError} />
              <Text style={[styles.actText, { color: colors.onError }]}>Akhiri</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Komentar Live</Text>
        </View>

        <FlatList
          ref={chatRef}
          data={chat}
          keyExtractor={(m) => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
          renderItem={({ item }) => (
            <View style={styles.msgRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.msgName}>{item.role === "admin" ? "👑 " : ""}{item.name}</Text>
                <Text style={styles.msgText}>{item.text}</Text>
              </View>
              {item.role !== "admin" ? (
                <View style={styles.msgActions}>
                  <Pressable testID={`pin-${item.id}`} style={styles.msgActBtn} onPress={() => doPin(item)}>
                    <MaterialDesignIcons name="pin-outline" size={18} color={colors.brandPrimary} />
                  </Pressable>
                  <Pressable testID={`msg-mute-${item.id}`} style={styles.msgActBtn} onPress={() => item.uid && doMute(item.uid, true)}>
                    <MaterialDesignIcons name="microphone-off" size={18} color={colors.onSurfaceTertiary} />
                  </Pressable>
                  <Pressable testID={`msg-kick-${item.id}`} style={styles.msgActBtn} onPress={() => item.uid && doKick(item.uid)}>
                    <MaterialDesignIcons name="account-cancel-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.viewerEmpty}>Belum ada komentar.</Text>}
        />

        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              testID="admin-chat-input"
              style={styles.input}
              placeholder="Balas komentar..."
              placeholderTextColor={colors.muted}
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendComment}
              returnKeyType="send"
            />
            <Pressable testID="admin-chat-send" style={styles.sendBtn} onPress={sendComment}>
              <MaterialDesignIcons name="send" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </KeyboardStickyView>

        {viewersModal}
      </View>
    );
  }

  // ---- Setup (not live) view ----
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
      <Text style={styles.hint}>Setelah mulai, bagikan link ke pelanggan. Siaran kamera hanya aktif di aplikasi hasil build (bukan Expo Go/web).</Text>
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
  videoWrapLive: { height: 240, backgroundColor: "#000", borderRadius: 18, overflow: "hidden" },
  liveBadge: { position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  eyeBtn: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  eyeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 13 },
  featChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 180 },
  featChipOn: { backgroundColor: colors.brandPrimary },
  featChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurface },
  featChipTextOn: { color: colors.onBrandPrimary },
  pinnedBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  pinnedText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.onBrandPrimary },
  actionRow: { flexDirection: "row", gap: 8 },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingVertical: 12 },
  actText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  stopBtn: { backgroundColor: colors.error },
  msgRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  msgName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  msgText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurface },
  msgActions: { flexDirection: "row", gap: 2 },
  msgActBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12 },
  toggleTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  toggleSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  pick: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 10, borderWidth: 1.5, borderColor: "transparent" },
  pickOn: { borderColor: colors.brandPrimary },
  pickImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  pickName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  pickPrice: { fontFamily: fonts.body, fontSize: 13, color: colors.brandPrimary, marginTop: 2 },
  starBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  viewerName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  modBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  viewerEmpty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, paddingVertical: 20, textAlign: "center" },
}));
