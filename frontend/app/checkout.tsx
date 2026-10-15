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
import { MapPicker, MapPoint } from "@/src/components/map-picker";
import { useCart } from "@/src/context/cart";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { searchAddress } from "@/src/utils/geocode";

type Me = {
  nama: string | null;
  wa: string | null;
  alamat: string | null;
  kota: string | null;
  kode_pos: string | null;
  latitude?: number | null;
  longitude?: number | null;
};
type Rekening = { bank: string; no_rek: string; a_n: string };
type Profil = { rekening_bank: Rekening[]; kurir_list?: string[] };
type RateRow = {
  courier_name?: string;
  courier_code?: string;
  courier_service_name?: string;
  company?: string;
  type?: string;
  duration?: string;
  price?: number;
  price_asli?: number;
  subsidi?: number;
  shipping_fee_discount?: number;
  available_for_insurance?: boolean;
  insurance_fee?: number;
};

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
  const [coord, setCoord] = useState<MapPoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [selRate, setSelRate] = useState<RateRow | null>(null);
  const [asuransi, setAsuransi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [voucherDiskon, setVoucherDiskon] = useState(0);
  const [voucherMsg, setVoucherMsg] = useState<string | null>(null);

  const { data: me } = useQuery<Me>({ queryKey: ["me"], queryFn: () => apiRequest<Me>("/api/auth/me") });
  const { data: profil } = useQuery<Profil>({ queryKey: ["profil_admin"], queryFn: () => apiRequest<Profil>("/api/profil_admin", { auth: false }) });

  const hasAddress = !!(me?.alamat && me?.kota);

  useEffect(() => {
    if (me) {
      setNama(me.nama ?? "");
      setWa(me.wa ?? "");
      setAlamat(me.alamat ?? "");
      setKota(me.kota ?? "");
      setKodePos(me.kode_pos ?? "");
      if (me.latitude != null && me.longitude != null) setCoord({ lat: me.latitude, lng: me.longitude });
      if (!me.alamat || !me.kota) setEditingAddr(true);
    }
  }, [me]);

  const saveAddr = useMutation({
    mutationFn: () =>
      apiRequest("/api/me", {
        method: "PUT",
        body: { nama, wa, alamat, kota, kode_pos: kodePos, latitude: coord?.lat, longitude: coord?.lng },
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
      apiRequest<{ pricing: RateRow[] }>("/api/shipping/rates", {
        method: "POST",
        body: {
          destination_latitude: coord?.lat,
          destination_longitude: coord?.lng,
          items: items.map((i) => ({
            name: i.nama_produk ?? "Produk",
            value: Math.round(i.harga ?? 10000),
            weight: Math.max(1, Math.round(i.weight ?? 250)),
            quantity: i.qty,
          })),
        },
      }),
    onSuccess: (res) => {
      setRates(res.pricing ?? []);
      if (!res.pricing?.length) setOngkirMsg("Tidak ada kurir tersedia untuk titik ini.");
      else setOngkirMsg(null);
    },
    onError: (e) => {
      setRates([]);
      setOngkirMsg(e instanceof ApiError ? e.message : "Gagal mengambil ongkir.");
    },
  });

  const pickRate = (r: RateRow) => {    setSelRate(r);
    setOngkir(r.price ?? 0);
    setAsuransi(false);
    const label = `${r.courier_name ?? r.company} ${r.courier_service_name ?? r.type ?? ""}`.trim();
    setKurir(label);
  };

  const insuranceFee = asuransi && selRate?.available_for_insurance ? (selRate?.insurance_fee ?? 0) : 0;

  // Form -> map: geocode the typed address and move the pin there.
  const searchFromAddress = async () => {
    const q = [alamat, kota].filter(Boolean).join(", ");
    if (!q.trim()) {
      setError("Isi alamat / kota dulu untuk mencari di peta.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const r = await searchAddress(q);
      if (r) {
        setCoord({ lat: r.lat, lng: r.lng });
      } else {
        setError("Alamat tidak ditemukan di peta. Geser pin secara manual.");
      }
    } catch {
      setError("Gagal mencari lokasi. Geser pin secara manual.");
    } finally {
      setSearching(false);
    }
  };

  // Map -> form: pin moved, sync the address text field.
  const onMapChange = (p: MapPoint) => {
    setCoord(p);
    if (p.address) setAlamat(p.address);
  };

  const applyVoucher = useMutation({
    mutationFn: () =>
      apiRequest<{ valid: boolean; diskon: number; message: string }>("/api/voucher/validate", {
        method: "POST",
        body: { kode: voucherInput.trim(), subtotal, ongkir },
      }),
    onSuccess: (res) => {
      if (res.valid) {
        setVoucherCode(voucherInput.trim().toUpperCase());
        setVoucherDiskon(res.diskon);
        setVoucherMsg(res.message);
      } else {
        setVoucherCode(null);
        setVoucherDiskon(0);
        setVoucherMsg(res.message);
      }
    },
    onError: (e) => {
      setVoucherCode(null);
      setVoucherDiskon(0);
      setVoucherMsg(e instanceof ApiError ? e.message : "Gagal memeriksa voucher.");
    },
  });

  const removeVoucher = () => {
    setVoucherCode(null);
    setVoucherDiskon(0);
    setVoucherMsg(null);
    setVoucherInput("");
  };

  // Re-validate an applied voucher whenever shipping changes, because an
  // ongkir-discount voucher's value depends on the selected courier price.
  useEffect(() => {
    if (!voucherCode) return;
    let active = true;
    apiRequest<{ valid: boolean; diskon: number; message: string }>("/api/voucher/validate", {
      method: "POST",
      body: { kode: voucherCode, subtotal, ongkir },
    })
      .then((res) => {
        if (!active) return;
        if (res.valid) setVoucherDiskon(res.diskon);
      })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongkir]);

  const createOrder = useMutation({
    mutationFn: () =>
      apiRequest<{ id: string; no_order: string }>("/api/orders", {
        method: "POST",
        body: {
          items: items.map((i) => ({ product_id: i.product_id, qty: i.qty, variation_key: i.variation_key ?? null })),
          kurir,
          ongkir,
          voucher_code: voucherCode,
          asuransi,
          asuransi_fee: insuranceFee,
          shipping_coordinate: coord ? { latitude: coord.lat, longitude: coord.lng } : null,
          courier_company: selRate?.company ?? selRate?.courier_code ?? null,
          courier_type: selRate?.type ?? null,
        },
      }),
    onSuccess: (order) => {
      clear();
      queryClient.invalidateQueries({ queryKey: ["products"] });
      router.replace({ pathname: "/order/[id]", params: { id: order.id } });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal membuat pesanan."),
  });

  const total = Math.max(0, subtotal + ongkir + insuranceFee - voucherDiskon);

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
              <Text style={styles.mapHint}>Geser pin tepat di lokasi rumah/kantor kamu, atau isi alamat lalu ketuk &quot;Cari di Peta&quot; (untuk kurir instant GoSend/Grab).</Text>
              <M3TextField label="Nama Penerima" value={nama} onChangeText={setNama} containerTestID="addr-nama" />
              <M3TextField label="Nomor WhatsApp" keyboardType="phone-pad" value={wa} onChangeText={setWa} containerTestID="addr-wa" />
              <M3TextField label="Alamat Lengkap *" value={alamat} onChangeText={setAlamat} multiline numberOfLines={3} containerTestID="addr-alamat" style={{ minHeight: 70, textAlignVertical: "top" }} />
              <View style={styles.addrRow}>
                <View style={{ flex: 1 }}>
                  <M3TextField label="Kota *" value={kota} onChangeText={setKota} containerTestID="addr-kota" />
                </View>
                <M3Button testID="search-map" label="Cari di Peta" icon="map-search-outline" variant="tonal" loading={searching} onPress={searchFromAddress} />
              </View>
              <M3TextField label="Kode Pos" keyboardType="number-pad" value={kodePos} onChangeText={setKodePos} containerTestID="addr-kodepos" />
              <MapPicker value={coord} onChange={onMapChange} height={260} />
              {coord ? <Text style={styles.coordText} testID="checkout-coord">📍 {coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}</Text> : null}
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
                  if (!coord) {
                    setError("Pilih titik lokasi di peta dulu.");
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
            <Text style={styles.cardTitle}>Pilih Kurir (Biteship)</Text>
            <M3Button
              testID="cek-ongkir"
              label="Cek Ongkir & Kurir"
              icon="truck-fast-outline"
              variant="outlined"
              disabled={!coord}
              loading={cekOngkir.isPending}
              onPress={() => cekOngkir.mutate()}
            />
            {!coord ? <Text style={styles.mapHint}>Tentukan titik alamat di langkah sebelumnya dulu.</Text> : null}
            {rates.map((r, i) => {
              const label = `${r.courier_name ?? r.company} · ${r.courier_service_name ?? r.type ?? ""}`;
              const active = selRate === r;
              const hasSubsidi = (r.subsidi ?? 0) > 0;
              const kurirDiskon = (r.shipping_fee_discount ?? 0) > 0;
              return (
                <Pressable key={i} testID={`rate-${i}`} onPress={() => pickRate(r)} style={[styles.kurirRow, active && styles.kurirRowActive]}>
                  <MaterialDesignIcons name={active ? "radiobox-marked" : "radiobox-blank"} size={22} color={active ? colors.brandPrimary : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kurirText}>{label}</Text>
                    <View style={styles.rateMetaRow}>
                      {r.duration ? (
                        <View style={styles.estChip}>
                          <MaterialDesignIcons name="clock-outline" size={12} color={colors.brandPrimary} />
                          <Text style={styles.estChipText}>Estimasi {r.duration}</Text>
                        </View>
                      ) : null}
                      {hasSubsidi ? (
                        <Text style={styles.subsidiBadge}>{(r.price ?? 0) === 0 ? "Gratis Ongkir" : "Ongkir disubsidi"}</Text>
                      ) : null}
                      {kurirDiskon ? (
                        <Text style={styles.kurirDiscBadge}>Diskon kurir</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.ratePrice}>{(r.price ?? 0) === 0 ? "GRATIS" : formatRupiah(r.price ?? 0)}</Text>
                    {hasSubsidi ? <Text style={styles.ratePriceStrike}>{formatRupiah(r.price_asli ?? 0)}</Text> : null}
                    {kurirDiskon ? <Text style={styles.ratePriceStrike}>{formatRupiah((r.price ?? 0) + (r.shipping_fee_discount ?? 0))}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {selRate?.available_for_insurance ? (
              <Pressable testID="asuransi-toggle" onPress={() => setAsuransi((v) => !v)} style={[styles.insuranceRow, asuransi && styles.insuranceRowActive]}>
                <MaterialDesignIcons name={asuransi ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={asuransi ? colors.brandPrimary : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kurirText}>Asuransikan paket</Text>
                  <Text style={styles.rateDur}>Lindungi paket dari kerusakan/kehilangan</Text>
                </View>
                <Text style={styles.ratePrice}>{(selRate?.insurance_fee ?? 0) > 0 ? `+ ${formatRupiah(selRate?.insurance_fee ?? 0)}` : "Gratis"}</Text>
              </Pressable>
            ) : null}
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
              <View style={styles.cardHeader}>
                <MaterialDesignIcons name="ticket-percent-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.cardTitle}>Voucher Diskon</Text>
              </View>
              {voucherCode ? (
                <View style={styles.voucherApplied} testID="voucher-applied">
                  <MaterialDesignIcons name="check-circle" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.voucherCodeText}>{voucherCode}</Text>
                    <Text style={styles.voucherSub}>Potongan {formatRupiah(voucherDiskon)}</Text>
                  </View>
                  <Pressable testID="voucher-remove" onPress={removeVoucher} hitSlop={8}>
                    <Text style={styles.linkText}>Hapus</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.voucherRow}>
                  <View style={{ flex: 1 }}>
                    <M3TextField label="Kode Voucher" autoCapitalize="characters" value={voucherInput} onChangeText={setVoucherInput} containerTestID="voucher-input" />
                  </View>
                  <M3Button testID="voucher-apply" label="Pakai" variant="tonal" loading={applyVoucher.isPending} disabled={!voucherInput.trim()} onPress={() => applyVoucher.mutate()} />
                </View>
              )}
              {voucherMsg && !voucherCode ? <Text style={styles.voucherError} testID="voucher-msg">{voucherMsg}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ringkasan Pembayaran</Text>
              <SummaryRow label="Subtotal" value={formatRupiah(subtotal)} />
              {voucherDiskon > 0 ? <SummaryRow label={`Diskon Voucher${voucherCode ? ` (${voucherCode})` : ""}`} value={`- ${formatRupiah(voucherDiskon)}`} /> : null}
              <SummaryRow label={`Ongkir${kurir ? ` (${kurir})` : ""}`} value={ongkir > 0 ? formatRupiah(ongkir) : (selRate ? "GRATIS" : "Dikonfirmasi admin")} />
              {insuranceFee > 0 ? <SummaryRow label="Asuransi Pengiriman" value={formatRupiah(insuranceFee)} /> : null}
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
  rateMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  estChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandTertiary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  estChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.brandPrimary },
  subsidiBadge: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#fff", backgroundColor: colors.success, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  kurirDiscBadge: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#fff", backgroundColor: colors.error, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  ratePriceStrike: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textDecorationLine: "line-through" },
  insuranceRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  insuranceRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  ongkirText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.onBrandTertiary, lineHeight: 18 },
  mapHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  coordText: { fontFamily: fonts.body, fontSize: 12, color: colors.brandPrimary },
  rateDur: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  ratePrice: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  addrRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rekRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12 },
  rekBank: { fontFamily: fonts.heading, fontSize: 14, color: colors.brandPrimary, width: 56 },
  rekNo: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  rekAn: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  summaryValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  summaryBold: { fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  divider: { height: 1, backgroundColor: colors.divider },
  voucherRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  voucherApplied: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  voucherCodeText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  voucherSub: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  voucherError: { fontFamily: fonts.body, fontSize: 12, color: colors.error },
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
