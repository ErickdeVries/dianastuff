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

// A photo slot keeps its full AI-edit history so the admin can step back/forward.
type PhotoItem = { versions: string[]; idx: number };
const cur = (p: PhotoItem) => p.versions[p.idx];

type Product = {
  id: string;
  kategori: string;
  nama_produk: string;
  deskripsi: string;
  harga: number;
  harga_diskon?: number | null;
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
  const [hargaDiskon, setHargaDiskon] = useState("");
  const [stok, setStok] = useState("");
  const [berat, setBerat] = useState("");
  const [bisaPo, setBisaPo] = useState(false);
  const [fotos, setFotos] = useState<PhotoItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiInfoLoading, setAiInfoLoading] = useState(false);
  const [enhancingIndex, setEnhancingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (data) {
      setKategori(data.kategori ?? "");
      setNama(data.nama_produk ?? "");
      setDeskripsi(data.deskripsi ?? "");
      setHarga(String(data.harga ?? ""));
      setHargaDiskon(data.harga_diskon != null ? String(data.harga_diskon) : "");
      setStok(String(data.stok ?? ""));
      setBerat(String(data.berat_gram ?? ""));
      setBisaPo(!!data.bisa_po);
      setFotos((data.foto_urls ?? []).map((u) => ({ versions: [u], idx: 0 })));
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
      if (res.urls.length)
        setFotos((p) => [...p, ...res.urls.map((u) => ({ versions: [u], idx: 0 }))].slice(0, MAX_PHOTOS));
    } finally {
      setUploading(false);
    }
  };

  const generateInfo = async () => {
    setError(null);
    if (!fotos.length) {
      setError("Unggah minimal 1 foto dulu untuk memakai AI.");
      return;
    }
    setAiInfoLoading(true);
    try {
      const res = await apiRequest<{ nama_produk: string; deskripsi: string; kategori: string }>(
        "/api/admin/ai/product-info",
        { method: "POST", body: { foto_url: cur(fotos[0]) } },
      );
      if (res.nama_produk) setNama(res.nama_produk);
      if (res.deskripsi) setDeskripsi(res.deskripsi);
      if (res.kategori) setKategori(res.kategori);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membuat data dengan AI.");
    } finally {
      setAiInfoLoading(false);
    }
  };

  const enhancePhoto = async (index: number) => {
    setError(null);
    setEnhancingIndex(index);
    try {
      const res = await apiRequest<{ url: string }>("/api/admin/ai/enhance-photo", {
        method: "POST",
        body: { foto_url: cur(fotos[index]) },
      });
      if (res.url)
        setFotos((p) =>
          p.map((f, i) => {
            if (i !== index) return f;
            // append the new AI version after the current one, drop any "redo" branch
            const versions = [...f.versions.slice(0, f.idx + 1), res.url];
            return { versions, idx: versions.length - 1 };
          }),
        );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal mempercantik foto dengan AI.");
    } finally {
      setEnhancingIndex(null);
    }
  };

  const stepVersion = (index: number, delta: number) => {
    setFotos((p) =>
      p.map((f, i) => {
        if (i !== index) return f;
        const idx = Math.min(f.versions.length - 1, Math.max(0, f.idx + delta));
        return { ...f, idx };
      }),
    );
  };

  const onSave = async () => {
    setError(null);
    if (!nama.trim()) {
      setError("Nama produk wajib diisi.");
      return;
    }
    const hd = hargaDiskon.trim() ? parseFloat(hargaDiskon) || 0 : 0;
    if (hd > 0 && hd >= (parseFloat(harga) || 0)) {
      setError("Harga diskon harus lebih kecil dari harga normal.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        kategori: kategori.trim(),
        nama_produk: nama.trim(),
        deskripsi: deskripsi.trim(),
        harga: parseFloat(harga) || 0,
        harga_diskon: hargaDiskon.trim() ? parseFloat(hargaDiskon) || 0 : null,
        stok: parseInt(stok, 10) || 0,
        berat_gram: parseInt(berat, 10) || 0,
        bisa_po: bisaPo,
        foto_urls: fotos.map((f) => cur(f)),
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
            <View key={i} style={styles.photoCol} testID={`product-photo-${i}`}>
              <View style={styles.photoWrap}>
                <Image source={{ uri: resolveImageUrl(cur(f)) }} style={styles.photo} contentFit="cover" />
                <Pressable testID={`remove-photo-${i}`} style={styles.removePhoto} onPress={() => setFotos((p) => p.filter((_, idx) => idx !== i))}>
                  <MaterialDesignIcons name="close" size={14} color={colors.onError} />
                </Pressable>
                <Pressable
                  testID={`enhance-photo-${i}`}
                  style={styles.enhanceBtn}
                  disabled={enhancingIndex !== null}
                  onPress={() => enhancePhoto(i)}
                >
                  <MaterialDesignIcons name={enhancingIndex === i ? "loading" : "auto-fix"} size={14} color="#fff" />
                </Pressable>
              </View>
              {f.versions.length > 1 ? (
                <View style={styles.verRow}>
                  <Pressable
                    testID={`ver-prev-${i}`}
                    disabled={f.idx === 0}
                    onPress={() => stepVersion(i, -1)}
                    style={[styles.verBtn, f.idx === 0 && styles.verBtnOff]}
                    hitSlop={6}
                  >
                    <MaterialDesignIcons name="undo-variant" size={13} color={f.idx === 0 ? colors.muted : colors.brandPrimary} />
                  </Pressable>
                  <Text style={styles.verText}>{f.idx === 0 ? "Asli" : `v${f.idx}`}</Text>
                  <Pressable
                    testID={`ver-next-${i}`}
                    disabled={f.idx >= f.versions.length - 1}
                    onPress={() => stepVersion(i, 1)}
                    style={[styles.verBtn, f.idx >= f.versions.length - 1 && styles.verBtnOff]}
                    hitSlop={6}
                  >
                    <MaterialDesignIcons name="redo-variant" size={13} color={f.idx >= f.versions.length - 1 ? colors.muted : colors.brandPrimary} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
          {fotos.length < MAX_PHOTOS ? (
            <Pressable testID="add-photo" style={styles.addPhoto} onPress={addPhotos}>
              <MaterialDesignIcons name={uploading ? "loading" : "camera-plus-outline"} size={24} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          testID="ai-generate-info"
          style={[styles.aiBtn, (aiInfoLoading || !fotos.length) && styles.aiBtnDisabled]}
          disabled={aiInfoLoading || !fotos.length}
          onPress={generateInfo}
        >
          <MaterialDesignIcons name={aiInfoLoading ? "loading" : "auto-fix"} size={18} color={colors.onBrandPrimary} />
          <Text style={styles.aiBtnText}>{aiInfoLoading ? "Membuat dengan AI..." : "✨ Isi Nama, Deskripsi & Kategori (AI)"}</Text>
        </Pressable>
        <Text style={styles.aiHint}>
          AI membaca foto pertama untuk mengisi data produk. Ikon ✨ di tiap foto mempercantiknya jadi foto iklan.
        </Text>

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

        <M3TextField
          label="Harga Diskon (opsional)"
          icon="ticket-percent-outline"
          keyboardType="number-pad"
          placeholder="Kosongkan jika tanpa diskon"
          value={hargaDiskon}
          onChangeText={setHargaDiskon}
          containerTestID="product-harga-diskon"
        />
        {(() => {
          const h = parseFloat(harga) || 0;
          const hd = hargaDiskon.trim() ? parseFloat(hargaDiskon) || 0 : 0;
          if (hd > 0 && hd < h) {
            const pct = Math.round((1 - hd / h) * 100);
            return <Text style={styles.discHint}>Diskon {pct}% — harga normal dicoret di etalase.</Text>;
          }
          return <Text style={styles.aiHint}>Isi harga setelah diskon. Harga normal akan tampil dicoret di etalase (gaya Shopee).</Text>;
        })()}

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
  photoCol: { alignItems: "center", gap: 4 },
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
  enhanceBtn: {
    position: "absolute",
    bottom: 4,
    left: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  aiBtnDisabled: { opacity: 0.5 },
  aiBtnText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onBrandPrimary },
  aiHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: -6 },
  discHint: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.brandPrimary, marginTop: -6 },
  verRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  verBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  verBtnOff: { opacity: 0.4 },
  verText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.muted, minWidth: 22, textAlign: "center" },
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
