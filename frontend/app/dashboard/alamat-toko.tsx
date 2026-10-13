import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { MapPicker, MapPoint } from "@/src/components/map-picker";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles } from "@/src/theme";
import { searchAddress } from "@/src/utils/geocode";

type Location = {
  id: string;
  name: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  is_default: boolean;
  biteship_location_id?: string | null;
};

export default function AlamatTokoScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<Location[]>({
    queryKey: ["admin", "locations"],
    queryFn: () => apiRequest<Location[]>("/api/admin/locations"),
  });
  const loc = data?.[0];

  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postal, setPostal] = useState("");
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loc) {
      setName(loc.name ?? "");
      setContactName(loc.contact_name ?? "");
      setContactPhone(loc.contact_phone ?? "");
      setAddress(loc.address ?? "");
      setPostal(loc.postal_code ?? "");
      setPoint({ lat: loc.latitude, lng: loc.longitude });
    }
  }, [loc]);

  // Map -> form: pin moved, sync the address text field.
  const onMapChange = (p: MapPoint) => {
    setPoint(p);
    if (p.address) setAddress(p.address);
  };

  // Form -> map: geocode the typed address and move the pin.
  const searchFromAddress = async () => {
    if (!address.trim()) {
      setError("Isi alamat lengkap dulu untuk mencari di peta.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const r = await searchAddress(address);
      if (r) setPoint({ lat: r.lat, lng: r.lng });
      else setError("Alamat tidak ditemukan di peta. Geser pin secara manual.");
    } catch {
      setError("Gagal mencari lokasi. Geser pin secara manual.");
    } finally {
      setSearching(false);
    }
  };

  const onSave = async () => {
    setError(null);
    if (!name.trim() || !contactPhone.trim() || !address.trim()) {
      setError("Nama toko, telepon, dan alamat wajib diisi.");
      return;
    }
    if (!point) {
      setError("Pilih titik lokasi toko di peta dulu.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        contact_name: contactName.trim() || name.trim(),
        contact_phone: contactPhone.trim(),
        address: address.trim(),
        postal_code: postal.trim(),
        latitude: point.lat,
        longitude: point.lng,
        is_default: true,
      };
      if (loc) await apiRequest(`/api/admin/locations/${loc.id}`, { method: "PUT", body });
      else await apiRequest("/api/admin/locations", { method: "POST", body });
      queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
      toast.show("Alamat toko tersimpan & disinkron ke Biteship", "success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan alamat toko.");
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
      <Text style={styles.title}>Alamat Toko (Asal Pengiriman)</Text>
      <Text style={styles.sub}>
        Titik ini dipakai sebagai lokasi asal (origin) untuk hitung ongkir & pickup kurir instant (GoSend/Grab).
      </Text>

      <M3TextField label="Nama Toko / Gudang *" icon="storefront-outline" value={name} onChangeText={setName} containerTestID="loc-name" />
      <M3TextField label="Nama Kontak" icon="account-outline" value={contactName} onChangeText={setContactName} containerTestID="loc-contact" />
      <M3TextField label="Telepon *" icon="phone-outline" keyboardType="phone-pad" value={contactPhone} onChangeText={setContactPhone} containerTestID="loc-phone" />
      <M3TextField label="Alamat Lengkap *" value={address} onChangeText={setAddress} multiline numberOfLines={3} containerTestID="loc-address" style={{ minHeight: 76, textAlignVertical: "top" }} />
      <View style={{ flexDirection: "row" }}>
        <M3Button testID="search-map" label="Cari di Peta" icon="map-search-outline" variant="tonal" loading={searching} onPress={searchFromAddress} />
      </View>
      <M3TextField label="Kode Pos" icon="mailbox-outline" keyboardType="number-pad" value={postal} onChangeText={setPostal} containerTestID="loc-postal" />

      <MapPicker value={point} onChange={onMapChange} height={300} />
      {point ? (
        <Text style={styles.coord}>
          📍 {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
          {point.address ? `\n${point.address}` : ""}
        </Text>
      ) : null}

      {error ? (
        <View style={styles.alert} testID="loc-error">
          <MaterialDesignIcons name="alert-circle-outline" size={18} color="#fff" />
          <Text style={styles.alertText}>{error}</Text>
        </View>
      ) : null}

      <M3Button testID="save-location" label="Simpan Alamat Toko" variant="filled" loading={saving} onPress={onSave} style={{ marginTop: 8 }} />
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: 14 },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: -6 },
  coord: { fontFamily: fonts.body, fontSize: 12, color: colors.brandPrimary, backgroundColor: colors.surfaceSecondary, borderRadius: 10, padding: 10 },
  alert: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.error, borderRadius: 12, padding: 12 },
  alertText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: "#fff" },
}));
