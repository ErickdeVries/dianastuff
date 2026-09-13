import { ActivityIndicator, View } from "react-native";

import { useTheme } from "@/src/theme";

// The root-layout gate (app/_layout.tsx) redirects away from "/" based on auth
// state. This screen just shows a spinner while that decision is made.
export default function Index() {
  const { colors } = useTheme();
  return (
    <View
      testID="index-loading"
      style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
    >
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}
