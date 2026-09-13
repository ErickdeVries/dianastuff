import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Dimensions, FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { useCart } from "@/src/context/cart";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

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

  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => apiRequest<Product>(`/api/products/${id}`, { auth: false }),
  });

  const photos = product?.foto_urls?.length ? product.foto_urls : [null];
  const available = product ? product.bisa_po || product.stok > 0 : false;

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
        <Pressable testID="produk-cart" onPress={() => router.push("/keranjang")} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="cart-outline" size={24} color={colors.onSurface} />
          {count > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
          ) : null}
        </Pressable>
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
                <Image source={{ uri }} style={styles.slide} contentFit="cover" transition={200} />
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
