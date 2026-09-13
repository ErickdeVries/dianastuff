import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { M3Button } from "@/src/components/m3-button";
import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah, formatDateTime } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { STATUS_LABEL } from "@/src/utils/order";

type OrderItem = { nama_produk: string; harga: number; qty: number; foto?: string | null };
type Review = { rating: number; komentar: string } | null;
type Order = {
  id: string;
  no_order: string;
  items: OrderItem[];
  subtotal: number;
  ongkir: number;
  total: number;
  status: string;
  no_resi?: string | null;
  alamat: { nama?: string; wa?: string; alamat?: string; kota?: string; kode_pos?: string };
  kurir?: string;
  bukti_bayar_url?: string | null;
  review?: Review;
  status_history?: { status: string; at: string | null }[];
};
type Profil = { nama_toko: string; whatsapp?: string; rekening_bank: { bank: string; no_rek: string; a_n: string }[] };

const STAGES = ["Menunggu Pembayaran", "Sedang Dikemas", "Dikirim", "Selesai", "Beri Ulasan"];

function stageIndex(status: string, hasReview: boolean): number {
  if (hasReview) return 4;
  switch (status) {
    case "sedang_dikemas": return 1;
    case "dikirim": return 2;
    case "selesai": return 3;
    default: return 0;
  }
}

