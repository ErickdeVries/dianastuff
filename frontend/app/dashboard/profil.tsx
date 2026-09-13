import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

type Rekening = { bank: string; no_rek: string; a_n: string };
type Profil = {
  nama_toko: string;
  logo_url?: string | null;
  banner_url?: string | null;
  rekening_bank: Rekening[];
  whatsapp: string;
};

export default function ProfilScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data } = useQuery<Profil>({
    queryKey: ["profil_admin"],
    queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }),
  });

  const [namaToko, setNamaToko] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState("");
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);

  useEffect(() => {
    if (data) {
      setNamaToko(data.nama_toko ?? "");
      setLogo(data.logo_url ?? null);
      setBanner(data.banner_url ?? null);
      setWhatsapp(data.whatsapp ?? "");
      setRekening(data.rekening_bank ?? []);
    }
  }, [data]);

  const handleUpload = async (target: "logo" | "banner") => {
    setError(null);
    setUploading(target);
    try {
      const res = await pickAndUploadImages(1);
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
      if (res.urls[0]) {
        if (target === "logo") setLogo(res.urls[0]);
        else setBanner(res.urls[0]);
      }
    } finally {
      setUploading(null);
    }
  };

  const updateRekening = (i: number, field: keyof Rekening, value: string) => {
    setRekening((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const onSave = async () => {
    setError(null);
    setSuccess(false);
    if (!whatsapp.trim()) {
      setError("Nomor WA wajib diisi");
      return;
    }
    if (!namaToko.trim()) {
      setError("Nama toko wajib diisi");
      return;
    }
    setSaving(true);
    try {
      const cleanRek = rekening.filter((r) => r.bank.trim() || r.no_rek.trim() || r.a_n.trim());
      await apiRequest("/api/profil_admin", {
        method: "PUT",
        body: {
          nama_toko: namaToko.trim(),
          logo_url: logo,
          banner_url: banner,
          whatsapp: whatsapp.trim(),
          rekening_bank: cleanRek,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["profil_admin"] });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      bottomOffset={24}
    >
      {/* Banner uploader */}
      <Text style={styles.label}>Banner Toko</Text>
      <Pressable testID="upload-banner" style={styles.bannerBox} onPress={() => handleUpload("banner")}>
        {banner ? (
          <Image source={{ uri: resolveImageUrl(banner) }} style={styles.bannerImg} contentFit="cover" />
        ) : null}
        {banner ? (
          // Banner already set: show a small corner edit chip so the image stays visible.
          <View style={styles.editChip} testID="edit-banner-chip">
            <MaterialDesignIcons
              name={uploading === "banner" ? "loading" : "pencil"}
              size={16}
              color={colors.onBrandPrimary}
            />
          </View>
        ) : (
          <View style={styles.bannerOverlay}>
            <MaterialDesignIcons
              name={uploading === "banner" ? "loading" : "image-plus"}
              size={26}
              color={colors.onBrandPrimary}
            />
            <Text style={styles.overlayText}>Unggah Banner</Text>
          </View>
        )}
      </Pressable>

      {/* Logo uploader */}
      <Text style={styles.label}>Logo Toko</Text>
      <View style={styles.logoRow}>
        <Pressable testID="upload-logo" style={styles.logoBox} onPress={() => handleUpload("logo")}>
          {logo ? (
            <Image source={{ uri: resolveImageUrl(logo) }} style={styles.logoImg} contentFit="cover" />
          ) : (
            <MaterialDesignIcons name="image-plus" size={26} color={colors.muted} />
          )}
        </Pressable>
        <Text style={styles.hint}>
          {uploading === "logo" ? "Mengunggah..." : "Ketuk untuk mengunggah logo (persegi)."}
        </Text>
      </View>

      <M3TextField
        label="Nama Toko *"
        icon="storefront-outline"
        value={namaToko}
        onChangeText={setNamaToko}
        containerTestID="profil-nama-toko"
      />
      <M3TextField
        label="Nomor WhatsApp *"
        icon="whatsapp"
        placeholder="6285312812452"
        keyboardType="phone-pad"
        value={whatsapp}
        onChangeText={setWhatsapp}
        containerTestID="profil-whatsapp"
      />

      {/* Rekening bank */}
      <View style={styles.rekHeader}>
        <Text style={styles.label}>Rekening Bank</Text>
        <Pressable
          testID="add-rekening"
          onPress={() => setRekening((p) => [...p, { bank: "", no_rek: "", a_n: "" }])}
          style={styles.addRek}
        >
          <MaterialDesignIcons name="plus" size={18} color={colors.brandPrimary} />
          <Text style={styles.addRekText}>Tambah</Text>
        </Pressable>
      </View>

      {rekening.map((r, i) => (
        <View key={i} style={styles.rekCard} testID={`rekening-${i}`}>
          <View style={styles.rekTop}>
            <Text style={styles.rekTitle}>Rekening {i + 1}</Text>
            <Pressable testID={`remove-rekening-${i}`} onPress={() => setRekening((p) => p.filter((_, idx) => idx !== i))}>
              <MaterialDesignIcons name="close" size={20} color={colors.error} />
            </Pressable>
          </View>
          <M3TextField label="Bank" placeholder="BCA" value={r.bank} onChangeText={(v) => updateRekening(i, "bank", v)} />
          <M3TextField label="No. Rekening" placeholder="1234567890" keyboardType="number-pad" value={r.no_rek} onChangeText={(v) => updateRekening(i, "no_rek", v)} />
          <M3TextField label="Atas Nama" placeholder="Diana" value={r.a_n} onChangeText={(v) => updateRekening(i, "a_n", v)} />
        </View>
      ))}

      {error ? (
        <View style={styles.alert} testID="profil-error">
          <MaterialDesignIcons name="alert-circle-outline" size={18} color={colors.onError} />
          <Text style={styles.alertText}>{error}</Text>
          {error.includes("Pengaturan") ? (
            <Pressable onPress={() => Linking.openSettings()} testID="open-settings">
              <Text style={styles.settingsLink}>Buka</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {success ? (
        <View style={styles.successBox} testID="profil-success">
          <MaterialDesignIcons name="check-circle-outline" size={18} color={colors.onSuccess} />
          <Text style={styles.successText}>Pengaturan toko tersimpan.</Text>
        </View>
      ) : null}

      <M3Button testID="save-profil" label="Simpan Perubahan" variant="filled" loading={saving} onPress={onSave} style={{ marginTop: 8 }} />
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: 14 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  bannerBox: {
    height: 140,
    borderRadius: 18,
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  bannerImg: { ...StyleSheetAbsolute() },
  editChip: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerOverlay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  overlayText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onBrandPrimary },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  logoBox: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: 84, height: 84 },
  hint: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  rekHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  addRek: { flexDirection: "row", alignItems: "center", gap: 4 },
  addRekText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  rekCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14, gap: 12 },
  rekTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rekTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.error,
    borderRadius: 12,
    padding: 12,
  },
  alertText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onError },
  settingsLink: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onError, textDecorationLine: "underline" },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.success,
    borderRadius: 12,
    padding: 12,
  },
  successText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSuccess },
}));

function StyleSheetAbsolute() {
  return { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, width: "100%" as const, height: "100%" as const };
}
