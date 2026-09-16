import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCurrentLive, LiveFeedMsg, LiveProduct, LiveState, sendLiveChat, sendLiveReaction } from "@/src/api/live";
import { FloatingEmoji } from "@/src/components/floating-emoji";
import { LiveVideo } from "@/src/components/live-video";
import { useAuth } from "@/src/context/auth";
import { useLivePoll } from "@/src/hooks/useLivePoll";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { PUBLIC_WEB_URL } from "@/src/utils/links";
import { getGuestName, setGuestName } from "@/src/utils/viewer-id";

const REACTIONS = ["❤️", "🔥", "😍", "👍", "👏", "😮"];

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

  const [text, setText] = useState("");
  const [guestName, setGuestNameState] = useState<string | null>(null);
  const [nameLoaded, setNameLoaded] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const chatRef = useRef<FlatList<LiveFeedMsg>>(null);

  // Guests must pick a display name before joining (no login required).
  useEffect(() => {
    if (user) {
      setNameLoaded(true);
      return;
    }
    let alive = true;
    getGuestName().then((n) => {
      if (alive) {
        setGuestNameState(n);
        setNameLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [user]);

  const gated = !!data?.require_login && !user;
  const active = !!data?.live && !gated;
  const needsName = !user && !guestName;
  const myName = user?.nama || guestName || undefined;

  const {
    chat,
    floats,
    removeFloat,
    addFloat,
    viewers,
    pinned,
    muted,
    kicked,
    featured: featuredLive,
    getVid,
  } = useLivePoll({ enabled: active && !needsName, registerPresence: true, name: myName });

  const viewerCount = viewers.count;
  const featured = featuredLive !== undefined ? featuredLive : data?.featured ?? null;

  useEffect(() => {
    if (chat.length) setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat.length]);

  const submitName = async () => {
    const n = nameInput.trim().slice(0, 24);
    if (!n) return;
    await setGuestName(n);
    setGuestNameState(n);
  };

  const sendChat = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    const vid = await getVid();
    sendLiveChat({ viewerId: vid, name: myName, text: t }).catch(() => {});
  };

  const sendReaction = async (emoji: string) => {
    addFloat(emoji);
    const vid = await getVid();
    sendLiveReaction({ viewerId: vid, emoji }).catch(() => {});
  };

  const onShare = async () => {
    const link = `${PUBLIC_WEB_URL}/live`;
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

  const onBuyFeatured = () => {
    if (!featured) return;
    if (!user) {
      router.push("/login");
      return;
    }
    router.push({ pathname: "/produk/[id]", params: { id: featured.id } });
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

  // Guest must create a display name first (no login required).
  if (active && needsName) {
    if (!nameLoaded) return <View style={[styles.root, { backgroundColor: colors.surface }]} />;
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialDesignIcons name="account-edit-outline" size={56} color={colors.brandPrimary} />
        <Text style={styles.offTitle}>Siapa nama kamu?</Text>
        <Text style={styles.offSub}>Buat nama tampilan dulu ya, biar host & penonton lain bisa membedakanmu di chat live.</Text>
        <TextInput
          testID="live-name-input"
          style={styles.nameInput}
          placeholder="Contoh: Rina"
          placeholderTextColor={colors.muted}
          value={nameInput}
          onChangeText={setNameInput}
          maxLength={24}
          onSubmitEditing={submitName}
          returnKeyType="done"
        />
        <Pressable
          testID="live-name-join"
          style={[styles.backToShop, !nameInput.trim() && { opacity: 0.5 }]}
          disabled={!nameInput.trim()}
          onPress={submitName}
        >
          <Text style={styles.backToShopText}>Gabung Live</Text>
        </Pressable>
      </View>
    );
  }

  // Kicked out by admin.
  if (kicked) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialDesignIcons name="account-cancel-outline" size={56} color={colors.error} />
        <Text style={styles.offTitle}>Anda dikeluarkan</Text>
        <Text style={styles.offSub}>Admin mengeluarkan Anda dari siaran live ini.</Text>
        <Pressable style={styles.backToShop} onPress={() => router.replace("/toko")}>
          <Text style={styles.backToShopText}>Ke Etalase</Text>
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
      {/* Video memenuhi seluruh layar */}
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

      {/* Floating reactions */}
      {floats.map((f) => (
        <FloatingEmoji
          key={f.key}
          emoji={f.emoji}
          offset={f.offset}
          onDone={() => removeFloat(f.key)}
        />
      ))}

      {/* Bottom stack transparan di atas video */}
      <View style={[styles.bottomCol, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
        {pinned ? (
          <View style={styles.pinnedBanner}>
            <MaterialDesignIcons name="pin" size={14} color="#fff" />
            <Text style={styles.pinnedText} numberOfLines={2}>
              <Text style={styles.pinnedName}>{pinned.role === "admin" ? "👑 " : ""}{pinned.name}: </Text>
              {pinned.text}
            </Text>
          </View>
        ) : null}

        <View style={styles.chatRow} pointerEvents="box-none">
          <FlatList
            ref={chatRef}
            data={chat}
            keyExtractor={(m) => m.id}
            style={styles.chatList}
            renderItem={({ item }) =>
              item.role === "system" ? (
                <View style={styles.joinBubble}>
                  <Text style={styles.joinText}>✨ {item.text}</Text>
                </View>
              ) : (
              <View style={styles.chatBubble}>
                <Text style={styles.chatName}>
                  {item.role === "admin" ? "👑 " : ""}{item.name}:{" "}
                  <Text style={styles.chatText}>{item.text}</Text>
                </Text>
              </View>
              )
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 4, paddingTop: 8 }}
          />
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
        </View>

        {/* Featured product */}
        {featured ? (
          <View style={styles.featuredBar} testID="live-featured">
            {(() => {
              const uri = resolveImageUrl(featured.foto_urls?.[0] ?? null);
              return uri ? (
                <Image source={{ uri }} style={styles.featuredImg} contentFit="cover" />
              ) : (
                <View style={[styles.featuredImg, styles.pImgEmpty]}>
                  <MaterialDesignIcons name="image-off-outline" size={20} color="#fff" />
                </View>
              );
            })()}
            <View style={{ flex: 1 }}>
              <Text style={styles.featuredTag}>⭐ DISOROT</Text>
              <Text style={styles.featuredName} numberOfLines={1}>{featured.nama_produk}</Text>
              <Text style={styles.featuredPrice}>{formatRupiah(featured.harga)}</Text>
            </View>
            <Pressable testID="live-buy-featured" style={styles.featuredBuy} onPress={onBuyFeatured}>
              <Text style={styles.featuredBuyText}>Beli Sekarang</Text>
            </Pressable>
          </View>
        ) : null}

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
          {muted ? (
            <View style={styles.mutedBar}>
              <MaterialDesignIcons name="microphone-off" size={18} color="rgba(255,255,255,0.7)" />
              <Text style={styles.mutedText}>Anda dibisukan admin</Text>
            </View>
          ) : (
            <View style={styles.inputBar}>
              <TextInput
                testID="live-chat-input"
                style={styles.input}
                placeholder="Tulis komentar..."
                placeholderTextColor="rgba(255,255,255,0.55)"
                value={text}
                onChangeText={setText}
                onSubmitEditing={sendChat}
                returnKeyType="send"
              />
              <Pressable testID="live-chat-send" style={styles.sendBtn} onPress={sendChat}>
                <MaterialDesignIcons name="send" size={20} color="#fff" />
              </Pressable>
            </View>
          )}
        </KeyboardStickyView>
      </View>
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
  nameInput: { alignSelf: "stretch", marginTop: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, borderWidth: 1, borderColor: colors.surfaceTertiary, textAlign: "center" },

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

  bottomCol: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 8 },
  chatRow: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, gap: 8 },
  chatList: { flex: 1, maxHeight: 190 },
  reactRail: { alignItems: "center", gap: 10 },
  reactBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  reactEmoji: { fontSize: 20 },
  likeBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },

  pinnedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "rgba(168,85,247,0.85)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, marginHorizontal: 12 },
  pinnedText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: "#fff" },
  pinnedName: { fontFamily: fonts.bodyMedium, color: "#fff" },
  chatBubble: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" },
  chatName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#FFD9F3" },
  chatText: { fontFamily: fonts.body, fontSize: 13, color: "#fff" },
  joinBubble: { alignSelf: "center", backgroundColor: "rgba(168,85,247,0.25)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  joinText: { fontFamily: fonts.body, fontSize: 11, color: "rgba(255,255,255,0.85)", fontStyle: "italic" },

  featuredBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(233,213,255,0.94)", borderRadius: 16, marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 10 },
  featuredImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  featuredTag: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.brandPrimary, letterSpacing: 0.5 },
  featuredName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  featuredPrice: { fontFamily: fonts.heading, fontSize: 15, color: colors.brandPrimary },
  featuredBuy: { backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  featuredBuyText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onBrandPrimary },

  strip: { backgroundColor: "transparent", flexDirection: "row", alignItems: "center" },
  pCard: { width: 120, backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 14, padding: 8 },
  pImg: { width: "100%", height: 80, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  pImgEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  pName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurface, marginTop: 6 },
  pPrice: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary, marginTop: 2 },
  cartFab: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginHorizontal: 12 },

  inputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 4 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: "#fff", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  mutedBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 16, marginHorizontal: 12 },
  mutedText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: "rgba(255,255,255,0.85)" },
}));
