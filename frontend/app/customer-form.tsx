import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Customer = {
  user_id: string;
  email: string | null;
  username: string;
  nama: string;
  wa: string | null;
  status: string;
};

export default function CustomerForm() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const { data } = useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: () => apiRequest<Customer[]>("/api/admin/customers"),
    enabled: isEdit,
  });
  const existing = data?.find((c) => c.user_id === id);

  const [nama, setNama] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [wa, setWa] = useState("");
  const [password, setPassword] = useState("");
  const [approved, setApproved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setNama(existing.nama ?? "");
      setUsername(existing.username ?? "");
      setEmail(existing.email ?? "");
      setWa(existing.wa ?? "");
      setApproved(existing.status === "approved");
    }
  }, [existing]);

  const onSave = async () => {
    setError(null);
    if (!nama.trim() || !username.trim()) {
      setError("Nama dan username wajib diisi.");
      return;
    }
    if (!isEdit && password.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        nama: nama.trim(),
        username: username.trim(),
        email: email.trim() || null,
        wa: wa.trim() || null,
        status: approved ? "approved" : "pending",
      };
      if (password) body.password = password;
      if (isEdit) {
        await apiRequest(`/api/admin/customers/${id}`, { method: "PUT", body });
      } else {
        await apiRequest("/api/admin/customers", { method: "POST", body });
      }
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan pelanggan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="customer-form-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? "Edit Pelanggan" : "Tambah Pelanggan"}</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        bottomOffset={24}
      >
        <M3TextField label="Nama Lengkap *" icon="account-outline" value={nama} onChangeText={setNama} containerTestID="customer-nama" />
        <M3TextField label="Username *" icon="at" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} containerTestID="customer-username" />
        <M3TextField label="Email" icon="email-outline" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} containerTestID="customer-email" />
        <M3TextField label="Nomor WhatsApp" icon="whatsapp" keyboardType="phone-pad" value={wa} onChangeText={setWa} containerTestID="customer-wa" />
        <M3TextField
          label={isEdit ? "Password (kosongkan jika tidak diubah)" : "Password *"}
          icon="lock-outline"
          password
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
          containerTestID="customer-password"
        />

        <Pressable
          testID="customer-status-toggle"
          style={[styles.statusChip, approved ? styles.chipApproved : styles.chipPending]}
          onPress={() => setApproved((v) => !v)}
        >
          <MaterialDesignIcons
            name={approved ? "check-circle" : "clock-outline"}
            size={18}
            color={approved ? colors.onSuccess : colors.onWarning}
          />
          <Text style={[styles.statusText, { color: approved ? colors.onSuccess : colors.onWarning }]}>
            {approved ? "Akun Aktif (Approved)" : "Menunggu Approval (Pending)"}
          </Text>
        </Pressable>

        {error ? (
          <View style={styles.alert} testID="customer-form-error">
            <MaterialDesignIcons name="alert-circle-outline" size={18} color={colors.onError} />
            <Text style={styles.alertText}>{error}</Text>
          </View>
        ) : null}

        <M3Button testID="save-customer" label={isEdit ? "Simpan Perubahan" : "Tambah Pelanggan"} variant="filled" loading={saving} onPress={onSave} style={{ marginTop: 8 }} />
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
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chipApproved: { backgroundColor: colors.success },
  chipPending: { backgroundColor: colors.warning },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  alert: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.error, borderRadius: 12, padding: 12 },
  alertText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onError },
}));
