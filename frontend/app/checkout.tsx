import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { useCart } from "@/src/context/cart";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";

type Me = {
  nama: string | null;
  wa: string | null;
  alamat: string | null;
  kota: string | null;
  kode_pos: string | null;
};
type Rekening = { bank: string; no_rek: string; a_n: string };
type Profil = { rekening_bank: Rekening[]; kurir_list?: string[] };

export default function CheckoutScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { items, subtotal, clear } = useCart();

  const [step, setStep] = useState(1);
  const [editingAddr, setEditingAddr] = useState(false);
  const [nama, setNama] = useState("");
  const [wa, setWa] = useState("");
  const [alamat, setAlamat] = useState("");
  const [kota, setKota] = useState("");
  const [kodePos, setKodePos] = useState("");
  const [kurir, setKurir] = useState<string | null>(null);
  const [ongkir, setOngkir] = useState<number>(0);
  const [ongkirMsg, setOngkirMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: me } = useQuery<Me>({ queryKey: ["me"], queryFn: () => apiRequest<Me>("/api/auth/me") });
  const { data: profil } = useQuery<Profil>({ queryKey: ["profil_admin"], queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }) });

  const hasAddress = !!(me?.alamat && me?.kota);
  const kurirList = profil?.kurir_list ?? [];

  useEffect(() => {
    if (me) {
      setNama(me.nama ?? "");
      setWa(me.wa ?? "");
      setAlamat(me.alamat ?? "");
      setKota(me.kota ?? "");
      setKodePos(me.kode_pos ?? "");
      if (!me.alamat || !me.kota) setEditingAddr(true);
    }
  }, [me]);

  const saveAddr = useMutation({
    mutationFn: () =>
      apiRequest("/api/me", {
        method: "PUT",
        body: { nama, wa, alamat, kota, kode_pos: kodePos },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setEditingAddr(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal menyimpan alamat."),
  });

  const cekOngkir = useMutation({
    mutationFn: () =>
      apiRequest<{ found: boolean; harga: number | null }>(
        `/api/ongkir?kota=${encodeURIComponent(me?.kota ?? "")}&kurir=${encodeURIComponent(kurir ?? "")}`,
      ),
    onSuccess: (res) => {
      if (res.found && res.harga != null) {
        setOngkir(res.harga);
        setOngkirMsg(`Ongkir ${kurir}: ${formatRupiah(res.harga)}`);
      } else {
        setOngkir(0);
        setOngkirMsg("Ongkir belum tersedia untuk kota ini. Admin akan konfirmasi sebelum pembayaran.");
      }
    },
  });

  const createOrder = useMutation({
    mutationFn: () =>
      apiRequest<{ id: string; no_order: string }>("/api/orders", {
        method: "POST",
        body: {
          items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
          kurir,
          ongkir,
        },
      }),
    onSuccess: (order) => {
      clear();
      queryClient.invalidateQueries({ queryKey: ["products"] });
      router.replace({ pathname: "/order/[id]", params: { id: order.id } });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal membuat pesanan."),
  });

  const total = subtotal + ongkir;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="checkout-back" onPress={() => (step > 1 ? setStep(step - 1) : router.back())} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Stepper */}
      <View style={styles.stepper}>
        {[
          { n: 1, label: "Alamat" },
          { n: 2, label: "Kurir" },
          { n: 3, label: "Bayar" },
        ].map((s, idx) => (
          <View key={s.n} style={styles.stepItem}>
            <View style={[styles.stepDot, step >= s.n && styles.stepDotActive]}>
              <Text style={[styles.stepNum, step >= s.n && styles.stepNumActive]}>{s.n}</Text>
            </View>
            <Text style={[styles.stepLabel, step >= s.n && styles.stepLabelActive]}>{s.label}</Text>
            {idx < 2 ? <View style={styles.stepLine} /> : null}
          </View>
        ))}
      </View>

      <KeyboardAwareScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} bottomOffset={24}>
        {error ? <Text style={styles.error} testID="checkout-error">{error}</Text> : null}

        {step === 1 ? (
          hasAddress && !editingAddr ? (
            <View style={styles.card} testID="address-card">
              <View style={styles.cardHeader}>
                <MaterialDesignIcons name="map-marker-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.cardTitle}>Alamat Pengiriman</Text>
              </View>
              <Text style={styles.addrName}>{me?.nama} {me?.wa ? `· ${me.wa}` : ""}</Text>
              <Text style={styles.addrText}>{me?.alamat}</Text>
              <Text style={styles.addrText}>{me?.kota} {me?.kode_pos ?? ""}</Text>
              <Pressable testID="edit-address" onPress={() => setEditingAddr(true)} style={styles.linkBtn}>
                <Text style={styles.linkText}>Ubah Alamat</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Isi Alamat Pengiriman</Text>
              <M3TextField label="Nama Penerima" value={nama} onChangeText={setNama} containerTestID="addr-nama" />
              <M3TextField label="Nomor WhatsApp" keyboardType="phone-pad" value={wa} onChangeText={setWa} containerTestID="addr-wa" />
              <M3TextField label="Alamat Lengkap *" value={alamat} onChangeText={setAlamat} multiline numberOfLines={3} containerTestID="addr-alamat" style={{ minHeight: 70, textAlignVertical: "top" }} />
              <M3TextField label="Kota *" value={kota} onChangeText={setKota} containerTestID="addr-kota" />
              <M3TextField label="Kode Pos" keyboardType="number-pad" value={kodePos} onChangeText={setKodePos} containerTestID="addr-kodepos" />
              <M3Button
                testID="save-address"
                label="Simpan Alamat"
                variant="tonal"
                loading={saveAddr.isPending}
                onPress={() => {
                  if (!alamat.trim() || !kota.trim()) {
                    setError("Alamat dan kota wajib diisi.");
                    return;
                  }
                  saveAddr.mutate();
                }}
              />
            </View>
          )
        ) : null}

        {step === 2 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pilih Kurir</Text>
            {kurirList.map((k) => (
              <Pressable
                key={k}
                testID={`kurir-${k}`}
                onPress={() => { setKurir(k); setOngkirMsg(null); setOngkir(0); }}
                style={[styles.kurirRow, kurir === k && styles.kurirRowActive]}
              >
                <MaterialDesignIcons
                  name={kurir === k ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={kurir === k ? colors.brandPrimary : colors.muted}
                />
                <Text style={styles.kurirText}>{k}</Text>
              </Pressable>
            ))}
            <M3Button
              testID="cek-ongkir"
              label="Cek Ongkir"
              icon="truck-fast-outline"
              variant="outlined"
              disabled={!kurir}
              loading={cekOngkir.isPending}
              onPress={() => cekOngkir.mutate()}
            />
            {ongkirMsg ? (
              <View style={styles.ongkirBox} testID="ongkir-msg">
                <MaterialDesignIcons name="information-outline" size={18} color={colors.onBrandTertiary} />
                <Text style={styles.ongkirText}>{ongkirMsg}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 3 ? (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialDesignIcons name="bank-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.cardTitle}>Transfer Manual ke Rekening</Text>
              </View>
              {(profil?.rekening_bank ?? []).map((r, i) => (
                <View key={i} style={styles.rekRow} testID={`rekening-${i}`}>
                  <Text style={styles.rekBank}>{r.bank}</Text>
                  <View>
                    <Text style={styles.rekNo}>{r.no_rek}</Text>
                    <Text style={styles.rekAn}>a.n {r.a_n}</Text>
                  </View>
                </View>
              ))}
              {(profil?.rekening_bank ?? []).length === 0 ? (
                <Text style={styles.addrText}>Rekening belum diatur oleh admin.</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ringkasan Pembayaran</Text>
              <SummaryRow label="Subtotal" value={formatRupiah(subtotal)} />
              <SummaryRow label={`Ongkir${kurir ? ` (${kurir})` : ""}`} value={ongkir > 0 ? formatRupiah(ongkir) : "Dikonfirmasi admin"} />
              <View style={styles.divider} />
              <SummaryRow label="Total" value={formatRupiah(total)} bold />
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Sticky footer nav */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step < 3 ? (
          <M3Button
            testID="checkout-next"
            label="Lanjut"
            icon="arrow-right"
            variant="filled"
            disabled={(step === 1 && !hasAddress) || (step === 2 && !kurir)}
            onPress={() => {
              setError(null);
              if (step === 1 && !hasAddress) {
                setError("Lengkapi alamat pengiriman dulu.");
                return;
              }
              if (step === 2 && !kurir) {
                setError("Pilih kurir dulu.");
                return;
              }
              setStep(step + 1);
            }}
          />
        ) : (
          <M3Button
            testID="place-order"
            label={`Buat Pesanan · ${formatRupiah(total)}`}
            icon="check"
            variant="filled"
            loading={createOrder.isPending}
            onPress={() => createOrder.mutate()}
          />
        )}
      </View>
    </View>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
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
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 12 },
  stepItem: { flexDirection: "row", alignItems: "center" },
  stepDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: colors.brandPrimary },
  stepNum: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  stepNumActive: { color: colors.onBrandPrimary },
  stepLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginLeft: 6 },
  stepLabelActive: { color: colors.onSurface, fontFamily: fonts.bodyMedium },
  stepLine: { width: 24, height: 1.5, backgroundColor: colors.border, marginHorizontal: 8 },
  content: { padding: 16, gap: 14 },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface },
  addrName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  addrText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  linkBtn: { alignSelf: "flex-start", marginTop: 4 },
  linkText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  kurirRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  kurirRowActive: { backgroundColor: colors.brandTertiary },
  kurirText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  ongkirBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  ongkirText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.onBrandTertiary, lineHeight: 18 },
  rekRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12 },
  rekBank: { fontFamily: fonts.heading, fontSize: 14, color: colors.brandPrimary, width: 56 },
  rekNo: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  rekAn: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  summaryValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  summaryBold: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  divider: { height: 1, backgroundColor: colors.divider },
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
}));