export default function OrderDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [uploading, setUploading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [komentar, setKomentar] = useState("");

  const { data: order } = useQuery<Order>({ queryKey: ["order", id], queryFn: () => apiRequest<Order>(`/api/orders/${id}`) });
  const { data: profil } = useQuery<Profil>({ queryKey: ["profil_admin"], queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }) });

  const confirmPay = useMutation({
    mutationFn: () => apiRequest(`/api/orders/${id}/konfirmasi-bayar`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.show("Status: Menunggu Konfirmasi", "success");
    },
  });

  const uploadBukti = useMutation({
    mutationFn: (url: string) => apiRequest(`/api/orders/${id}/bukti`, { method: "POST", body: { bukti_bayar_url: url } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.show("Bukti bayar terkirim", "success");
    },
  });

  const submitReview = useMutation({
    mutationFn: () => apiRequest(`/api/orders/${id}/review`, { method: "POST", body: { rating, komentar } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      setReviewOpen(false);
      toast.show("Terima kasih atas ulasannya!", "success");
    },
  });

  const onUpload = async () => {
    setUploading(true);
    try {
      const res = await pickAndUploadImages(1);
      if (res.permissionDenied) { toast.show(res.canAskAgain ? "Izin galeri diperlukan" : "Izin galeri diblokir. Buka Pengaturan", "error"); return; }
      if (res.error) { toast.show(res.error, "error"); return; }
      if (res.urls[0]) uploadBukti.mutate(res.urls[0]);
    } finally {
      setUploading(false);
    }
  };

  const confirmPayment = () => {
    if (!order) return;
    if (profil?.whatsapp) {
      let num = profil.whatsapp.replace(/\D/g, "");
      if (num.startsWith("0")) num = "62" + num.slice(1);
      const text = `Halo Admin ${profil?.nama_toko ?? "Diana Stuff"}, saya ${user?.email ?? user?.username ?? ""} sudah transfer order #${order.no_order} sebesar Rp ${order.total.toLocaleString("id-ID")}. Mohon dicek.`;
      Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
    }
    confirmPay.mutate();
  };

  const idx = order ? stageIndex(order.status, !!order.review) : 0;
  const notPaidYet = order?.status === "menunggu_pembayaran" || order?.status === "menunggu_konfirmasi";
  const canReview = order?.status === "selesai" && !order?.review;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="order-back" onPress={() => router.replace("/pesanan-saya")} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Detail Pesanan</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 130 }}>
        <View style={styles.successCard}>
          <Text style={styles.successLabel}>No. Pesanan</Text>
          <Text style={styles.noOrder} testID="order-no">{order?.no_order}</Text>
          <Text style={styles.statusNow}>{order ? STATUS_LABEL[order.status] ?? order.status : ""}</Text>
        </View>

        {/* Shopee-style stepper */}
        <View style={styles.stepperCard} testID="order-stepper">
          {STAGES.map((s, i) => {
            const done = i <= idx;
            return (
              <View key={s} style={styles.stepCol}>
                <View style={styles.stepLineWrap}>
                  {i > 0 ? <View style={[styles.line, i <= idx && styles.lineDone]} /> : <View style={styles.line} />}
                  <View style={[styles.node, done && styles.nodeDone]}>
                    <MaterialDesignIcons
                      name={done ? "check" : "circle-small"}
                      size={done ? 14 : 18}
                      color={done ? colors.onBrandPrimary : colors.muted}
                    />
                  </View>
                  {i < STAGES.length - 1 ? <View style={[styles.line, i < idx && styles.lineDone]} /> : <View style={styles.line} />}
                </View>
                <Text style={[styles.stepText, done && styles.stepTextDone]} numberOfLines={2}>{s}</Text>
              </View>
            );
          })}
        </View>

        {order?.no_resi ? (
          <View style={styles.resiBox} testID="order-resi">
            <MaterialDesignIcons name="truck-fast-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.resiText}>No. Resi ({order.kurir}): <Text style={styles.resiBold}>{order.no_resi}</Text></Text>
          </View>
        ) : null}

        {order?.status_history && order.status_history.length > 0 ? (
          <View style={styles.card} testID="status-history">
            <Text style={styles.cardTitle}>Riwayat Status</Text>
            {[...order.status_history].reverse().map((h, i) => (
              <View key={i} style={styles.historyRow}>
                <View style={styles.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyStatus}>{STATUS_LABEL[h.status] ?? h.status}</Text>
                  {h.at ? <Text style={styles.historyTime}>{formatDateTime(h.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

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
              <Text style={styles.addrText}>Bukti bayar:</Text>
              <Image source={{ uri: resolveImageUrl(order.bukti_bayar_url) }} style={styles.bukti} contentFit="cover" />
            </View>
          ) : null}
          <M3Button
            testID="upload-bukti"
            label={order?.bukti_bayar_url ? "Ganti Bukti Bayar" : "Upload Bukti Bayar"}
            icon="upload"
            variant="tonal"
            loading={uploading || uploadBukti.isPending}
            onPress={onUpload}
          />
        </View>

        {order?.review ? (
          <View style={styles.card} testID="order-review">
            <Text style={styles.cardTitle}>Ulasan Kamu</Text>
            <View style={{ flexDirection: "row", gap: 2 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <MaterialDesignIcons key={n} name={n <= order.review!.rating ? "star" : "star-outline"} size={22} color={colors.warning} />
              ))}
            </View>
            {order.review.komentar ? <Text style={styles.addrText}>{order.review.komentar}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky action */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {notPaidYet ? (
          <M3Button
            testID="confirm-payment"
            label="Konfirmasi Pembayaran via WhatsApp"
            icon="whatsapp"
            variant="fab"
            loading={confirmPay.isPending}
            onPress={confirmPayment}
          />
        ) : canReview ? (
          <M3Button testID="give-review" label="Beri Ulasan" icon="star-outline" variant="filled" onPress={() => setReviewOpen(true)} />
        ) : (
          <M3Button testID="chat-admin-order" label="Chat Admin" icon="chat-outline" variant="tonal" onPress={() => router.push("/chat")} />
        )}
      </View>

      {/* Review modal */}
      <Modal visible={reviewOpen} transparent animationType="fade" onRequestClose={() => setReviewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReviewOpen(false)}>
          <Pressable style={styles.reviewCard} onPress={() => {}}>
            <Text style={styles.cardTitle}>Beri Ulasan</Text>
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginVertical: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} testID={`star-${n}`} onPress={() => setRating(n)}>
                  <MaterialDesignIcons name={n <= rating ? "star" : "star-outline"} size={34} color={colors.warning} />
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="review-komentar"
              style={styles.reviewInput}
              placeholder="Tulis ulasan (opsional)"
              placeholderTextColor={colors.muted}
              value={komentar}
              onChangeText={setKomentar}
              multiline
            />
            <M3Button testID="submit-review" label="Kirim Ulasan" variant="filled" loading={submitReview.isPending} onPress={() => submitReview.mutate()} />
          </Pressable>
        </Pressable>
      </Modal>
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
  successCard: { backgroundColor: colors.brandPrimary, borderRadius: 20, padding: 20, alignItems: "center", gap: 4 },
  successLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.onBrandPrimary, opacity: 0.85 },
  noOrder: { fontFamily: fonts.heading, fontSize: 24, color: colors.onBrandPrimary, letterSpacing: 1 },
  statusNow: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onBrandPrimary },
  stepperCard: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 4 },
  stepCol: { flex: 1, alignItems: "center", gap: 6 },
  stepLineWrap: { flexDirection: "row", alignItems: "center", width: "100%", justifyContent: "center" },
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.brandPrimary },
  node: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  nodeDone: { backgroundColor: colors.brandPrimary },
  stepText: { fontFamily: fonts.body, fontSize: 10, color: colors.muted, textAlign: "center", paddingHorizontal: 2 },
  stepTextDone: { color: colors.onSurface, fontFamily: fonts.bodyMedium },
  resiBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  resiText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.onBrandTertiary },
  resiBold: { fontFamily: fonts.bodyMedium },
  historyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  historyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 4 },
  historyStatus: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  historyTime: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 1 },
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  reviewCard: { width: "100%", maxWidth: 360, backgroundColor: colors.surfaceSecondary, borderRadius: 24, padding: 20, gap: 12 },
  reviewInput: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 14,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
  },
}));
