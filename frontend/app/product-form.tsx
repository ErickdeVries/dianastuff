import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

const MAX_PHOTOS = 5;

type Product = {
  id: string;
  kategori: string;
  nama_produk: string;
  deskripsi: string;
  harga: number;
  stok: number;
  berat_gram: number;
  bisa_po: boolean;
  foto_urls: string[];
};

export default function ProductForm() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const { data } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => apiRequest<Product>(`/api/products/${id}`, { auth: false }),
    enabled: isEdit,
  });

  const [kategori, setKategori] = useState("");
  const [nama, setNama] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  const [harga, setHarga] = useState("");
  const [stok, setStok] = useState("");
  const [berat, setBerat] = useState("");
  const [bisaPo, setBisaPo] = useState(false);
  const [fotos, setFotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (data) {
      setKategori(data.kategori ?? "");
      setNama(data.nama_produk ?? "");
      setDeskripsi(data.deskripsi ?? "");
      setHarga(String(data.harga ?? ""));
      setStok(String(data.stok ?? ""));
      setBerat(String(data.berat_gram ?? ""));
      setBisaPo(!!data.bisa_po);
      setFotos(data.foto_urls ?? []);
    }
  }, [data]);

  const addPhotos = async () => {
    setError(null);
    const remaining = MAX_PHOTOS - fotos.length;
    if (remaining <= 0) return;
    setUploading(true);
    try {
      const res = await pickAndUploadImages(remaining);
      if (res.permissionDenied) {
        setError(
          res.canAskAgain
            ? "Izin galeri diperlukan untuk mengunggah foto."
            : "Izin galeri diblokir. Buka Pengaturan untuk mengaktifkan.",
        );
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.urls.length) setFotos((p) => [...p, ...res.urls].slice(0, MAX_PHOTOS));
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    setError(null);
    if (!nama.trim()) {
      setError("Nama produk wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        kategori: kategori.trim(),
        nama_produk: nama.trim(),
        deskripsi: deskripsi.trim(),
        harga: parseFloat(harga) || 0,
        stok: parseInt(stok, 10) || 0,
        berat_gram: parseInt(berat, 10) || 0,
        bisa_po: bisaPo,
        foto_urls: fotos,
      };
      if (isEdit) {
        await apiRequest(`/api/products/${id}`, { method: "PUT", body });
      } else {
        await apiRequest("/api/products", { method: "POST", body });
      }
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan produk.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="product-form-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? "Edit Produk" : "Tambah Produk"}</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        bottomOffset={24}
      >
        <Text style={styles.label}>Foto Produk ({fotos.length}/{MAX_PHOTOS})</Text>
        <View style={styles.photoRow}>
          {fotos.map((f, i) => (
            <View key={i} style={styles.photoWrap} testID={`product-photo-${i}`}>
              <Image source={{ uri: resolveImageUrl(f) }} style={styles.photo} contentFit="cover" />
              <Pressable testID={`remove-photo-${i}`} style={styles.removePhoto} onPress={() => setFotos((p) => p.filter((_, idx) => idx !== i))}>
                <MaterialDesignIcons name="close" size={14} color={colors.onError} />
              </Pressable>
            </View>
          ))}
          {fotos.length < MAX_PHOTOS ? (
            <Pressable testID="add-photo" style={styles.addPhoto} onPress={addPhotos}>
              <MaterialDesignIcons name={uploading ? "loading" : "camera-plus-outline"} size={24} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
        </View>

        <M3TextField label="Kategori" icon="shape-outline" placeholder="Tas, Baju, dll" value={kategori} onChangeText={setKategori} containerTestID="product-kategori" />
        <M3TextField label="Nama Produk *" icon="tag-outline" value={nama} onChangeText={setNama} containerTestID="product-nama" />
        <M3TextField label="Deskripsi" placeholder="Deskripsi produk" value={deskripsi} onChangeText={setDeskripsi} multiline numberOfLines={4} containerTestID="product-deskripsi" style={{ minHeight: 90, textAlignVertical: "top" }} />

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <M3TextField label="Harga (Rp)" keyboardType="number-pad" placeholder="0" value={harga} onChangeText={setHarga} containerTestID="product-harga" />
          </View>
          <View style={{ flex: 1 }}>
            <M3TextField label="Stok" keyboardType="number-pad" placeholder="0" value={stok} onChangeText={setStok} containerTestID="product-stok" />
          </View>
        </View>

        <M3TextField label="Berat (gram)" icon="weight-gram" keyboardType="number-pad" placeholder="0" value={berat} onChangeText={setBerat} containerTestID="product-berat" />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Bisa Pre-Order (PO)</Text>
            <Text style={styles.switchHint}>Aktifkan jika produk dapat dipesan meski stok habis.</Text>
          </View>
          <Switch
            testID="product-bisa-po"
            value={bisaPo}
            onValueChange={setBisaPo}
            trackColor={{ true: colors.brandPrimary, false: colors.border }}
            thumbColor={colors.surfaceSecondary}
          />
        </View>

        {error ? (
          <View style={styles.alert} testID="product-form-error">
            <MaterialDesignIcons name="alert-circle-outline" size={18} color={colors.onError} />
            <Text style={styles.alertText}>{error}</Text>
            {error.includes("Pengaturan") ? (
              <Pressable onPress={() => Linking.openSettings()} testID="open-settings">
                <Text style={styles.settingsLink}>Buka</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <M3Button testID="save-product" label={isEdit ? "Simpan Perubahan" : "Tambah Produk"} variant="filled" loading={saving} onPress={onSave} style={{ marginTop: 8 }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoWrap: { width: 76, height: 76 },
  photo: { width: 76, height: 76, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  removePhoto: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    width: 76,
    height: 76,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  rowFields: { flexDirection: "row", gap: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
  },
  switchLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  switchHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  alert: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.error, borderRadius: 12, padding: 12 },
  alertText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onError },
  settingsLink: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onError, textDecorationLine: "underline" },
}));
