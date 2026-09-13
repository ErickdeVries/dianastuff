// Material 3 style buttons: filled, tonal, outlined, and an extended FAB.
// Adaptive press feedback via Pressable opacity; single accent color from theme.

import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

type Variant = "filled" | "tonal" | "outlined" | "fab";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function M3Button({
  label,
  onPress,
  variant = "filled",
  icon,
  loading = false,
  disabled = false,
  testID,
  style,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const isDisabled = disabled || loading;

  const containerVariant =
    variant === "filled"
      ? styles.filled
      : variant === "tonal"
        ? styles.tonal
        : variant === "outlined"
          ? styles.outlined
          : styles.fab;

  const textColor =
    variant === "filled"
      ? colors.onBrandPrimary
      : variant === "fab"
        ? colors.onSuccess
        : variant === "tonal"
          ? colors.onBrandTertiary
          : colors.brandPrimary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        containerVariant,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <>
            {icon ? (
              <MaterialDesignIcons name={icon as any} size={20} color={textColor} />
            ) : null}
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    minHeight: 52,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  filled: {
    backgroundColor: colors.brandPrimary,
  },
  tonal: {
    backgroundColor: colors.brandTertiary,
  },
  outlined: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  fab: {
    backgroundColor: colors.success,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
}));
