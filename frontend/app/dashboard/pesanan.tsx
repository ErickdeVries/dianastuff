import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah, formatDate } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { STATUS_LABEL } from "@/src/utils/order";
import { printShippingLabel } from "@/src/utils/shipping-label";

type Profil = { nama_toko?: string; whatsapp?: string };

type Order = {
  id: string;
  no_order: string;
  total: number;
  status: string;
  no_resi?: string | null;
  kurir?: string;
  alamat: { nama?: string; wa?: string; alamat?: string; kota?: string; kode_pos?: string };
  items: { nama_produk: string; qty: number }[];
  bukti_bayar_url?: string | null;
  created_at?: string | null;
  courier_company?: string | null;
  courier_type?: string | null;
  shipping_coordinate?: { latitude?: number; longitude?: number } | null;
  biteship_order_id?: string | null;
};

const isBiteshipOrder = (o: Order) => !!(o.courier_company && o.shipping_coordinate?.latitude);

export default function AdminPesananScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [resiMap, setResiMap] = useState<Record<string, string>>({});
  const [viewBukti, setViewBukti] = useState<string | null>(null);
  const [payloadOrderId, setPayloadOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("semua");

  const FILTERS: { key: string; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "menunggu_konfirmasi", label: "Perlu Konfirmasi" },
    { key: "sedang_dikemas", label: "Dikemas" },
    { key: "dikirim", label: "Dikirim" },
    { key: "selesai", label: "Selesai" },
  ];

  const { data, isLoading, refetch, isRefetching } = useQuery<Order[]>({
    queryKey: ["orders", "admin"],
    queryFn: () => apiRequest<Order[]>("/api/orders"),
  });

  const { data: profil } = useQuery<Profil>({
    queryKey: ["profil_admin"],
    queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }),
  });

  // Exact Biteship request payload for an order (for Biteship support tickets).
  const { data: payloadData, isFetching: payloadLoading } = useQuery<Record<string, any>>({
    queryKey: ["biteship-payload", payloadOrderId],
    queryFn: () => apiRequest<Record<string, any>>(`/api/admin/orders/${payloadOrderId}/biteship-payload`),
    enabled: !!payloadOrderId,
  });

  const onPrint = async (item: Order) => {
    try {
      await printShippingLabel({
        no_order: item.no_order,
        nama_toko: profil?.nama_toko,
        toko_wa: profil?.whatsapp,
        penerima: item.alamat?.nama,
        wa: item.alamat?.wa,
        alamat: item.alamat?.alamat,
        kota: item.alamat?.kota,
        kode_pos: item.alamat?.kode_pos,
        kurir: item.kurir,
        no_resi: item.no_resi,
        items: item.items,
      });
    } catch {
      toast.show("Gagal membuka print", "error");
    }
  };

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: string; no_resi?: string }) =>
      apiRequest(`/api/orders/${vars.id}/status`, { method: "PUT", body: { status: vars.status, no_resi: vars.no_resi } }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.show(`Status: ${STATUS_LABEL[vars.status]}`, "success");
    },
    onError: (e: any) => toast.show(e?.message || "Gagal ubah status", "error"),
  });

  const renderItem = ({ item }: { item: Order }) => {
    const totalQty = item.items.reduce((n, i) => n + i.qty, 0);
    return (
      <View style={styles.card} testID={`admin-order-${item.id}`}>
        <View style={styles.rowBetween}>
          <Text style={styles.noOrder}>{item.no_order}</Text>
          <Text style={styles.statusPill}>{STATUS_LABEL[item.status] ?? item.status}</Text>
        </View>
        <Text style={styles.meta}>{item.alamat?.nama} · {item.alamat?.kota}</Text>
        <Text style={styles.meta}>{totalQty} item · {formatRupiah(item.total)}</Text>
        {item.created_at ? <Text style={styles.meta}>{formatDate(item.created_at)}</Text> : null}

        {/* Product names */}
        <View style={styles.produkBox}>
          {item.items.map((it, i) => (
            <Text key={i} style={styles.produkLine} numberOfLines={1}>• {it.nama_produk} ({it.qty}x)</Text>
          ))}
        </View>

        {/* Full shipping address */}
        <View style={styles.addrBox}>
          <Text style={styles.addrName}>{item.alamat?.nama}{item.alamat?.wa ? ` · ${item.alamat.wa}` : ""}</Text>
          {item.alamat?.alamat ? <Text style={styles.addrText}>{item.alamat.alamat}</Text> : null}
          <Text style={styles.addrText}>{item.alamat?.kota} {item.alamat?.kode_pos ?? ""}</Text>
        </View>

        {item.bukti_bayar_url ? (
          <Pressable testID={`view-bukti-${item.id}`} onPress={() => setViewBukti(item.bukti_bayar_url!)} style={styles.buktiRow}>
            <Image source={{ uri: resolveImageUrl(item.bukti_bayar_url) }} style={styles.buktiThumb} contentFit="cover" />
            <Text style={styles.linkText}>Lihat Bukti Bayar</Text>
          </Pressable>
        ) : null}

        {item.no_resi ? <Text style={styles.meta}>Resi{item.kurir ? ` (${item.kurir})` : ""}: {item.no_resi}</Text> : null}

        {item.courier_company ? (
          <M3Button
            testID={`payload-${item.id}`}
            label="Payload Biteship (untuk support)"
            icon="code-json"
            variant="outlined"
            onPress={() => setPayloadOrderId(item.id)}
          />
        ) : null}

        {item.status === "sedang_dikemas" || item.status === "dikirim" ? (
          <M3Button
            testID={`print-label-${item.id}`}
            label="Cetak / Preview Label Alamat"
            icon="printer-outline"
            variant="tonal"
            onPress={() => onPrint(item)}
          />
        ) : null}

        {/* Contextual actions */}
        {item.status === "menunggu_konfirmasi" ? (
          <M3Button
            testID={`konfirmasi-${item.id}`}
            label="Konfirmasi Pembayaran Diterima"
            icon="cash-check"
            variant="filled"
            onPress={() => statusMut.mutate({ id: item.id, status: "sedang_dikemas" })}
          />
        ) : null}

        {item.status === "menunggu_pembayaran" ? (
          <M3Button
            testID={`proses-${item.id}`}
            label="Proses → Sedang Dikemas"
            icon="package-variant"
            variant="filled"
            onPress={() => statusMut.mutate({ id: item.id, status: "sedang_dikemas" })}
          />
        ) : null}

        {item.status === "sedang_dikemas" ? (
          isBiteshipOrder(item) ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.meta}>
                Kurir {item.courier_company}/{item.courier_type} akan di-booking otomatis via Biteship — resi kurir terisi sendiri.
              </Text>
              <M3Button
                testID={`kirim-${item.id}`}
                label="Kirim via Biteship → Dikirim"
                icon="truck-fast-outline"
                variant="filled"
                onPress={() => statusMut.mutate({ id: item.id, status: "dikirim" })}
              />
            </View>
          ) : (
          <View style={{ gap: 8 }}>
            <TextInput
              testID={`resi-input-${item.id}`}
              style={styles.resiInput}
              placeholder="Masukkan No. Resi"
              placeholderTextColor={colors.muted}
              value={resiMap[item.id] ?? ""}
              onChangeText={(v) => setResiMap((m) => ({ ...m, [item.id]: v }))}
            />
            <M3Button
              testID={`kirim-${item.id}`}
              label="Kirim → Dikirim"
              icon="truck-fast-outline"
              variant="filled"
              onPress={() => {
                const resi = (resiMap[item.id] ?? "").trim();
                if (!resi) { toast.show("Isi No. Resi dulu", "error"); return; }
                statusMut.mutate({ id: item.id, status: "dikirim", no_resi: resi });
              }}
            />
          </View>
          )
        ) : null}

        {item.status === "dikirim" ? (
          <View style={{ gap: 8 }}>
            <TextInput
              testID={`resi-edit-${item.id}`}
              style={styles.resiInput}
              placeholder="No. Resi"
              placeholderTextColor={colors.muted}
              value={resiMap[item.id] ?? item.no_resi ?? ""}
              onChangeText={(v) => setResiMap((m) => ({ ...m, [item.id]: v }))}
            />
            <M3Button
              testID={`update-resi-${item.id}`}
              label="Update Resi / Tracking"
              icon="truck-delivery-outline"
              variant="tonal"
              onPress={() => {
                const resi = (resiMap[item.id] ?? item.no_resi ?? "").trim();
                if (!resi) { toast.show("Isi No. Resi dulu", "error"); return; }
                statusMut.mutate({ id: item.id, status: "dikirim", no_resi: resi });
              }}
            />
            <M3Button
              testID={`selesai-${item.id}`}
              label="Tandai Selesai"
              icon="check-circle-outline"
              variant="filled"
              onPress={() => statusMut.mutate({ id: item.id, status: "selesai" })}
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            testID={`filter-${f.key}`}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={(data ?? []).filter((o) => filter === "semua" || o.status === filter)}
        keyExtractor={(o) => o.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="receipt-text-outline" size={56} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada pesanan</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={!!viewBukti} transparent animationType="fade" onRequestClose={() => setViewBukti(null)}>
        <Pressable style={styles.backdrop} onPress={() => setViewBukti(null)} testID="bukti-modal">
          {viewBukti ? <Image source={{ uri: resolveImageUrl(viewBukti) }} style={styles.buktiFull} contentFit="contain" /> : null}
        </Pressable>
      </Modal>

      <Modal visible={!!payloadOrderId} transparent animationType="fade" onRequestClose={() => setPayloadOrderId(null)}>
        <View style={styles.backdrop}>
          <View style={styles.payloadCard}>
            <Text style={styles.payloadTitle}>Payload Biteship — {payloadData?.no_order ?? ""}</Text>
            <ScrollView style={styles.payloadScroll}>
              <Text style={styles.payloadText} selectable>
                {payloadLoading ? "Memuat..." : JSON.stringify(payloadData ?? {}, null, 2)}
              </Text>
            </ScrollView>
            <M3Button label="Tutup" icon="close" variant="tonal" onPress={() => setPayloadOrderId(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  filterBar: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  noOrder: { fontFamily: fonts.heading, fontSize: 15, color: colors.onSurface },
  statusPill: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onBrandTertiary,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  payloadCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    width: "92%",
    maxHeight: "80%",
    gap: 12,
    alignSelf: "center",
  },
  payloadTitle: { fontFamily: fonts.heading, fontSize: 14, color: colors.onSurface },
  payloadScroll: { flexGrow: 0 },
  payloadText: { fontFamily: fonts.body, fontSize: 11, color: colors.onSurfaceSecondary },
  produkBox: {
    marginTop: 4,
    gap: 2,
  },
  produkLine: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurface },
  addrBox: {
    marginTop: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    padding: 10,
  },
  addrName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurface },
  addrText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 1 },
  buktiRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  buktiThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  linkText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  resiInput: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 20 },
  buktiFull: { width: "100%", height: "80%" },
}));
