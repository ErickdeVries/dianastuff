import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

type Customer = { user_id: string; nama?: string | null; username?: string | null };
type Broadcast = {
  id: string; title: string; message: string; image_url?: string | null;
  action_url?: string | null; target: string; recipients_count: number; created_at: string | null;
};

const LINK_PRESETS = [
  { label: "Etalase", value: "/toko" },
  { label: "Live", value: "/live" },
  { label: "Keranjang", value: "/keranjang" },
];

export default function PromoScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [actionUrl, setActionUrl] = useState("");
  const [target, setTarget] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["admin", "customers"],
    queryFn: () => apiRequest<Customer[]>("/api/admin/customers"),
    enabled: target === "selected",
  });

  const { data: history, isLoading } = useQuery<Broadcast[]>({
    queryKey: ["admin", "broadcast"],
    queryFn: () => apiRequest<Broadcast[]>("/api/admin/broadcast"),
  });

  const pickBanner = async () => {
    setUploading(true);
    try {
      const res = await pickAndUploadImages(1);
      if (res.urls.length) setBanner(res.urls[0]);
    } finally {
      setUploading(false);
    }
  };

  const send = useMutation({
    mutationFn: () =>
      apiRequest<Broadcast>("/api/admin/broadcast", {
        method: "POST",
        body: {
          title: title.trim(),
          message: message.trim(),
          image_url: banner,
          action_url: actionUrl.trim() || null,
          target,
          user_ids: target === "selected" ? selected : [],
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "broadcast"] });
      setOk(`Terkirim ke ${res.recipients_count} pembeli.`);
      setError(null);
      setTitle(""); setMessage(""); setBanner(null); setActionUrl(""); setSelected([]); setTarget("all");
    },
    onError: (e) => { setError(e instanceof ApiError ? e.message : "Gagal mengirim."); setOk(null); },
  });

  const onSend = () => {
    setError(null); setOk(null);
    if (!title.trim()) return setError("Judul wajib diisi.");
    if (!message.trim()) return setError("Pesan wajib diisi.");
    if (target === "selected" && selected.length === 0) return setError("Pilih minimal 1 pelanggan.");
    send.mutate();
  };

  const toggle = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.intro}>Kirim banner promosi sebagai push notification ke HP pembeli.</Text>

      <Pressable testID="promo-banner" onPress={pickBanner} style={styles.banner}>
        {uploading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : banner ? (
          <Image source={{ uri: resolveImageUrl(banner) }} style={styles.bannerImg} contentFit="cover" />
        ) : (
          <View style={styles.bannerEmpty}>
            <MaterialDesignIcons name="image-plus" size={30} color={colors.muted} />
            <Text style={styles.bannerText}>Tambah Banner (opsional)</Text>
          </View>
        )}
      </Pressable>

      <M3TextField label="Judul" value={title} onChangeText={setTitle} containerTestID="promo-title" />
      <M3TextField label="Pesan" value={message} onChangeText={setMessage} multiline containerTestID="promo-message" />

      <Text style={styles.label}>Link Tujuan (saat notif ditekan)</Text>
      <View style={styles.presetRow}>
        {LINK_PRESETS.map((p) => (
          <Pressable key={p.value} onPress={() => setActionUrl(p.value)} style={[styles.presetChip, actionUrl === p.value && styles.presetChipActive]}>
            <Text style={[styles.presetText, actionUrl === p.value && styles.presetTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <M3TextField label="URL (mis. /toko)" value={actionUrl} onChangeText={setActionUrl} containerTestID="promo-url" />

      <Text style={styles.label}>Kirim ke</Text>
      <View style={styles.targetRow}>
        {(["all", "selected"] as const).map((t) => (
          <Pressable key={t} testID={`target-${t}`} onPress={() => setTarget(t)} style={[styles.targetChip, target === t && styles.targetChipActive]}>
            <MaterialDesignIcons name={t === "all" ? "account-group" : "account-check"} size={18} color={target === t ? colors.brandPrimary : colors.muted} />
            <Text style={[styles.targetText, target === t && styles.targetTextActive]}>{t === "all" ? "Semua Pembeli" : "Pilih Pelanggan"}</Text>
          </Pressable>
        ))}
      </View>

      {target === "selected" ? (
        <View style={styles.custBox}>
          {(customers ?? []).map((c) => {
            const on = selected.includes(c.user_id);
            return (
              <Pressable key={c.user_id} testID={`cust-${c.user_id}`} onPress={() => toggle(c.user_id)} style={styles.custRow}>
                <MaterialDesignIcons name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
                <Text style={styles.custName}>{c.nama || c.username || c.user_id}</Text>
              </Pressable>
            );
          })}
          {(customers ?? []).length === 0 ? <Text style={styles.muted}>Belum ada pelanggan.</Text> : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error} testID="promo-error">{error}</Text> : null}
      {ok ? <Text style={styles.ok} testID="promo-ok">✓ {ok}</Text> : null}

      <M3Button testID="promo-send" label="Kirim Notifikasi" variant="filled" icon="send" loading={send.isPending} onPress={onSend} style={{ marginTop: 4 }} />

      <Text style={styles.histTitle}>Riwayat Broadcast</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (history ?? []).length === 0 ? (
        <Text style={styles.muted}>Belum ada broadcast.</Text>
      ) : (
        (history ?? []).map((h) => (
          <View key={h.id} style={styles.histCard} testID={`hist-${h.id}`}>
            {resolveImageUrl(h.image_url) ? <Image source={{ uri: resolveImageUrl(h.image_url) }} style={styles.histImg} contentFit="cover" /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.histName}>{h.title}</Text>
              <Text style={styles.histMsg} numberOfLines={2}>{h.message}</Text>
              <Text style={styles.histMeta}>
                {h.target === "all" ? "Semua" : "Terpilih"} · {h.recipients_count} penerima · {h.created_at ? formatDateTime(h.created_at) : ""}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: 12 },
  intro: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19 },
  banner: { height: 140, borderRadius: 16, backgroundColor: colors.surfaceSecondary, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  bannerImg: { width: "100%", height: "100%" },
  bannerEmpty: { alignItems: "center", gap: 6 },
  bannerText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface, marginTop: 6 },
  presetRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  presetChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  presetText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceTertiary },
  presetTextActive: { color: colors.brandPrimary },
  targetRow: { flexDirection: "row", gap: 10 },
  targetChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  targetChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  targetText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceTertiary },
  targetTextActive: { color: colors.brandPrimary },
  custBox: { backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 6, maxHeight: 260 },
  custRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  custName: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurface },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
  ok: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.success },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, padding: 10 },
  histTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.onSurface, marginTop: 16 },
  histCard: { flexDirection: "row", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12 },
  histImg: { width: 54, height: 54, borderRadius: 10 },
  histName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  histMsg: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 2 },
  histMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 4 },
}));
