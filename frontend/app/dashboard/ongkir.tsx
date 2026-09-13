import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";

type Ongkir = {
  id: string;
  kota: string;
  kurir: string;
  harga: number;
};

type Profil = { kurir_list?: string[] };

export default function OngkirScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<Ongkir | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [kota, setKota] = useState("");
  const [kurir, setKurir] = useState("");
  const [harga, setHarga] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Ongkir | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery<Ongkir[]>({
    queryKey: ["ongkir"],
    queryFn: () => apiRequest<Ongkir[]>("/api/admin/ongkir"),
  });

  const { data: profil } = useQuery<Profil>({
    queryKey: ["profil_admin"],
    queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }),
  });
  const kurirList = profil?.kurir_list ?? [];

  const openAdd = () => {
    setEditing(null);
    setKota("");
    setKurir(kurirList[0] ?? "");
    setHarga("");
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (o: Ongkir) => {
    setEditing(o);
    setKota(o.kota);
    setKurir(o.kurir);
    setHarga(String(o.harga));
    setFormError(null);
    setModalOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: (payload: { kota: string; kurir: string; harga: number }) =>
      editing
        ? apiRequest(`/api/admin/ongkir/${editing.id}`, { method: "PUT", body: payload })
        : apiRequest("/api/admin/ongkir", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ongkir"] });
      setModalOpen(false);
      toast.show(editing ? "Tarif diperbarui" : "Tarif ditambahkan", "success");
    },
    onError: (e: any) => setFormError(e instanceof ApiError ? e.message : "Gagal menyimpan tarif"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/ongkir/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ongkir"] });
      setToDelete(null);
      toast.show("Tarif dihapus", "success");
    },
    onError: (e: any) => toast.show(e?.message || "Gagal menghapus", "error"),
  });

  const onSave = () => {
    setFormError(null);
    if (!kota.trim() || !kurir.trim()) {
      setFormError("Kota dan kurir wajib diisi.");
      return;
    }
    const hargaNum = parseInt(harga.replace(/\D/g, ""), 10);
    if (isNaN(hargaNum) || hargaNum < 0) {
      setFormError("Harga ongkir tidak valid.");
      return;
    }
    saveMut.mutate({ kota: kota.trim(), kurir: kurir.trim(), harga: hargaNum });
  };

  const renderItem = ({ item }: { item: Ongkir }) => (
    <View style={styles.card} testID={`ongkir-${item.id}`}>
      <View style={styles.iconBox}>
        <MaterialDesignIcons name="truck-outline" size={22} color={colors.onBrandTertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.city}>{item.kota}</Text>
        <Text style={styles.meta}>{item.kurir}</Text>
      </View>
      <Text style={styles.price}>{formatRupiah(item.harga)}</Text>
      <View style={styles.actions}>
        <Pressable testID={`edit-ongkir-${item.id}`} onPress={() => openEdit(item)} style={styles.iconBtn}>
          <MaterialDesignIcons name="pencil-outline" size={18} color={colors.brandPrimary} />
        </Pressable>
        <Pressable testID={`delete-ongkir-${item.id}`} onPress={() => setToDelete(item)} style={styles.iconBtn}>
          <MaterialDesignIcons name="trash-can-outline" size={18} color={colors.error} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <Text style={styles.hint}>
        Atur ongkir manual per kota & kurir. Tarif ini dipakai otomatis saat pembeli menekan tombol Cek Ongkir di checkout.
      </Text>

      <FlatList
        data={data ?? []}
        keyExtractor={(o) => o.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="truck-off" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada tarif ongkir</Text>
            </View>
          ) : null
        }
      />

      <Pressable testID="add-ongkir-fab" onPress={openAdd} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <MaterialDesignIcons name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editing ? "Edit Tarif Ongkir" : "Tambah Tarif Ongkir"}</Text>
            <KeyboardAwareScrollView bottomOffset={20} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ gap: 16 }}>
                <M3TextField
                  label="Kota Tujuan"
                  icon="map-marker-outline"
                  placeholder="cth: Jakarta"
                  value={kota}
                  onChangeText={setKota}
                  containerTestID="ongkir-kota-input"
                />

                <View style={{ gap: 6 }}>
                  <Text style={styles.pickerLabel}>Kurir</Text>
                  {kurirList.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {kurirList.map((k) => (
                        <Pressable
                          key={k}
                          testID={`ongkir-kurir-${k}`}
                          onPress={() => setKurir(k)}
                          style={[styles.chip, kurir === k && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, kurir === k && styles.chipTextActive]}>{k}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : (
                    <M3TextField
                      label="Nama Kurir"
                      icon="truck-outline"
                      placeholder="cth: JNE"
                      value={kurir}
                      onChangeText={setKurir}
                      containerTestID="ongkir-kurir-input"
                    />
                  )}
                </View>

                <M3TextField
                  label="Harga Ongkir (Rp)"
                  icon="cash"
                  placeholder="cth: 15000"
                  keyboardType="number-pad"
                  value={harga}
                  onChangeText={setHarga}
                  containerTestID="ongkir-harga-input"
                />

                {formError ? <Text style={styles.error}>{formError}</Text> : null}

                <M3Button
                  testID="save-ongkir"
                  label={editing ? "Simpan Perubahan" : "Tambah Tarif"}
                  variant="filled"
                  loading={saveMut.isPending}
                  onPress={onSave}
                />
                <M3Button
                  testID="cancel-ongkir"
                  label="Batal"
                  variant="text"
                  onPress={() => setModalOpen(false)}
                />
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!toDelete}
        title="Hapus Tarif"
        message={`Yakin hapus tarif ${toDelete?.kota} · ${toDelete?.kurir}?`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMut.mutate(toDelete.id)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 18,
    padding: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  city: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  price: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  actions: { flexDirection: "row", gap: 4 },
  iconBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.surfaceTertiary,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  fab: {
    position: "absolute",
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "85%",
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: 14,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.onSurface,
    marginBottom: 16,
  },
  pickerLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.onSurfaceTertiary,
    marginLeft: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
  },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
}));
