import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { useCart } from "@/src/context/cart";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

type Product = {
  id: string;
  kategori: string;
  nama_produk: string;
  harga: number;
  stok: number;
  bisa_po: boolean;
  foto_urls: string[];
};

export default function TokoScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { count } = useCart();
  const { user } = useAuth();

  const { data: unreadChat } = useQuery<{ count: number }>({
    queryKey: ["chat", "unread"],
    queryFn: () => apiRequest<{ count: number }>("/api/chat/unread"),
    enabled: !!user,
  });
  const chatBadge = unreadChat?.count ?? 0;

  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState<string>("Semua");

  const { data, isLoading } = useQuery<Product[]>({
    queryKey: ["products", search],
    queryFn: () => apiRequest<Product[]>(`/api/products${search ? `?search=${encodeURIComponent(search)}` : ""}`, { auth: false }),
  });

  const { data: live } = useQuery<{ live: boolean; title?: string }>({
    queryKey: ["live", "current"],
    queryFn: () => apiRequest<{ live: boolean; title?: string }>("/api/live/current", { auth: false }),
    refetchInterval: 10000,
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((p) => p.kategori && set.add(p.kategori));
    return ["Semua", ...Array.from(set)];
  }, [data]);

  const filtered = useMemo(() => {
    if (kategori === "Semua") return data ?? [];
    return (data ?? []).filter((p) => p.kategori === kategori);
  }, [data, kategori]);

  const renderCard = ({ item }: { item: Product }) => {
    const cover = resolveImageUrl(item.foto_urls?.[0]);
    return (
      <Pressable
        testID={`shop-product-${item.id}`}
        style={styles.card}
        onPress={() => router.push({ pathname: "/produk/[id]", params: { id: item.id } })}
      >
        <View style={styles.imgWrap}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.img} contentFit="cover" transition={200} />
          ) : (
            <View style={[styles.img, styles.imgEmpty]}>
              <MaterialDesignIcons name="image-off-outline" size={26} color={colors.muted} />
            </View>
          )}
          {item.bisa_po ? <Text style={styles.poBadge}>PO</Text> : null}
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.nama_produk}</Text>
        <Text style={styles.price}>{formatRupiah(item.harga)}</Text>
        <Text style={styles.stock}>Stok {item.stok}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {router.canGoBack() ? (
          <Pressable testID="toko-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
        <Text style={styles.headerTitle}>Etalase Toko</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable testID="toko-chat" onPress={() => router.push("/chat")} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="chat-outline" size={24} color={colors.onSurface} />
            {chatBadge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{chatBadge}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable testID="toko-cart" onPress={() => router.push("/keranjang")} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="cart-outline" size={24} color={colors.onSurface} />
            {count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable testID="toko-account" onPress={() => router.push(user ? "/home" : "/login")} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="account-circle-outline" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {live?.live ? (
        <Pressable testID="live-banner" style={styles.liveBanner} onPress={() => router.push("/live")}>
          <View style={styles.liveDot} />
          <MaterialDesignIcons name="access-point" size={20} color="#fff" />
          <Text style={styles.liveBannerText} numberOfLines={1}>Sedang LIVE — {live.title ?? "Tonton sekarang"}</Text>
          <MaterialDesignIcons name="chevron-right" size={20} color="#fff" />
        </Pressable>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialDesignIcons name="magnify" size={20} color={colors.muted} />
        <TextInput
          testID="toko-search"
          style={styles.searchInput}
          placeholder="Cari produk..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipContent}
        >
          {categories.map((c) => {
            const active = c === kategori;
            return (
              <Pressable
                key={c}
                testID={`chip-${c}`}
                onPress={() => setKategori(c)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={renderCard}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="storefront-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada produk</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.onBrandPrimary },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.error,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveBannerText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: "#fff" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, paddingVertical: 12 },
  chipRow: { height: 56, justifyContent: "center" },
  chipContent: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 18,
    padding: 8,
    gap: 4,
  },
  imgWrap: { position: "relative" },
  img: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: colors.surfaceTertiary },
  imgEmpty: { alignItems: "center", justifyContent: "center" },
  poBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.onBrandPrimary,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  name: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface, marginTop: 4, paddingHorizontal: 4 },
  price: { fontFamily: fonts.heading, fontSize: 15, color: colors.brandPrimary, paddingHorizontal: 4 },
  stock: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, paddingHorizontal: 4, paddingBottom: 4 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
}));
