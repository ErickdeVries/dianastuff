import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, ApiError, persistToken } from "@/src/api/client";
import { M3Button } from "@/src/components/m3-button";
import { M3TextField } from "@/src/components/m3-text-field";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function KataSandiScreen() {
  const styles = useStyles();
  useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: (payload: { old_password: string; new_password: string }) =>
      apiRequest<{ session_token: string; message: string }>("/api/auth/change-password", {
        method: "POST",
        body: payload,
      }),
    onSuccess: async (res) => {
      // Backend revoked all sessions and rotated the token — persist the fresh one.
      await persistToken(res.session_token);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.show("Kata sandi berhasil diubah", "success");
    },
    onError: (e: any) => setError(e instanceof ApiError ? e.message : "Gagal mengubah kata sandi"),
  });

  const onSave = () => {
    setError(null);
    if (!oldPassword || !newPassword) {
      setError("Sandi lama dan baru wajib diisi.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Kata sandi baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi kata sandi tidak sama.");
      return;
    }
    saveMut.mutate({ old_password: oldPassword, new_password: newPassword });
  };

  return (
    <KeyboardAwareScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.hint}>
        Ubah kata sandi akun admin Anda. Setelah berhasil, semua sesi login lain akan keluar otomatis.
      </Text>

      <View style={styles.card}>
        <M3TextField
          label="Kata Sandi Lama"
          icon="lock-outline"
          placeholder="••••••••"
          password
          autoCapitalize="none"
          value={oldPassword}
          onChangeText={setOldPassword}
          containerTestID="old-password-input"
        />
        <M3TextField
          label="Kata Sandi Baru"
          icon="lock-plus-outline"
          placeholder="minimal 6 karakter"
          password
          autoCapitalize="none"
          value={newPassword}
          onChangeText={setNewPassword}
          containerTestID="new-password-input"
        />
        <M3TextField
          label="Konfirmasi Kata Sandi Baru"
          icon="lock-check-outline"
          placeholder="ulangi kata sandi baru"
          password
          autoCapitalize="none"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          containerTestID="confirm-password-input"
        />

        {error ? <Text style={styles.error} testID="password-error">{error}</Text> : null}

        <M3Button
          testID="save-password"
          label="Simpan Kata Sandi Baru"
          variant="filled"
          loading={saveMut.isPending}
          onPress={onSave}
        />
      </View>
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: 16 },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.error },
}));
