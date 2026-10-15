import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";

type VoucherTipe = "persen" | "nominal" | "ongkir_persen";

type Voucher = {
  id: string;
  kode: string;
  tipe: VoucherTipe;
  nilai: number;
  min_belanja: number;
  maks_potongan: number;
  kuota: number;
  terpakai: number;
  aktif: boolean;
  kadaluarsa: string | null;
};

const EMPTY = { id: "", kode: "", tipe: "persen" as VoucherTipe, nilai: "", min_belanja: "", maks_potongan: "", kuota: "", aktif: true, kadaluarsa: "" };

export default function VoucherScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Voucher | null>(null);

  const { data, isLoading } = useQuery<Voucher[]>({
    queryKey: ["admin", "vouchers"],
    queryFn: () => apiRequest<Voucher[]>("/api/admin/vouchers"),
  });

  const openAdd = () => {
    setForm({ ...EMPTY });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (v: Voucher) => {
    setForm({
      id: v.id,
      kode: v.kode,
      tipe: v.tipe,
      nilai: String(v.nilai),
      min_belanja: v.min_belanja ? String(v.min_belanja) : "",
      maks_potongan: v.maks_potongan ? String(v.maks_potongan) : "",
      kuota: v.kuota ? String(v.kuota) : "",
      aktif: v.aktif,
      kadaluarsa: v.kadaluarsa ?? "",
    });
    setError(null);
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kode: form.kode.trim().toUpperCase(),
        tipe: form.tipe,
        nilai: parseFloat(form.nilai) || 0,
        min_belanja: parseFloat(form.min_belanja) || 0,
        maks_potongan: parseFloat(form.maks_potongan) || 0,
        kuota: parseInt(form.kuota, 10) || 0,
        aktif: form.aktif,
        kadaluarsa: form.kadaluarsa.trim() || null,
      };
      return form.id
        ? apiRequest(`/api/admin/vouchers/${form.id}`, { method: "PUT", body })
        : apiRequest("/api/admin/vouchers", { method: "POST", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "vouchers"] });
      setModalOpen(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal menyimpan voucher."),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/vouchers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "vouchers"] });
      setToDelete(null);
    },
  });

  const onSubmit = () => {
    setError(null);
    if (!form.kode.trim()) return setError("Kode voucher wajib diisi.");
    const nilai = parseFloat(form.nilai) || 0;
    if (nilai <= 0) return setError("Nilai diskon harus lebih dari 0.");
    if ((form.tipe === "persen" || form.tipe === "ongkir_persen") && nilai > 100) return setError("Diskon persen maksimal 100.");
    save.mutate();
  };

  return (
    <View style={styles.root}>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}>
          <Text style={styles.intro}>Buat kode voucher untuk pembeli. Potongan otomatis diterapkan saat checkout.</Text>
          {(data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="ticket-percent-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada voucher</Text>
            </View>
          ) : (
            (data ?? []).map((v) => (
              <View key={v.id} style={styles.card} testID={`voucher-${v.kode}`}>
                <View style={styles.cardTop}>
                  <View style={styles.kodeChip}>
                    <MaterialDesignIcons name="ticket-confirmation-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.kodeText}>{v.kode}</Text>
                  </View>
                  <View style={[styles.statusChip, { backgroundColor: v.aktif ? colors.brandTertiary : colors.surfaceTertiary }]}>
                    <Text style={[styles.statusText, { color: v.aktif ? colors.brandPrimary : colors.muted }]}>{v.aktif ? "Aktif" : "Nonaktif"}</Text>
                  </View>
                </View>
                <Text style={styles.value}>
                  {v.tipe === "persen" ? `Diskon ${v.nilai}%`
                    : v.tipe === "ongkir_persen" ? `Diskon Ongkir ${v.nilai}%${v.maks_potongan > 0 ? ` (maks ${formatRupiah(v.maks_potongan)})` : ""}`
                    : `Potongan ${formatRupiah(v.nilai)}`}
                </Text>
                <Text style={styles.meta}>
                  {v.min_belanja > 0 ? `Min. belanja ${formatRupiah(v.min_belanja)}` : "Tanpa minimal belanja"}
                  {v.kuota > 0 ? ` · Terpakai ${v.terpakai}/${v.kuota}` : ` · Terpakai ${v.terpakai} (tanpa batas)`}
                </Text>
                {v.kadaluarsa ? <Text style={styles.meta}>Berlaku sampai {v.kadaluarsa}</Text> : null}
                <View style={styles.actions}>
                  <Pressable testID={`edit-${v.kode}`} onPress={() => openEdit(v)} style={styles.actionBtn}>
                    <MaterialDesignIcons name="pencil-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.actionText}>Ubah</Text>
                  </Pressable>
                  <Pressable testID={`delete-${v.kode}`} onPress={() => setToDelete(v)} style={styles.actionBtn}>
                    <MaterialDesignIcons name="trash-can-outline" size={18} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Hapus</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Pressable testID="add-voucher" style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={openAdd}>
        <MaterialDesignIcons name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{form.id ? "Ubah Voucher" : "Tambah Voucher"}</Text>
            <KeyboardAwareScrollView bottomOffset={16} contentContainerStyle={{ gap: 12 }}>
              <M3TextField label="Kode Voucher *" autoCapitalize="characters" value={form.kode} onChangeText={(t) => setForm((f) => ({ ...f, kode: t }))} containerTestID="vf-kode" />
              <Text style={styles.fieldLabel}>Tipe Diskon</Text>
              <View style={styles.tipeRow}>
                {(["persen", "nominal", "ongkir_persen"] as const).map((t) => {
                  const active = form.tipe === t;
                  const label = t === "persen" ? "Persen (%)" : t === "nominal" ? "Nominal (Rp)" : "Ongkir (%)";
                  return (
                    <Pressable key={t} testID={`vf-tipe-${t}`} onPress={() => setForm((f) => ({ ...f, tipe: t }))} style={[styles.tipeChip, active && styles.tipeChipActive]}>
                      <Text style={[styles.tipeText, active && styles.tipeTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <M3TextField label={form.tipe === "nominal" ? "Besar Potongan (Rp)" : form.tipe === "ongkir_persen" ? "Diskon Ongkir (%)" : "Besar Diskon (%)"} keyboardType="number-pad" value={form.nilai} onChangeText={(t) => setForm((f) => ({ ...f, nilai: t }))} containerTestID="vf-nilai" />
              {form.tipe === "ongkir_persen" ? (
                <M3TextField label="Maksimal Potongan Ongkir (Rp)" keyboardType="number-pad" placeholder="0 = tanpa batas" value={form.maks_potongan} onChangeText={(t) => setForm((f) => ({ ...f, maks_potongan: t }))} containerTestID="vf-maks" />
              ) : null}
              <M3TextField label="Minimal Belanja (Rp)" keyboardType="number-pad" placeholder="0 = tanpa minimal" value={form.min_belanja} onChangeText={(t) => setForm((f) => ({ ...f, min_belanja: t }))} containerTestID="vf-min" />
              <M3TextField label="Kuota Pemakaian" keyboardType="number-pad" placeholder="0 = tanpa batas" value={form.kuota} onChangeText={(t) => setForm((f) => ({ ...f, kuota: t }))} containerTestID="vf-kuota" />
              <M3TextField label="Kadaluarsa (YYYY-MM-DD)" placeholder="Kosongkan jika tanpa batas" value={form.kadaluarsa} onChangeText={(t) => setForm((f) => ({ ...f, kadaluarsa: t }))} containerTestID="vf-exp" />
              <View style={styles.switchRow}>
                <Text style={styles.fieldLabel}>Aktifkan Voucher</Text>
                <Switch testID="vf-aktif" value={form.aktif} onValueChange={(v) => setForm((f) => ({ ...f, aktif: v }))} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surfaceSecondary} />
              </View>
              {error ? <Text style={styles.error} testID="vf-error">{error}</Text> : null}
            </KeyboardAwareScrollView>
            <View style={styles.modalActions}>
              <M3Button testID="vf-cancel" label="Batal" variant="tonal" onPress={() => setModalOpen(false)} style={{ flex: 1 }} />
              <M3Button testID="vf-save" label="Simpan" variant="filled" loading={save.isPending} onPress={onSubmit} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!toDelete}
        title="Hapus Voucher"
        message={`Yakin ingin menghapus voucher "${toDelete?.kode}"?`}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 14 },
  intro: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 60 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kodeChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  kodeText: { fontFamily: fonts.heading, fontSize: 15, color: colors.brandPrimary, letterSpacing: 1 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  value: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.onSurface, marginTop: 4 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  actions: { flexDirection: "row", gap: 20, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  fab: { position: "absolute", right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "90%", gap: 12 },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  modalTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  fieldLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  tipeRow: { flexDirection: "row", gap: 10 },
  tipeChip: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tipeChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  tipeText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  tipeTextActive: { color: colors.brandPrimary },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14 },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
  modalActions: { flexDirection: "row", gap: 12 },
}));
