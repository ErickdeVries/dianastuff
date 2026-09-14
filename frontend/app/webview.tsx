import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { createElement, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { fonts, makeStyles, useTheme } from "@/src/theme";
import { PUBLIC_WEB_URL } from "@/src/utils/links";

export default function WebViewScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ path?: string; title?: string }>();
  const [loading, setLoading] = useState(true);

  const url = `${PUBLIC_WEB_URL}${params.path || "/toko"}`;
  const title = params.title || "Toko (Web)";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="webview-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={{ flex: 1 }} testID="webview-container">
        {Platform.OS === "web" ? (
          // react-native-web has no WebView; use a real iframe.
          createElement("iframe", {
            src: url,
            style: { flex: 1, border: "none", width: "100%", height: "100%" },
            onLoad: () => setLoading(false),
          })
        ) : (
          <WebView source={{ uri: url }} style={{ flex: 1 }} startInLoadingState onLoadEnd={() => setLoading(false)} />
        )}
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  loader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
}));
