import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Dimensions, FlatList, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { ImageViewer } from "@/src/components/image-viewer";
import { useCart } from "@/src/context/cart";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatDate, formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { PUBLIC_WEB_URL } from "@/src/utils/links";

type Product = {
  id: string;
  kategori: string;
  nama_produk: string;
  deskripsi: string;
  harga: number;
  stok: number;
  berat_gram: number;
  bisa_po: boolean;
  foto_urls: string[];
};

type ReviewItem = { rating: number; komentar: string; foto_url?: string | null; nama: string; created_at: string | null };
type Reviews = { average: number; count: number; items: ReviewItem[] };

const { width: SCREEN_W } = Dimensions.get("window");

export default function ProductDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addItem, count } = useCart();
  const toast = useToast();

  const [activePhoto, setActivePhoto] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | undefined>(undefined);

  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => apiRequest<Product>(`/api/products/${id}`, { auth: false }),
  });

  const { data: reviews } = useQuery<Reviews>({
    queryKey: ["product", id, "reviews"],
    queryFn: () => apiRequest<Reviews>(`/api/products/${id}/reviews`, { auth: false }),
    enabled: !!id,
  });

  const photos = product?.foto_urls?.length ? product.foto_urls : [null];
  const available = product ? product.bisa_po || product.stok > 0 : false;

  const onShare = async () => {
    if (!product) return;
    const link = `${PUBLIC_WEB_URL}/produk/${product.id}`;
    const msg = `${product.nama_produk} - ${formatRupiah(product.harga)}\nLihat di sini: ${link}`;
    try {
      await Share.share({ message: msg });
    } catch {
      // Fallback: open WhatsApp share directly.
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    }
  };

  const onAdd = () => {
    if (!product) return;
    addItem(
      {
        product_id: product.id,
        nama_produk: product.nama_produk,
        harga: product.harga,
        foto: product.foto_urls?.[0] ?? null,
        stok: product.stok,
        bisa_po: product.bisa_po,
      },
      qty,
    );
    setAdded(true);
    toast.show("Ditambahkan ke keranjang", "success");
    setTimeout(() => setAdded(false), 1500);
  };

  const onBuyNow = () => {
    if (!product || !available) return;
    onAdd();
    router.push("/checkout");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="produk-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable testID="produk-share" onPress={onShare} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="share-variant" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="produk-cart" onPress={() => router.push("/keranjang")} hitSlop={10} style={styles.headerBtn}>
            <MaterialDesignIcons name="cart-outline" size={24} color={colors.onSurface} />
            {count > 0 ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View>
          <FlatList
            data={photos}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActivePhoto(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            renderItem={({ item }) => {
              const uri = resolveImageUrl(item);
              return uri ? (
                <Pressable testID="produk-foto" onPress={() => setViewerUri(uri)}>
                  <Image source={{ uri }} style={styles.slide} contentFit="cover" transition={200} />
                </Pressable>
              ) : (
                <View style={[styles.slide, styles.slideEmpty]}>
                  <MaterialDesignIcons name="image-off-outline" size={40} color={colors.muted} />
                </View>
              );
            }}
          />
          {photos.length > 1 ? (
            <View style={styles.dots}>
              {photos.map((_, i) => (
                <View key={i} style={[styles.dot, i === activePhoto && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.info}>
          {product ? (
            <>
              {product.kategori ? <Text style={styles.kategori}>{product.kategori}</Text> : null}
              <Text style={styles.name} testID="produk-nama">{product.nama_produk}</Text>
              <Text style={styles.price}>{formatRupiah(product.harga)}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <MaterialDesignIcons name="package-variant-closed" size={16} color={colors.onSurfaceTertiary} />
                  <Text style={styles.metaText}>Stok {product.stok}</Text>
                </View>
                {product.berat_gram ? (
                  <View style={styles.metaChip}>
                    <MaterialDesignIcons name="weight-gram" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={styles.metaText}>{product.berat_gram} g</Text>
                  </View>
                ) : null}
                {product.bisa_po ? (
                  <View style={[styles.metaChip, { backgroundColor: colors.brandTertiary }]}>
                    <Text style={[styles.metaText, { color: colors.onBrandTertiary }]}>Bisa PO</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>Jumlah</Text>
                <View style={styles.stepper}>
                  <Pressable testID="qty-minus" onPress={() => setQty((q) => Math.max(1, q - 1))} style={styles.stepBtn}>
                    <MaterialDesignIcons name="minus" size={18} color={colors.onSurface} />
                  </Pressable>
                  <Text style={styles.qtyText} testID="qty-value">{qty}</Text>
                  <Pressable testID="qty-plus" onPress={() => setQty((q) => q + 1)} style={styles.stepBtn}>
                    <MaterialDesignIcons name="plus" size={18} color={colors.onSurface} />
                  </Pressable>
                </View>
              </View>
              {product.deskripsi ? (
                <>
                  <Text style={styles.sectionTitle}>Deskripsi</Text>
                  <Text style={styles.desc}>{product.deskripsi}</Text>
                </>
              ) : null}

              {/* Buyer reviews (star + ulasan) */}
              <View style={styles.reviewHead}>
                <Text style={styles.sectionTitle}>Ulasan Pembeli</Text>
                {reviews && reviews.count > 0 ? (
                  <View style={styles.ratingPill}>
                    <MaterialDesignIcons name="star" size={16} color={colors.warning} />
                    <Text style={styles.ratingText}>{reviews.average} · {reviews.count} ulasan</Text>
                  </View>
                ) : null}
              </View>
              {reviews && reviews.count > 0 ? (
                reviews.items.map((r, i) => (
                  <View key={i} style={styles.reviewCard} testID={`review-${i}`}>
                    <View style={styles.reviewTop}>
                      <Text style={styles.reviewName}>{r.nama}</Text>
                      <View style={{ flexDirection: "row" }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <MaterialDesignIcons key={n} name={n <= r.rating ? "star" : "star-outline"} size={14} color={colors.warning} />
                        ))}
                      </View>
                    </View>
                    {r.komentar ? <Text style={styles.reviewText}>{r.komentar}</Text> : null}
                    {r.foto_url ? (
                      <Pressable onPress={() => setViewerUri(resolveImageUrl(r.foto_url))}>
                        <Image source={{ uri: resolveImageUrl(r.foto_url) }} style={styles.reviewPhoto} contentFit="cover" />
                      </Pressable>
                    ) : null}
                    {r.created_at ? <Text style={styles.reviewDate}>{formatDate(r.created_at)}</Text> : null}
                  </View>
                ))
              ) : (
                <Text style={styles.desc}>Belum ada ulasan untuk produk ini.</Text>
              )}
            </>
          ) : !isLoading ? (
            <Text style={styles.desc}>Produk tidak ditemukan.</Text>
          ) : null}
        </View>
      </ScrollView>

      {product ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {/* Shopee-style action bar: chat | keranjang | beli sekarang */}
          <View style={styles.footerIcons}>
            <Pressable testID="footer-chat" onPress={() => router.push("/chat")} style={styles.footerIconBtn}>
              <MaterialDesignIcons name="chat-outline" size={24} color={colors.brandPrimary} />
            </Pressable>
            <View style={styles.footerDivider} />
            <Pressable testID="footer-cart" onPress={onAdd} disabled={!available} style={styles.footerIconBtn}>
              <MaterialDesignIcons name={added ? "check" : "cart-plus"} size={24} color={colors.brandPrimary} />
              {count > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
              ) : null}
            </Pressable>
          </View>
          <Pressable
            testID="beli-sekarang"
            disabled={!available}
            onPress={onBuyNow}
            style={[styles.buyBtn, !available && { opacity: 0.5 }]}
          >
            <Text style={styles.buyBtnLabel}>{available ? "Beli Sekarang" : "Stok Habis"}</Text>
            {available ? (
              <Text style={styles.buyBtnPrice}>{formatRupiah(product.harga * qty)}</Text>
            ) : null}
          </Pressable>
        </View>
      ) : null}

      <ImageViewer visible={!!viewerUri} uri={viewerUri} onClose={() => setViewerUri(undefined)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: colors.surfaceSecondary,
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.onBrandPrimary },
  slide: { width: SCREEN_W, height: SCREEN_W, backgroundColor: colors.surfaceTertiary },
  slideEmpty: { alignItems: "center", justifyContent: "center" },
  dots: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.surfaceSecondary, opacity: 0.6 },
  dotActive: { backgroundColor: colors.brandPrimary, opacity: 1, width: 18 },
  info: { padding: 20, gap: 8 },
  kategori: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  name: { fontFamily: fonts.heading, fontSize: 22, color: colors.onSurface },
  price: { fontFamily: fonts.heading, fontSize: 22, color: colors.brandPrimary },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  metaText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceTertiary },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface, marginTop: 12 },
  desc: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 22 },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ratingText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceTertiary },
  reviewCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  reviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  reviewText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceTertiary, lineHeight: 19 },
  reviewPhoto: { width: 80, height: 80, borderRadius: 10, backgroundColor: colors.surfaceTertiary, marginTop: 6 },
  reviewDate: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerIcons: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandTertiary,
    borderRadius: 16,
  },
  footerIconBtn: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  footerDivider: { width: 1, height: 26, backgroundColor: colors.divider },
  buyBtn: {
    flex: 1,
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  buyBtnLabel: { fontFamily: fonts.heading, fontSize: 16, color: colors.onBrandPrimary },
  buyBtnPrice: { fontFamily: fonts.body, fontSize: 12, color: colors.onBrandPrimary, opacity: 0.9 },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  qtyLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  stepBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  qtyText: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.onSurface, minWidth: 24, textAlign: "center" },
}));
