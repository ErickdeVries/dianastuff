import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { apiRequest } from "@/src/api/client";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatDateTime, formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

type TopProduct = { product_id: string; nama: string; foto?: string | null; terjual: number; omzet: number };
type Visitor = { viewer_name: string; produk: string | null; login: boolean; at: string | null };

type Analytics = {
  pesanan_selesai: number;
  unit_terjual: number;
  pendapatan_kotor: number;
  ongkir_total: number;
  voucher_total: number;
  platform_fee_percent: number;
  platform_fee: number;
  pendapatan_bersih: number;
  produk_terlaris: TopProduct[];
  total_dilihat: number;
  pengunjung_login: number;
  pengunjung_terbaru: Visitor[];
};

export default function AnalitikScreen() {
  const styles = useStyles();
  const { colors } = useTheme();

  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ["admin", "analytics"],
    queryFn: () => apiRequest<Analytics>("/api/admin/analytics"),
    refetchInterval: 15000,
  });

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  const maxQty = Math.max(1, ...data.produk_terlaris.map((p) => p.terjual));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Rekap penjualan otomatis */}
      <Text style={styles.heading}>Rekap Penjualan (Pesanan Selesai)</Text>
      <View style={styles.netCard} testID="net-card">
        <Text style={styles.netLabel}>Pendapatan Bersih</Text>
        <Text style={styles.netValue}>{formatRupiah(data.pendapatan_bersih)}</Text>
        <Text style={styles.netSub}>
          Setelah dipotong ongkir kurir & fee platform ({data.platform_fee_percent}%)
        </Text>
      </View>

      <View style={styles.grid}>
        <Stat icon="package-variant-closed" color={colors.brandPrimary} value={String(data.unit_terjual)} label="Unit Terjual" />
        <Stat icon="receipt-text-check-outline" color={colors.success} value={String(data.pesanan_selesai)} label="Pesanan Selesai" />
        <Stat icon="cash-multiple" color={colors.info} value={formatRupiah(data.pendapatan_kotor)} label="Pendapatan Kotor" small />
        <Stat icon="truck-outline" color={colors.warning} value={formatRupiah(data.ongkir_total)} label="Ongkir Kurir" small />
        <Stat icon="ticket-percent-outline" color={colors.error} value={formatRupiah(data.voucher_total)} label="Diskon Voucher" small />
        <Stat icon="percent-outline" color={colors.brandSecondary} value={formatRupiah(data.platform_fee)} label={`Fee Platform (${data.platform_fee_percent}%)`} small />
      </View>

      {/* Pengunjung */}
      <Text style={styles.heading}>Pengunjung Toko</Text>
      <View style={styles.grid}>
        <Stat icon="eye-outline" color={colors.info} value={String(data.total_dilihat)} label="Total Produk Dilihat" />
        <Stat icon="account-check-outline" color={colors.brandPrimary} value={String(data.pengunjung_login)} label="Pengunjung (Login)" />
      </View>

      {/* Produk terlaris */}
      <Text style={styles.heading}>Produk Terlaris</Text>
      {data.produk_terlaris.length === 0 ? (
        <Text style={styles.empty}>Belum ada penjualan selesai.</Text>
      ) : (
        <View style={styles.listCard}>
          {data.produk_terlaris.map((p, i) => (
            <View key={p.product_id} style={styles.topRow} testID={`top-product-${i}`}>
              <Text style={styles.rank}>{i + 1}</Text>
              {resolveImageUrl(p.foto) ? (
                <Image source={{ uri: resolveImageUrl(p.foto) }} style={styles.topImg} contentFit="cover" />
              ) : (
                <View style={[styles.topImg, styles.topImgEmpty]}>
                  <MaterialDesignIcons name="image-off-outline" size={18} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.topName} numberOfLines={1}>{p.nama}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round((p.terjual / maxQty) * 100)}%` }]} />
                </View>
                <Text style={styles.topMeta}>{p.terjual} terjual · {formatRupiah(p.omzet)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Pengunjung terbaru */}
      <Text style={styles.heading}>Aktivitas Pengunjung Terbaru</Text>
      {data.pengunjung_terbaru.length === 0 ? (
        <Text style={styles.empty}>Belum ada yang melihat produk.</Text>
      ) : (
        <View style={styles.listCard}>
          {data.pengunjung_terbaru.map((v, i) => (
            <View key={i} style={styles.visitRow} testID={`visitor-${i}`}>
              <View style={[styles.visitIcon, { backgroundColor: v.login ? colors.brandTertiary : colors.surfaceTertiary }]}>
                <MaterialDesignIcons name={v.login ? "account" : "account-outline"} size={18} color={v.login ? colors.brandPrimary : colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.visitName}>
                  {v.viewer_name} {v.login ? "" : "(Tamu)"}
                </Text>
                <Text style={styles.visitSub} numberOfLines={1}>Melihat {v.produk ?? "produk"}</Text>
              </View>
              <Text style={styles.visitTime}>{v.at ? formatDateTime(v.at) : ""}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ icon, color, value, label, small }: { icon: string; color: string; value: string; label: string; small?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color }]}>
        <MaterialDesignIcons name={icon as any} size={20} color={colors.onBrandPrimary} />
      </View>
      <Text style={[styles.statValue, small && styles.statValueSmall]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  content: { padding: 20, gap: 14 },
  heading: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface, marginTop: 6 },
  netCard: { backgroundColor: colors.brandPrimary, borderRadius: 20, padding: 20, gap: 4 },
  netLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onBrandPrimary, opacity: 0.9 },
  netValue: { fontFamily: fonts.heading, fontSize: 30, color: colors.onBrandPrimary },
  netSub: { fontFamily: fonts.body, fontSize: 12, color: colors.onBrandPrimary, opacity: 0.85 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  statIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontFamily: fonts.heading, fontSize: 22, color: colors.onSurface },
  statValueSmall: { fontSize: 16 },
  statLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  listCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 12, gap: 12 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  rank: { fontFamily: fonts.heading, fontSize: 16, color: colors.brandPrimary, width: 20, textAlign: "center" },
  topImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  topImgEmpty: { alignItems: "center", justifyContent: "center" },
  topName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  barTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginVertical: 4, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.brandPrimary, borderRadius: 3 },
  topMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  visitRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  visitIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  visitName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  visitSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  visitTime: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, paddingVertical: 8 },
}));
