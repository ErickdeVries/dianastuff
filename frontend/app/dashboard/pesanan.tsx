import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";
import { STATUS_LABEL } from "@/src/utils/order";

type Order = {
  id: string;
  no_order: string;
  total: number;
  status: string;
  no_resi?: string | null;
  kurir?: string;
  alamat: { nama?: string; kota?: string };
  items: { nama_produk: string; qty: number }[];
  bukti_bayar_url?: string | null;
};

export default function AdminPesananScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [resiMap, setResiMap] = useState<Record<string, string>>({});
  const [viewBukti, setViewBukti] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery<Order[]>({
    queryKey: ["orders", "admin"],
    queryFn: () => apiRequest<Order[]>("/api/orders"),
  });

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

        {item.bukti_bayar_url ? (
          <Pressable testID={`view-bukti-${item.id}`} onPress={() => setViewBukti(item.bukti_bayar_url!)} style={styles.buktiRow}>
            <Image source={{ uri: resolveImageUrl(item.bukti_bayar_url) }} style={styles.buktiThumb} contentFit="cover" />
            <Text style={styles.linkText}>Lihat Bukti Bayar</Text>
          </Pressable>
        ) : null}

        {item.no_resi ? <Text style={styles.meta}>Resi ({item.kurir}): {item.no_resi}</Text> : null}

        {/* Contextual actions */}
        {(item.status === "menunggu_pembayaran" || item.status === "menunggu_konfirmasi") ? (
          <M3Button
            testID={`proses-${item.id}`}
            label="Proses → Sedang Dikemas"
            icon="package-variant"
            variant="filled"
            onPress={() => statusMut.mutate({ id: item.id, status: "sedang_dikemas" })}
          />
        ) : null}

        {item.status === "sedang_dikemas" ? (
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
        ) : null}

        {item.status === "dikirim" ? (
          <M3Button
            testID={`selesai-${item.id}`}
            label="Tandai Selesai"
            icon="check-circle-outline"
            variant="tonal"
            onPress={() => statusMut.mutate({ id: item.id, status: "selesai" })}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
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
            </View>
          ) : null
        }
      />

      <Modal visible={!!viewBukti} transparent animationType="fade" onRequestClose={() => setViewBukti(null)}>
        <Pressable style={styles.backdrop} onPress={() => setViewBukti(null)} testID="bukti-modal">
          {viewBukti ? <Image source={{ uri: resolveImageUrl(viewBukti) }} style={styles.buktiFull} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
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
