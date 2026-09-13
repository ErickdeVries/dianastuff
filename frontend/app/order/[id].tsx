import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { M3Button } from "@/src/components/m3-button";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { STATUS_LABEL } from "@/src/utils/order";

type OrderItem = { nama_produk: string; harga: number; qty: number; foto?: string | null };
type Order = {
  id: string;
  no_order: string;
  items: OrderItem[];
  subtotal: number;
  ongkir: number;
  total: number;
  status: string;
  alamat: { nama?: string; wa?: string; alamat?: string; kota?: string; kode_pos?: string };
  kurir?: string;
  bukti_bayar_url?: string | null;
};
type Profil = { nama_toko: string; whatsapp?: string; rekening_bank: { bank: string; no_rek: string; a_n: string }[] };

export default function OrderDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: order } = useQuery<Order>({ queryKey: ["order", id], queryFn: () => apiRequest<Order>(`/api/orders/${id}`) });
  const { data: profil } = useQuery<Profil>({ queryKey: ["profil_admin"], queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }) });

  const uploadBukti = useMutation({
    mutationFn: (url: string) => apiRequest(`/api/orders/${id}/bukti`, { method: "POST", body: { bukti_bayar_url: url } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      setMsg("Bukti bayar terkirim. Menunggu konfirmasi admin.");
    },
  });

  const onUpload = async () => {
    setMsg(null);
    setUploading(true);
    try {
      const res = await pickAndUploadImages(1);
      if (res.permissionDenied) {
        setMsg(res.canAskAgain ? "Izin galeri diperlukan." : "Izin galeri diblokir. Buka Pengaturan.");
        return;
      }
      if (res.error) { setMsg(res.error); return; }
      if (res.urls[0]) uploadBukti.mutate(res.urls[0]);
    } finally {
      setUploading(false);
    }
  };

  const waConfirm = () => {
    if (!profil?.whatsapp || !order) return;
    let num = profil.whatsapp.replace(/\D/g, "");
    if (num.startsWith("0")) num = "62" + num.slice(1);
    const text = `Halo Admin ${profil.nama_toko}, saya sudah order.\nNo Order: ${order.no_order}\nTotal: ${formatRupiah(order.total)}`;
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="order-back" onPress={() => router.replace("/pesanan-saya")} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Detail Pesanan</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 120 }}>
        <View style={styles.successCard}>
          <MaterialDesignIcons name="check-circle" size={40} color={colors.onSuccess} />
          <Text style={styles.successTitle}>Pesanan Dibuat!</Text>
          <Text style={styles.noOrder} testID="order-no">{order?.no_order}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{order ? STATUS_LABEL[order.status] ?? order.status : ""}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Produk</Text>
          {order?.items.map((it, i) => {
            const cover = resolveImageUrl(it.foto);
            return (
              <View key={i} style={styles.itemRow}>
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <MaterialDesignIcons name="image-off-outline" size={18} color={colors.muted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={2}>{it.nama_produk}</Text>
                  <Text style={styles.itemMeta}>{it.qty} × {formatRupiah(it.harga)}</Text>
                </View>
                <Text style={styles.itemTotal}>{formatRupiah(it.harga * it.qty)}</Text>
              </View>
            );
          })}
          <View style={styles.divider} />
          <Row label="Subtotal" value={formatRupiah(order?.subtotal ?? 0)} />
          <Row label={`Ongkir${order?.kurir ? ` (${order.kurir})` : ""}`} value={(order?.ongkir ?? 0) > 0 ? formatRupiah(order!.ongkir) : "Dikonfirmasi admin"} />
          <Row label="Total" value={formatRupiah(order?.total ?? 0)} bold />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Alamat Pengiriman</Text>
          <Text style={styles.addrName}>{order?.alamat?.nama} {order?.alamat?.wa ? `· ${order.alamat.wa}` : ""}</Text>
          <Text style={styles.addrText}>{order?.alamat?.alamat}</Text>
          <Text style={styles.addrText}>{order?.alamat?.kota} {order?.alamat?.kode_pos ?? ""}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transfer ke Rekening</Text>
          {(profil?.rekening_bank ?? []).map((r, i) => (
            <View key={i} style={styles.rekRow}>
              <Text style={styles.rekBank}>{r.bank}</Text>
              <View>
                <Text style={styles.rekNo}>{r.no_rek}</Text>
                <Text style={styles.rekAn}>a.n {r.a_n}</Text>
              </View>
            </View>
          ))}

          {order?.bukti_bayar_url ? (
            <View style={styles.buktiWrap} testID="bukti-preview">
              <Text style={styles.addrText}>Bukti bayar terkirim:</Text>
              <Image source={{ uri: resolveImageUrl(order.bukti_bayar_url) }} style={styles.bukti} contentFit="cover" />
            </View>
          ) : null}

          {msg ? <Text style={styles.msg} testID="order-msg">{msg}</Text> : null}

          <M3Button
            testID="upload-bukti"
            label={order?.bukti_bayar_url ? "Ganti Bukti Bayar" : "Upload Bukti Bayar"}
            icon="upload"
            variant="tonal"
            loading={uploading || uploadBukti.isPending}
            onPress={onUpload}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <M3Button testID="wa-confirm" label="Konfirmasi via WhatsApp" icon="whatsapp" variant="fab" onPress={waConfirm} />
      </View>
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && styles.summaryBold]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryBold]}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  successCard: { backgroundColor: colors.success, borderRadius: 20, padding: 20, alignItems: "center", gap: 6 },
  successTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSuccess },
  noOrder: { fontFamily: fonts.heading, fontSize: 22, color: colors.onSuccess, letterSpacing: 1 },
  statusPill: { backgroundColor: colors.onSuccess, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5, marginTop: 4 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.success },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  itemName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  itemMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  itemTotal: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  summaryValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  summaryBold: { fontFamily: fonts.heading, fontSize: 18, color: colors.brandPrimary },
  addrName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  addrText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  rekRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12 },
  rekBank: { fontFamily: fonts.heading, fontSize: 14, color: colors.brandPrimary, width: 56 },
  rekNo: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  rekAn: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  buktiWrap: { gap: 8 },
  bukti: { width: 120, height: 120, borderRadius: 12, backgroundColor: colors.surfaceTertiary },
  msg: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.success },
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
  },
}));
