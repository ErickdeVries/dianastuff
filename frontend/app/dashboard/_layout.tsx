import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Item = { name: string; label: string; icon: string };

const ITEMS: Item[] = [
  { name: "index", label: "Dashboard", icon: "view-dashboard-outline" },
  { name: "analitik", label: "Analitik Toko", icon: "chart-line" },
  { name: "live", label: "Live Shopping", icon: "access-point" },
  { name: "live-rekap", label: "Rekap Live", icon: "chart-box-outline" },
  { name: "produk", label: "Produk", icon: "tag-outline" },
  { name: "voucher", label: "Voucher Diskon", icon: "ticket-percent-outline" },
  { name: "promo", label: "Broadcast Promo", icon: "bullhorn-outline" },
  { name: "pesanan", label: "Pesanan", icon: "receipt-text-outline" },
  { name: "ongkir", label: "Ongkos Kirim", icon: "truck-fast-outline" },
  { name: "alamat-toko", label: "Alamat Toko", icon: "map-marker-radius-outline" },
  { name: "pelanggan", label: "Pelanggan", icon: "account-group-outline" },
  { name: "profil", label: "Pengaturan Toko", icon: "store-cog-outline" },
  { name: "sandi", label: "Kata Sandi", icon: "shield-key-outline" },
  { name: "chat", label: "Chat", icon: "chat-outline" },
];

function DrawerContent(props: any) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const router = useRouter();
  const activeIndex = props.state.index;

  const { data: unreadChat } = useQuery<{ count: number }>({
    queryKey: ["chat", "unread"],
    queryFn: () => apiRequest<{ count: number }>("/api/chat/unread"),
  });
  const { data: stats } = useQuery<{ perlu_konfirmasi: number }>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiRequest<{ perlu_konfirmasi: number }>("/api/admin/stats"),
  });
  const badges: Record<string, number> = {
    chat: unreadChat?.count ?? 0,
    pesanan: stats?.perlu_konfirmasi ?? 0,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <MaterialDesignIcons name="storefront-outline" size={26} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>Diana Stuff</Text>
            <Text style={styles.brandSub}>{user?.nama || "Admin"}</Text>
          </View>
        </View>

        {ITEMS.map((item, i) => {
          const focused = i === activeIndex;
          return (
            <Pressable
              key={item.name}
              testID={`drawer-${item.name}`}
              onPress={() => props.navigation.navigate(item.name)}
              style={[styles.item, focused && styles.itemActive]}
            >
              <MaterialDesignIcons
                name={item.icon as any}
                size={22}
                color={focused ? colors.onBrandPrimary : colors.onSurfaceTertiary}
              />
              <Text style={[styles.itemText, focused && styles.itemTextActive]}>{item.label}</Text>
              {(badges[item.name] ?? 0) > 0 ? (
                <View style={styles.badge} testID={`drawer-badge-${item.name}`}>
                  <Text style={styles.badgeText}>{badges[item.name]}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        testID="drawer-logout"
        style={[styles.logout, { paddingBottom: insets.bottom + 18 }]}
        onPress={async () => {
          await logout();
          router.replace("/login");
        }}
      >
        <MaterialDesignIcons name="logout" size={20} color={colors.error} />
        <Text style={styles.logoutText}>Keluar</Text>
      </Pressable>
    </View>
  );
}

export default function DashboardLayout() {
  const { colors } = useTheme();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  // Admin-only protection.
  if (!user || user.role !== "admin") {
    return <Redirect href="/home" />;
  }

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.onSurface,
        headerTitleStyle: { fontFamily: fonts.heading, fontSize: 18 },
        drawerType: "front",
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Drawer.Screen name="index" options={{ title: "Dashboard" }} />
      <Drawer.Screen name="analitik" options={{ title: "Analitik Toko" }} />
      <Drawer.Screen name="live" options={{ title: "Live Shopping" }} />
      <Drawer.Screen name="live-rekap" options={{ title: "Rekap Live" }} />
      <Drawer.Screen name="produk" options={{ title: "Produk" }} />
      <Drawer.Screen name="voucher" options={{ title: "Voucher Diskon" }} />
      <Drawer.Screen name="promo" options={{ title: "Broadcast Promo" }} />
      <Drawer.Screen name="pesanan" options={{ title: "Pesanan" }} />
      <Drawer.Screen name="ongkir" options={{ title: "Ongkos Kirim" }} />
      <Drawer.Screen name="pelanggan" options={{ title: "Pelanggan" }} />
      <Drawer.Screen name="profil" options={{ title: "Pengaturan Toko" }} />
      <Drawer.Screen name="sandi" options={{ title: "Ubah Kata Sandi" }} />
      <Drawer.Screen name="chat" options={{ title: "Chat" }} />
    </Drawer>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: {
    paddingTop: 8,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.brandPrimary,
  },
  brandSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 10,
    borderRadius: 14,
  },
  itemActive: {
    backgroundColor: colors.brandPrimary,
  },
  itemText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.onSurfaceTertiary,
    flex: 1,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onError,
  },
  itemTextActive: {
    color: colors.onBrandPrimary,
  },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 26,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  logoutText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.error,
  },
}));
