// Simple confirm dialog built on React Native Modal (no Alert per app rules).

import { Modal, Pressable, Text, View } from "react-native";

import { fonts, makeStyles } from "@/src/theme";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Hapus",
  cancelLabel = "Batal",
  destructive = true,
  onConfirm,
  onCancel,
}: Props) {
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable testID="confirm-cancel" onPress={onCancel} style={[styles.btn, styles.cancel]}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              testID="confirm-ok"
              onPress={onConfirm}
              style={[styles.btn, destructive ? styles.destructive : styles.confirm]}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 24,
    padding: 24,
    gap: 8,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.onSurface,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
  },
  cancel: {
    backgroundColor: colors.surfaceTertiary,
  },
  cancelText: {
    fontFamily: fonts.bodyMedium,
    color: colors.onSurfaceTertiary,
    fontSize: 14,
  },
  confirm: {
    backgroundColor: colors.brandPrimary,
  },
  destructive: {
    backgroundColor: colors.error,
  },
  confirmText: {
    fontFamily: fonts.bodyMedium,
    color: colors.onError,
    fontSize: 14,
  },
}));
