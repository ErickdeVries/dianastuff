// Material 3 filled text field with an optional leading icon and password toggle.

import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { forwardRef, useState } from "react";
import { Pressable, Text, TextInput, TextInputProps, View } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

type Props = TextInputProps & {
  label: string;
  icon?: string;
  password?: boolean;
  containerTestID?: string;
};

export const M3TextField = forwardRef<TextInput, Props>(function M3TextField(
  { label, icon, password = false, containerTestID, style, ...rest },
  ref,
) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(password);

  return (
    <View style={styles.wrapper} testID={containerTestID}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        {icon ? (
          <MaterialDesignIcons name={icon as any} size={20} color={colors.onSurfaceTertiary} />
        ) : null}
        <TextInput
          ref={ref}
          style={[styles.input, style]}
          placeholderTextColor={colors.muted}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {password ? (
          <Pressable
            onPress={() => setHidden((v) => !v)}
            hitSlop={8}
            testID="toggle-password-visibility"
          >
            <MaterialDesignIcons
              name={hidden ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.onSurfaceTertiary}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  wrapper: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.onSurfaceTertiary,
    marginLeft: 4,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingHorizontal: 16,
    minHeight: 54,
  },
  fieldFocused: {
    borderColor: colors.borderStrong,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.onSurface,
    paddingVertical: 14,
  },
}));
