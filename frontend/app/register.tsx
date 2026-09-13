import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function RegisterScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerWhitelist } = useAuth();

  const [nama, setNama] = useState("");
  const [username, setUsername] = useState("");
  const [wa, setWa] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!nama.trim() || !username.trim() || !password) {
      setError("Nama, username, dan password wajib diisi.");
      return;
    }
    if (password.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await registerWhitelist({
        nama: nama.trim(),
        username: username.trim(),
        password,
        wa: wa.trim() || undefined,
      });
      setSuccess(res.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Pendaftaran gagal. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="register-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Daftar Akun</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        {success ? (
          <View style={styles.successBox} testID="register-success">
            <MaterialDesignIcons name="clock-check-outline" size={40} color={colors.success} />
            <Text style={styles.successTitle}>Pendaftaran Terkirim</Text>
            <Text style={styles.successMsg}>{success}</Text>
            <M3Button
              testID="register-back-to-login"
              label="Kembali ke Login"
              variant="filled"
              onPress={() => router.replace("/login")}
            />
          </View>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Buat akun untuk belanja. Akun akan aktif setelah disetujui admin.
            </Text>

            {error ? (
              <Text style={styles.error} testID="register-error">
                {error}
              </Text>
            ) : null}

            <M3TextField
              label="Nama Lengkap"
              icon="account-outline"
              placeholder="Nama kamu"
              value={nama}
              onChangeText={setNama}
              containerTestID="register-nama"
            />
            <M3TextField
              label="Username"
              icon="at"
              placeholder="username"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              containerTestID="register-username"
            />
            <M3TextField
              label="Nomor WhatsApp (opsional)"
              icon="whatsapp"
              placeholder="08xxxxxxxxxx"
              keyboardType="phone-pad"
              value={wa}
              onChangeText={setWa}
              containerTestID="register-wa"
            />
            <M3TextField
              label="Password"
              icon="lock-outline"
              placeholder="Minimal 6 karakter"
              password
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              containerTestID="register-password"
            />

            <M3Button
              testID="register-submit"
              label="Daftar"
              variant="filled"
              loading={submitting}
              onPress={onSubmit}
              style={styles.submit}
            />
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 16,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
  },
  submit: {
    marginTop: 8,
  },
  successBox: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 12,
  },
  successTitle: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.onSurface,
  },
  successMsg: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
}));
