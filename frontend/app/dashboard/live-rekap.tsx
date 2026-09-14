import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getLiveHistory, LiveHistoryItem } from "@/src/api/live";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatDateTime, formatRupiah } from "@/src/utils/format";

export default function LiveRekapScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery<LiveHistoryItem[]>({
    queryKey: ["live", "history"],
    queryFn: getLiveHistory,
  });

  const renderItem = ({ item }: { item: LiveHistoryItem }) => (
    <View style={styles.card} testID={`rekap-${item.id}`}>
      <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
      {item.started_at ? <Text style={styles.date}>{formatDateTime(item.started_at)}</Text> : null}
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <MaterialDesignIcons name="eye" size={20} color={colors.brandPrimary} />
          <Text style={styles.statValue}>{item.recap.peak_viewers}</Text>
          <Text style={styles.statLabel}>Puncak Penonton</Text>
        </View>
        <View style={styles.stat}>
          <MaterialDesignIcons name="heart" size={20} color={colors.error} />
          <Text style={styles.statValue}>{item.recap.total_likes}</Text>
          <Text style={styles.statLabel}>Total Like</Text>
        </View>
        <View style={styles.stat}>
          <MaterialDesignIcons name="receipt-text-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.statValue}>{item.recap.orders_count}</Text>
          <Text style={styles.statLabel}>Pesanan</Text>
        </View>
      </View>
      {item.recap.orders_total > 0 ? (
        <Text style={styles.omzet}>Omzet saat live: {formatRupiah(item.recap.orders_total)}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={data ?? []}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="chart-box-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada rekap live.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 6 },
  title: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface },
  date: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  statRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textAlign: "center" },
  omzet: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary, marginTop: 8, textAlign: "center" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
}));
