import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";

type Settings = {
  enabled_couriers: string[];
  subsidy_mode: "none" | "discount" | "free";
  subsidy_amount: number;
  all_couriers: string[];
};

const COURIER_LABELS: Record<string, string> = {
  gojek: "Gojek", grab: "Grab", jne: "JNE", jnt: "J&T",
  lion: "Lion Parcel", lalamove: "Lalamove", ninja: "Ninja Xpress", paxel: "Paxel",
  pos: "POS Indonesia",
};

export default function OngkirScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState<string[]>([]);
  const [mode, setMode] = useState<"none" | "discount" | "free">("none");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery<Settings>({
    queryKey: ["admin", "shipping-settings"],
    queryFn: () => apiRequest<Settings>("/api/admin/shipping-settings"),
  });

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled_couriers);
      setMode(data.subsidy_mode);
      setAmount(data.subsidy_amount ? String(data.subsidy_amount) : "");
    }
  }, [data]);

  const toggleCourier = (c: string) => {
    setSaved(false);
    setEnabled((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const save = useMutation({
    mutationFn: () =>
      apiRequest("/api/admin/shipping-settings", {
        method: "PUT",
        body: {
          enabled_couriers: enabled,
          subsidy_mode: mode,
          subsidy_amount: mode === "discount" ? parseFloat(amount) || 0 : 0,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "shipping-settings"] });
      setSaved(true);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal menyimpan pengaturan."),
  });

  const onSave = () => {
    setError(null);
    if (enabled.length === 0) return setError("Pilih minimal 1 kurir yang tampil di checkout.");
    if (mode === "discount" && (parseFloat(amount) || 0) <= 0) return setError("Isi nominal potongan ongkir.");
    save.mutate();
  };

  if (isLoading || !data) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }

  const SUB_OPTS: { key: "none" | "discount" | "free"; title: string; desc: string; icon: string }[] = [
    { key: "none", title: "Pembeli bayar penuh", desc: "Ongkir ditanggung pembeli sepenuhnya (default).", icon: "cash" },
    { key: "discount", title: "Beri potongan ongkir", desc: "Toko memberi potongan nominal tetap dari ongkir.", icon: "sale" },
    { key: "free", title: "Saya tanggung ongkir (Gratis Ongkir)", desc: "Pembeli lihat GRATIS ONGKIR; selisih ditanggung toko.", icon: "truck-check-outline" },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
      <Text style={styles.intro}>Atur kurir yang muncul saat pembeli checkout dan kebijakan subsidi ongkir toko.</Text>

      <Text style={styles.heading}>Kurir Aktif di Checkout</Text>
      <View style={styles.card}>
        {data.all_couriers.map((c, i) => (
          <View key={c} style={[styles.courierRow, i < data.all_couriers.length - 1 && styles.rowBorder]}>
            <MaterialDesignIcons name="truck-outline" size={22} color={colors.brandPrimary} />
            <Text style={styles.courierName}>{COURIER_LABELS[c] ?? c}</Text>
            <Switch
              testID={`courier-${c}`}
              value={enabled.includes(c)}
              onValueChange={() => toggleCourier(c)}
              trackColor={{ true: colors.brandPrimary, false: colors.border }}
              thumbColor={colors.surfaceSecondary}
            />
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Subsidi Ongkos Kirim</Text>
      <View style={styles.card}>
        {SUB_OPTS.map((o) => {
          const active = mode === o.key;
          return (
            <Pressable key={o.key} testID={`sub-${o.key}`} onPress={() => { setMode(o.key); setSaved(false); }} style={[styles.subRow, active && styles.subRowActive]}>
              <MaterialDesignIcons name={active ? "radiobox-marked" : "radiobox-blank"} size={22} color={active ? colors.brandPrimary : colors.muted} />
              <View style={styles.subIcon}><MaterialDesignIcons name={o.icon as any} size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.subTitle}>{o.title}</Text>
                <Text style={styles.subDesc}>{o.desc}</Text>
              </View>
            </Pressable>
          );
        })}
        {mode === "discount" ? (
          <View style={styles.amountBox}>
            <M3TextField label="Nominal Potongan Ongkir (Rp)" icon="cash-minus" keyboardType="number-pad" value={amount} onChangeText={(t) => { setAmount(t); setSaved(false); }} containerTestID="subsidy-amount" />
            {(parseFloat(amount) || 0) > 0 ? <Text style={styles.amountHint}>Pembeli hemat {formatRupiah(parseFloat(amount) || 0)} dari ongkir setiap pesanan.</Text> : null}
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error} testID="ongkir-error">{error}</Text> : null}
      {saved ? <Text style={styles.saved} testID="ongkir-saved">✓ Pengaturan tersimpan.</Text> : null}

      <M3Button testID="save-ongkir" label="Simpan Pengaturan" variant="filled" icon="content-save-outline" loading={save.isPending} onPress={onSave} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  content: { padding: 20, gap: 12 },
  intro: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19 },
  heading: { fontFamily: fonts.heading, fontSize: 17, color: colors.onSurface, marginTop: 8 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 6, overflow: "hidden" },
  courierRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  courierName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  subRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, margin: 4 },
  subRowActive: { backgroundColor: colors.brandTertiary },
  subIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  subTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  subDesc: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  amountBox: { padding: 10, gap: 6 },
  amountHint: { fontFamily: fonts.body, fontSize: 12, color: colors.brandPrimary },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
  saved: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.success },
}));
