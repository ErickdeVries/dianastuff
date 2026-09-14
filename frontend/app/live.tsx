import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCurrentLive, LiveProduct, LiveState } from "@/src/api/live";
import { FloatingEmoji } from "@/src/components/floating-emoji";
import { LiveVideo } from "@/src/components/live-video";
import { useAuth } from "@/src/context/auth";
import { connectSocket } from "@/src/lib/socket";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const REACTIONS = ["❤️", "🔥", "😍", "👍", "👏", "😮"];

type LiveChatMsg = { id: string; name: string; role: string; text: string; ts?: string };

function waLink(no: string): string {
  let d = (no || "").replace(/\D/g, "");
  if (d.startsWith("620")) d = `62${d.slice(3)}`;
  else if (d.startsWith("0")) d = `62${d.slice(1)}`;
  return `https://wa.me/${d}`;
}

export default function LiveViewerScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<LiveState>({
    queryKey: ["live", "current"],
    queryFn: getCurrentLive,
    refetchInterval: 8000,
  });

  const [chat, setChat] = useState<LiveChatMsg[]>([]);
  const [text, setText] = useState("");
  const [floats, setFloats] = useState<{ key: string; emoji: string; offset: number }[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const chatRef = useRef<FlatList<LiveChatMsg>>(null);

  const gated = !!data?.require_login && !user;
  const active = !!data?.live && !gated;

  // Realtime: join the live room, receive chat + reactions.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let socket: any = null;
    const join = () => socket?.emit("join_live", {});
    const onHistory = (msgs: LiveChatMsg[]) => alive && setChat(Array.isArray(msgs) ? msgs : []);
    const onChat = (m: LiveChatMsg) =>
      alive && setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-80)));
    const onReact = (r: { emoji: string }) =>
      alive &&
      setFloats((prev) =>
        [...prev, { key: `${Date.now()}-${Math.random()}`, emoji: r?.emoji || "❤️", offset: Math.random() * 40 }].slice(-24),
      );
    const onViewers = (p: { count: number }) => alive && setViewerCount(p?.count ?? 0);

    (async () => {
      socket = await connectSocket();
      if (!alive) return;
      if (socket.connected) join();
      socket.on("connect", join);
      socket.on("live_chat_history", onHistory);
      socket.on("live_chat", onChat);
      socket.on("live_react", onReact);
      socket.on("live_viewers", onViewers);
    })();

    return () => {
      alive = false;
      if (socket) {
        socket.emit("leave_live", {});
        socket.off("connect", join);
        socket.off("live_chat_history", onHistory);
        socket.off("live_chat", onChat);
        socket.off("live_react", onReact);
        socket.off("live_viewers", onViewers);
      }
    };
  }, [active]);

  useEffect(() => {
    if (chat.length) setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat.length]);

  const sendChat = async () => {
    const t = text.trim();
    if (!t) return;
    const socket = await connectSocket();
    socket.emit("live_chat", { text: t, name: user?.nama || undefined });
    setText("");
  };

  const sendReaction = async (emoji: string) => {
    const socket = await connectSocket();
    socket.emit("live_react", { emoji });
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

  const openWa = () => {
    if (data?.whatsapp) Linking.openURL(waLink(data.whatsapp));
  };

  // No live running.
  if (!isLoading && !data?.live) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialDesignIcons name="video-off-outline" size={56} color={colors.muted} />
        <Text style={styles.offTitle}>Belum ada siaran live</Text>
        <Text style={styles.offSub}>Nantikan jadwal live Diana Stuff berikutnya ya!</Text>
        <Pressable style={styles.backToShop} onPress={() => router.replace("/toko")}>
          <Text style={styles.backToShopText}>Ke Etalase</Text>
        </Pressable>
      </View>
    );
  }

  // Live but login required.
  if (gated) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialDesignIcons name="lock-outline" size={56} color={colors.brandPrimary} />
        <Text style={styles.offTitle}>Login untuk menonton</Text>
        <Text style={styles.offSub}>Siaran ini khusus untuk pengguna terdaftar.</Text>
        <Pressable testID="live-login" style={styles.backToShop} onPress={() => router.push("/login")}>
          <Text style={styles.backToShopText}>Masuk / Daftar</Text>
        </Pressable>
      </View>
    );
  }

  const products = data?.show_cart ? data?.products ?? [] : [];

  const renderProduct = ({ item }: { item: LiveProduct }) => {
    const uri = resolveImageUrl(item.foto_urls?.[0] ?? null);
    return (
      <Pressable
        testID={`live-product-${item.id}`}
        style={styles.pCard}
        onPress={() => router.push({ pathname: "/produk/[id]", params: { id: item.id } })}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.pImg} contentFit="cover" />
        ) : (
          <View style={[styles.pImg, styles.pImgEmpty]}>
            <MaterialDesignIcons name="image-off-outline" size={20} color="#fff" />
          </View>
        )}
        <Text style={styles.pName} numberOfLines={1}>{item.nama_produk}</Text>
        <Text style={styles.pPrice}>{formatRupiah(item.harga)}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.videoWrap}>
        <LiveVideo role="audience" style={styles.videoFill} />

        {/* Top overlay */}
        <View style={[styles.topRow, { top: insets.top + 8 }]}>
          <View style={styles.topLeft}>
            <View style={styles.liveBadge}>
              <View style={styles.dot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
            <View style={styles.viewerPill}>
              <MaterialDesignIcons name="eye" size={15} color="#fff" />
              <Text style={styles.viewerPillText}>{viewerCount}</Text>
            </View>
          </View>
          <View style={styles.topBtns}>
            {data?.whatsapp ? (
              <Pressable testID="live-wa" style={styles.roundBtn} onPress={openWa}>
                <MaterialDesignIcons name="whatsapp" size={20} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable testID="live-share" style={styles.roundBtn} onPress={onShare}>
              <MaterialDesignIcons name="share-variant" size={19} color="#fff" />
            </Pressable>
            <Pressable testID="live-close" style={styles.roundBtn} onPress={() => router.replace("/toko")}>
              <MaterialDesignIcons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Title + caption */}
        <View style={[styles.titleWrap, { top: insets.top + 52 }]} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>{data?.title ?? "Live Shopping"}</Text>
          {data?.caption ? <Text style={styles.caption} numberOfLines={2}>{data.caption}</Text> : null}
        </View>

        {/* Reaction rail */}
        <View style={styles.reactRail}>
          {REACTIONS.map((e) => (
            <Pressable key={e} testID={`live-react-${e}`} style={styles.reactBtn} onPress={() => sendReaction(e)}>
              <Text style={styles.reactEmoji}>{e}</Text>
            </Pressable>
          ))}
          <Pressable testID="live-like" style={styles.likeBtn} onPress={() => sendReaction("❤️")}>
            <MaterialDesignIcons name="heart" size={26} color="#fff" />
          </Pressable>
        </View>

        {/* Chat overlay */}
        <View style={styles.chatOverlay} pointerEvents="box-none">
          <FlatList
            ref={chatRef}
            data={chat}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <View style={styles.chatBubble}>
                <Text style={styles.chatName}>
                  {item.role === "admin" ? "👑 " : ""}{item.name}:{" "}
                  <Text style={styles.chatText}>{item.text}</Text>
                </Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 4, paddingTop: 8 }}
          />
        </View>

        {/* Floating reactions */}
        {floats.map((f) => (
          <FloatingEmoji
            key={f.key}
            emoji={f.emoji}
            offset={f.offset}
            onDone={() => setFloats((prev) => prev.filter((x) => x.key !== f.key))}
          />
        ))}
      </View>

      {/* Product strip */}
      {data?.show_cart && products.length ? (
        <View style={styles.strip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 12 }}>
            {products.map((p) => (
              <View key={p.id}>{renderProduct({ item: p })}</View>
            ))}
          </ScrollView>
          <Pressable testID="live-cart" style={styles.cartFab} onPress={() => router.push("/toko")}>
            <MaterialDesignIcons name="storefront-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* Chat input */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            testID="live-chat-input"
            style={styles.input}
            placeholder="Tulis komentar..."
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendChat}
            returnKeyType="send"
          />
          <Pressable testID="live-chat-send" style={styles.sendBtn} onPress={sendChat}>
            <MaterialDesignIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: colors.surface },
  offTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface, marginTop: 8 },
  offSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center" },
  backToShop: { marginTop: 16, backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  backToShopText: { fontFamily: fonts.bodyMedium, color: colors.onBrandPrimary, fontSize: 15 },

  videoWrap: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  videoFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

  topRow: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  viewerPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  viewerPillText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },
  topBtns: { flexDirection: "row", gap: 8 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 12 },

  titleWrap: { position: "absolute", left: 12, right: 90 },
  title: { fontFamily: fonts.heading, fontSize: 16, color: "#fff", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  caption: { fontFamily: fonts.body, fontSize: 12, color: "rgba(255,255,255,0.9)", marginTop: 2, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },

  reactRail: { position: "absolute", right: 12, bottom: 16, alignItems: "center", gap: 10 },
  reactBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  reactEmoji: { fontSize: 20 },
  likeBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },

  chatOverlay: { position: "absolute", left: 12, right: 72, bottom: 12, maxHeight: 190 },
  chatBubble: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" },
  chatName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#FFD9F3" },
  chatText: { fontFamily: fonts.body, fontSize: 13, color: "#fff" },

  strip: { backgroundColor: colors.surface, paddingVertical: 10, flexDirection: "row", alignItems: "center" },
  pCard: { width: 120, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 8 },
  pImg: { width: "100%", height: 80, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  pImgEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  pName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurface, marginTop: 6 },
  pPrice: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary, marginTop: 2 },
  cartFab: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginHorizontal: 12 },

  inputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
}));
