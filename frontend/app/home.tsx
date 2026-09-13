import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { Image } from "expo-image";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { M3Button } from "@/src/components/m3-button";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function HomeScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const displayName = user?.nama || user?.username || user?.email || "Pengguna";

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <MaterialDesignIcons name="account" size={44} color={colors.onBrandTertiary} />
          </View>
        )}
        <Text style={styles.welcome}>Selamat datang,</Text>
        <Text style={styles.name} testID="home-user-name">
          {displayName}
        </Text>

        <View style={styles.badge}>
          <MaterialDesignIcons
            name={user?.role === "admin" ? "shield-crown-outline" : "shopping-outline"}
            size={16}
            color={colors.onBrandTertiary}
          />
          <Text style={styles.badgeText}>
            {user?.role === "admin" ? "Admin" : "Pembeli"}
          </Text>
        </View>

        <Text style={styles.note}>
          Kamu berhasil masuk ke Diana Stuff. Katalog produk akan segera hadir.
        </Text>
      </View>

      <M3Button
        testID="logout-button"
        label="Keluar"
        icon="logout"
        variant="outlined"
        onPress={logout}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceTertiary,
    marginBottom: 8,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  welcome: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  name: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.onSurface,
    textAlign: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
  },
  badgeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.onBrandTertiary,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 16,
    paddingHorizontal: 12,
  },
}));
