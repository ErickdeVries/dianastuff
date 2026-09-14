import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import Slider from "@react-native-community/slider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { stopLive } from "@/src/api/live";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { FloatingEmoji } from "@/src/components/floating-emoji";
import { LiveVideo, LiveVideoHandle, LiveFilterId, LiveQuality } from "@/src/components/live-video";
import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/context/toast";
import { connectSocket } from "@/src/lib/socket";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

type LiveChatMsg = { id: string; uid?: string; name: string; role: string; text: string };
type Viewer = { name: string; role: string; uid: string; muted: boolean };

const FILTERS: { id: LiveFilterId; label: string; icon: string }[] = [
  { id: "none", label: "Normal", icon: "circle-off-outline" },
  { id: "halus", label: "Halus", icon: "face-woman-shimmer" },
  { id: "cerah", label: "Cerah", icon: "white-balance-sunny" },
  { id: "vivid", label: "Vivid", icon: "palette-outline" },
  { id: "jernih", label: "Jernih", icon: "blur-off" },
  { id: "lowlight", label: "Low Light", icon: "weather-night" },
];

const QUALITIES: { id: LiveQuality; label: string }[] = [
  { id: "HD", label: "HD" },
  { id: "normal", label: "Normal" },
  { id: "hemat", label: "Hemat Data" },
];

