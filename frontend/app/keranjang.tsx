import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { M3Button } from "@/src/components/m3-button";
import { CartItem, cartLineId, useCart } from "@/src/context/cart";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

export default function KeranjangScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, subtotal, setQty, removeItem } = useCart();

  const renderItem = ({ item }: { item: CartItem }) => {
    const cover = resolveImageUrl(item.foto);
    const lid = cartLineId(item);
    return (
      <View style={styles.card} testID={`cart-item-${item.product_id}`}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <MaterialDesignIcons name="image-off-outline" size={20} color={colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{item.nama_produk}</Text>
          {item.variation_label ? <Text style={styles.variation}>Variasi: {item.variation_label}</Text> : null}
          <Text style={styles.price}>{formatRupiah(item.harga)}</Text>
          <View style={styles.stepper}>
            <Pressable testID={`cart-minus-${item.product_id}`} onPress={() => setQty(lid, item.qty - 1)} style={styles.stepBtn}>
              <MaterialDesignIcons name="minus" size={16} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.qty}>{item.qty}</Text>
            <Pressable testID={`cart-plus-${item.product_id}`} onPress={() => setQty(lid, item.qty + 1)} style={styles.stepBtn}>
              <MaterialDesignIcons name="plus" size={16} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>
        <Pressable testID={`cart-remove-${item.product_id}`} onPress={() => removeItem(lid)} style={styles.removeBtn}>
          <MaterialDesignIcons name="trash-can-outline" size={20} color={colors.error} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="keranjang-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Keranjang</Text>
        <View style={styles.headerBtn} />
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialDesignIcons name="cart-off" size={56} color={colors.muted} />
          <Text style={styles.emptyText}>Keranjang masih kosong</Text>
          <M3Button testID="empty-shop" label="Mulai Belanja" variant="filled" icon="shopping-outline" onPress={() => router.replace("/toko")} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(i) => cartLineId(i)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 160 + insets.bottom }}
          />
          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue} testID="cart-subtotal">{formatRupiah(subtotal)}</Text>
            </View>
            <M3Button testID="go-checkout" label="Lanjut Checkout" icon="arrow-right" variant="filled" onPress={() => router.push("/checkout")} />
          </View>
        </>
      )}
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
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 18,
    padding: 12,
  },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.surfaceTertiary },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  name: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  variation: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  price: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  qty: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface, minWidth: 22, textAlign: "center" },
  removeBtn: { padding: 6 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  totalValue: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
}));
