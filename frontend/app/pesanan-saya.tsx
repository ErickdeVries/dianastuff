import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { STATUS_LABEL } from "@/src/utils/order";

type Order = {
  id: string;
  no_order: string;
  total: number;
  status: string;
  created_at: string | null;
  items: { qty: number }[];
};

export default function PesananSaya() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: () => apiRequest<Order[]>("/api/orders"),
  });

  const renderItem = ({ item }: { item: Order }) => {
    const totalQty = item.items.reduce((n, i) => n + i.qty, 0);
    const paid = item.status !== "menunggu_pembayaran";
    return (
      <Pressable
        testID={`order-${item.id}`}
        style={styles.card}
        onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
      >
        <View style={styles.iconBox}>
          <MaterialDesignIcons name="package-variant-closed" size={24} color={colors.onBrandTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.noOrder}>{item.no_order}</Text>
          <Text style={styles.meta}>{totalQty} item · {formatRupiah(item.total)}</Text>
          <View style={[styles.statusPill, paid ? styles.statusPaid : styles.statusUnpaid]}>
            <Text style={[styles.statusText, { color: paid ? colors.onSuccess : colors.onWarning }]}>
              {STATUS_LABEL[item.status] ?? item.status}
            </Text>
          </View>
        </View>
        <MaterialDesignIcons name="chevron-right" size={22} color={colors.muted} />
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="pesanan-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Pesanan Saya</Text>
        <View style={styles.headerBtn} />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(o) => o.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="receipt-text-outline" size={56} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada pesanan</Text>
              <M3Button testID="empty-shop" label="Mulai Belanja" icon="shopping-outline" variant="filled" onPress={() => router.replace("/toko")} style={{ marginTop: 12 }} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 14 },
  iconBox: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  noOrder: { fontFamily: fonts.heading, fontSize: 15, color: colors.onSurface },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  statusPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 6 },
  statusPaid: { backgroundColor: colors.success },
  statusUnpaid: { backgroundColor: colors.warning },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 11 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
}));