export default function LiveHostScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const videoRef = useRef<LiveVideoHandle>(null);

  const [chat, setChat] = useState<LiveChatMsg[]>([]);
  const [text, setText] = useState("");
  const [viewers, setViewers] = useState<{ count: number; list: Viewer[] }>({ count: 0, list: [] });
  const [viewersOpen, setViewersOpen] = useState(false);
  const [pinned, setPinned] = useState<{ name: string; role: string; text: string } | null>(null);
  const [floats, setFloats] = useState<{ key: string; emoji: string; offset: number }[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<LiveFilterId>("none");
  const [beautyLevel, setBeautyLevel] = useState(0.6);
  const [quality, setQuality] = useState<LiveQuality>("normal");
  const [actionMsg, setActionMsg] = useState<LiveChatMsg | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const chatRef = useRef<FlatList<LiveChatMsg>>(null);
  const showBeauty = activeFilter === "halus" || activeFilter === "cerah";

  useEffect(() => {
    let alive = true;
    let socket: any = null;
    const onChat = (m: LiveChatMsg) =>
      alive && setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-100)));
    const onViewers = (p: { count: number; viewers: Viewer[] }) =>
      alive && setViewers({ count: p?.count ?? 0, list: p?.viewers ?? [] });
    const onPinned = (p: { pinned: any }) => alive && setPinned(p?.pinned ?? null);
    const onReact = (r: { emoji: string }) =>
      alive &&
      setFloats((prev) =>
        [...prev, { key: `${Date.now()}-${Math.random()}`, emoji: r?.emoji || "❤️", offset: Math.random() * 40 }].slice(-24),
      );
    (async () => {
      socket = await connectSocket();
      if (!alive) return;
      socket.on("live_chat", onChat);
      socket.on("live_viewers", onViewers);
      socket.on("live_pinned", onPinned);
      socket.on("live_react", onReact);
    })();
    return () => {
      alive = false;
      if (socket) {
        socket.off("live_chat", onChat);
        socket.off("live_viewers", onViewers);
        socket.off("live_pinned", onPinned);
        socket.off("live_react", onReact);
      }
    };
  }, []);

  useEffect(() => {
    if (chat.length) setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat.length]);

  const stopMut = useMutation({
    mutationFn: () => stopLive(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "current"] });
      queryClient.invalidateQueries({ queryKey: ["live", "history"] });
      toast.show("Siaran live diakhiri", "success");
      router.replace("/dashboard/live-rekap");
    },
  });

  const sendComment = async () => {
    const t = text.trim();
    if (!t) return;
    const socket = await connectSocket();
    socket.emit("live_chat", { text: t });
    setText("");
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

  const pickFilter = (id: LiveFilterId) => {
    setActiveFilter(id);
    videoRef.current?.applyFilter(id, beautyLevel);
  };

  const onBeautyChange = (v: number) => {
    setBeautyLevel(v);
    if (activeFilter === "halus" || activeFilter === "cerah") {
      videoRef.current?.applyFilter(activeFilter, v);
    }
  };

  const pickQuality = (q: LiveQuality) => {
    setQuality(q);
    videoRef.current?.setQuality(q);
  };

  if (user?.role !== "admin") {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: "#fff", fontFamily: fonts.body }}>Hanya admin.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.videoWrap}>
      <LiveVideo ref={videoRef} role="host" style={styles.videoFill} />

      {/* Top overlay */}
      <View style={[styles.topRow, { top: insets.top + 16 }]}>
        <View style={styles.topLeft}>
          <View style={styles.liveBadge}><View style={styles.dot} /><Text style={styles.liveBadgeText}>LIVE</Text></View>
          <Pressable testID="host-viewers" style={styles.viewerPill} onPress={() => setViewersOpen(true)}>
            <MaterialDesignIcons name="eye" size={15} color="#fff" />
            <Text style={styles.viewerPillText}>{viewers.count}</Text>
          </Pressable>
        </View>
        <View style={styles.topBtns}>
          <Pressable testID="host-switch-cam" style={styles.roundBtn} onPress={() => videoRef.current?.switchCamera()}>
            <MaterialDesignIcons name="camera-flip-outline" size={20} color="#fff" />
          </Pressable>
          <Pressable testID="host-filter" style={[styles.roundBtn, filterOpen && styles.roundBtnOn]} onPress={() => setFilterOpen((v) => !v)}>
            <MaterialDesignIcons name="auto-fix" size={20} color="#fff" />
          </Pressable>
          <Pressable testID="host-share" style={styles.roundBtn} onPress={onShare}>
            <MaterialDesignIcons name="share-variant" size={18} color="#fff" />
          </Pressable>
          <Pressable testID="host-stop" style={[styles.roundBtn, styles.stopBtn]} onPress={() => setConfirmStop(true)}>
            <MaterialDesignIcons name="power" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Filter + quality + beauty panel */}
      {filterOpen ? (
        <View style={[styles.filterPanel, { top: insets.top + 64 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
            {FILTERS.map((f) => {
              const on = activeFilter === f.id;
              return (
                <Pressable key={f.id} testID={`filter-${f.id}`} style={[styles.filterChip, on && styles.filterChipOn]} onPress={() => pickFilter(f.id)}>
                  <MaterialDesignIcons name={f.icon as any} size={18} color="#fff" />
                  <Text style={styles.filterText}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.qualityRow}>
            <MaterialDesignIcons name="quality-high" size={16} color="#fff" />
            {QUALITIES.map((q) => (
              <Pressable key={q.id} testID={`quality-${q.id}`} style={[styles.qChip, quality === q.id && styles.qChipOn]} onPress={() => pickQuality(q.id)}>
                <Text style={styles.qText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>

          {showBeauty ? (
            <View style={styles.beautyRow}>
              <MaterialDesignIcons name="star-four-points-outline" size={16} color="#fff" />
              <Text style={styles.beautyLabel}>Beauty</Text>
              <Slider
                testID="beauty-slider"
                style={{ flex: 1, height: 36 }}
                minimumValue={0}
                maximumValue={1}
                value={beautyLevel}
                onValueChange={onBeautyChange}
                minimumTrackTintColor={colors.brandPrimary}
                maximumTrackTintColor="rgba(255,255,255,0.3)"
                thumbTintColor="#fff"
              />
              <Text style={styles.beautyVal}>{Math.round(beautyLevel * 100)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Pinned banner */}
      {pinned ? (
        <View style={[styles.pinnedBanner, { top: insets.top + (filterOpen ? (showBeauty ? 220 : 172) : 64) }]}>
          <MaterialDesignIcons name="pin" size={14} color="#fff" />
          <Text style={styles.pinnedText} numberOfLines={2}>
            <Text style={styles.pinnedName}>{pinned.name}: </Text>{pinned.text}
          </Text>
          <Pressable testID="host-unpin" onPress={doUnpin} hitSlop={8}>
            <MaterialDesignIcons name="close" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* Chat overlay */}
      <View style={[styles.chatOverlay, { bottom: Math.max(insets.bottom, 8) + 8 }]} pointerEvents="box-none">
        <FlatList
          ref={chatRef}
          data={chat}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <Pressable
              testID={`host-msg-${item.id}`}
              style={styles.chatBubble}
              onPress={() => item.role !== "admin" && setActionMsg(item)}
            >
              <Text style={styles.chatName}>
                {item.role === "admin" ? "👑 " : ""}{item.name}:{" "}
                <Text style={styles.chatText}>{item.text}</Text>
              </Text>
            </Pressable>
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 4, paddingTop: 8 }}
        />
      </View>

      {/* Floating reactions */}
      {floats.map((f) => (
        <FloatingEmoji key={f.key} emoji={f.emoji} offset={f.offset} onDone={() => setFloats((prev) => prev.filter((x) => x.key !== f.key))} />
      ))}
      </View>

      {/* Comment input */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <TextInput
            testID="host-chat-input"
            style={styles.input}
            placeholder="Balas komentar..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendComment}
            returnKeyType="send"
          />
          <Pressable testID="host-chat-send" style={styles.sendBtn} onPress={sendComment}>
            <MaterialDesignIcons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
      </KeyboardStickyView>

      {/* Viewers modal */}
      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={() => setViewersOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setViewersOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Penonton ({viewers.count})</Text>
              <Pressable testID="viewers-close" onPress={() => setViewersOpen(false)} hitSlop={10}>
                <MaterialDesignIcons name="close" size={22} color="#fff" />
              </Pressable>
            </View>
            {viewers.list.length ? (
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                {viewers.list.map((v, i) => (
                  <View key={`${v.uid}-${i}`} style={styles.viewerRow}>
                    <MaterialDesignIcons name={v.role === "guest" ? "account-outline" : "account-circle"} size={22} color="rgba(255,255,255,0.8)" />
                    <Text style={styles.viewerName} numberOfLines={1}>{v.role === "admin" ? "👑 " : ""}{v.name}</Text>
                    {v.role !== "admin" ? (
                      <>
                        <Pressable testID={`mute-${v.uid}`} style={styles.modBtn} onPress={() => doMute(v.uid, !v.muted)}>
                          <MaterialDesignIcons name={v.muted ? "microphone-off" : "microphone"} size={18} color={v.muted ? "#ff8a8a" : "rgba(255,255,255,0.8)"} />
                        </Pressable>
                        <Pressable testID={`kick-${v.uid}`} style={styles.modBtn} onPress={() => doKick(v.uid)}>
                          <MaterialDesignIcons name="account-cancel-outline" size={18} color="#ff8a8a" />
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

      {/* Comment action sheet */}
      <Modal visible={!!actionMsg} transparent animationType="fade" onRequestClose={() => setActionMsg(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionMsg(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{actionMsg?.name}: {actionMsg?.text}</Text>
            <Pressable testID="action-pin" style={styles.sheetItem} onPress={() => { if (actionMsg) doPin(actionMsg); setActionMsg(null); }}>
              <MaterialDesignIcons name="pin" size={20} color="#fff" />
              <Text style={styles.sheetText}>Sematkan komentar</Text>
            </Pressable>
            <Pressable testID="action-mute" style={styles.sheetItem} onPress={() => { if (actionMsg?.uid) doMute(actionMsg.uid, true); setActionMsg(null); }}>
              <MaterialDesignIcons name="microphone-off" size={20} color="#fff" />
              <Text style={styles.sheetText}>Bisukan penonton</Text>
            </Pressable>
            <Pressable testID="action-kick" style={styles.sheetItem} onPress={() => { if (actionMsg?.uid) doKick(actionMsg.uid); setActionMsg(null); }}>
              <MaterialDesignIcons name="account-cancel-outline" size={20} color="#ff8a8a" />
              <Text style={[styles.sheetText, { color: "#ff8a8a" }]}>Keluarkan penonton</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={confirmStop}
        title="Akhiri Siaran?"
        message="Siaran live akan dihentikan untuk semua penonton."
        confirmLabel="Akhiri"
        onConfirm={() => { setConfirmStop(false); stopMut.mutate(); }}
        onCancel={() => setConfirmStop(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: "#000" },
  videoWrap: { flex: 1, position: "relative", overflow: "hidden", backgroundColor: "#000" },
  videoFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

  topRow: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  viewerPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  viewerPillText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  topBtns: { flexDirection: "row", gap: 8 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  roundBtnOn: { backgroundColor: colors.brandPrimary },
  stopBtn: { backgroundColor: colors.error },

  filterRow: { position: "absolute", left: 8, right: 8 },
  filterPanel: { position: "absolute", left: 8, right: 8, gap: 8, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 16, paddingVertical: 8 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: "transparent" },
  filterChipOn: { borderColor: "#fff", backgroundColor: "rgba(168,85,247,0.7)" },
  filterText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  qChip: { backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: "transparent" },
  qChipOn: { borderColor: "#fff", backgroundColor: "rgba(168,85,247,0.7)" },
  qText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  beautyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  beautyLabel: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  beautyVal: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12, width: 26, textAlign: "right" },

  pinnedBanner: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "rgba(168,85,247,0.85)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  pinnedText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: "#fff" },
  pinnedName: { fontFamily: fonts.bodyMedium, color: "#fff" },

  chatOverlay: { position: "absolute", left: 12, right: 64, bottom: 12, maxHeight: 240 },
  chatBubble: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" },
  chatName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#FFD9F3" },
  chatText: { fontFamily: fonts.body, fontSize: 13, color: "#fff" },

  inputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: "rgba(0,0,0,0.55)" },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: "#fff", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#1c1c1e", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: fonts.heading, fontSize: 18, color: "#fff" },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  viewerName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: "#fff" },
  modBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  viewerEmpty: { fontFamily: fonts.body, fontSize: 14, color: "rgba(255,255,255,0.6)", paddingVertical: 20, textAlign: "center" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#1c1c1e", borderRadius: 18, padding: 8 },
  sheetTitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "rgba(255,255,255,0.7)", padding: 12 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12 },
  sheetText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: "#fff" },
}));
