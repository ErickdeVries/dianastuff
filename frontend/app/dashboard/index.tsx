import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { apiRequest } from "@/src/api/client";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";

type Stats = {
  produk: number;
  pelanggan: number;
  pending: number;
  pesanan: number;
  perlu_konfirmasi: number;
  penjualan_hari_ini: number;
  penjualan_bulan_ini: number;
};

const SHORTCUTS: { route: string; label: string; icon: string }[] = [
  { route: "/dashboard/produk", label: "Kelola Produk", icon: "tag-outline" },
  { route: "/dashboard/pelanggan", label: "Kelola Pelanggan", icon: "account-group-outline" },
  { route: "/dashboard/profil", label: "Pengaturan Toko", icon: "store-cog-outline" },
];

export default function DashboardHome() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();

  const { data } = useQuery<Stats>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiRequest<Stats>("/api/admin/stats"),
  });

  // Live-updated by the global NotificationListener via socket events.
  const { data: unreadChat } = useQuery<{ count: number }>({
    queryKey: ["chat", "unread"],
    queryFn: () => apiRequest<{ count: number }>("/api/chat/unread"),
  });
  const chatBaru = unreadChat?.count ?? 0;
  const perluKonfirmasi = data?.perlu_konfirmasi ?? 0;

  const cards = [
    { label: "Produk", value: data?.produk ?? 0, icon: "tag-outline", color: colors.brandPrimary },
    { label: "Pelanggan", value: data?.pelanggan ?? 0, icon: "account-group-outline", color: colors.info },
    { label: "Menunggu Approval", value: data?.pending ?? 0, icon: "account-clock-outline", color: colors.warning },
    { label: "Pesanan", value: data?.pesanan ?? 0, icon: "receipt-text-outline", color: colors.success },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {chatBaru > 0 || perluKonfirmasi > 0 ? (
        <>
          <Text style={styles.heading}>Notifikasi</Text>
          <View style={{ gap: 12 }}>
            {chatBaru > 0 ? (
              <Pressable
                testID="notif-chat-baru"
                style={styles.notifCard}
                onPress={() => router.push("/dashboard/chat")}
              >
                <View style={[styles.notifIcon, { backgroundColor: colors.brandPrimary }]}>
                  <MaterialDesignIcons name="chat-alert-outline" size={22} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifTitle}>Chat Baru</Text>
                  <Text style={styles.notifSub}>{chatBaru} pesan belum dibaca</Text>
                </View>
                <MaterialDesignIcons name="chevron-right" size={22} color={colors.muted} />
              </Pressable>
            ) : null}
            {perluKonfirmasi > 0 ? (
              <Pressable
                testID="notif-pesanan-baru"
                style={styles.notifCard}
                onPress={() => router.push("/dashboard/pesanan")}
              >
                <View style={[styles.notifIcon, { backgroundColor: colors.warning }]}>
                  <MaterialDesignIcons name="receipt-text-clock-outline" size={22} color={colors.onWarning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifTitle}>Pesanan Perlu Konfirmasi</Text>
                  <Text style={styles.notifSub}>{perluKonfirmasi} pesanan menunggu konfirmasi pembayaran</Text>
                </View>
                <MaterialDesignIcons name="chevron-right" size={22} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={styles.heading}>Ringkasan Penjualan</Text>
      <View style={styles.grid}>
        <View style={styles.statCard} testID="stat-penjualan-hari-ini">
          <View style={[styles.statIcon, { backgroundColor: colors.success }]}>
            <MaterialDesignIcons name="cash-multiple" size={22} color={colors.onSuccess} />
          </View>
          <Text style={styles.statValueSales}>{formatRupiah(data?.penjualan_hari_ini ?? 0)}</Text>
          <Text style={styles.statLabel}>Penjualan Hari Ini</Text>
        </View>
        <View style={styles.statCard} testID="stat-penjualan-bulan-ini">
          <View style={[styles.statIcon, { backgroundColor: colors.info }]}>
            <MaterialDesignIcons name="calendar-month-outline" size={22} color={colors.onInfo} />
          </View>
          <Text style={styles.statValueSales}>{formatRupiah(data?.penjualan_bulan_ini ?? 0)}</Text>
          <Text style={styles.statLabel}>Penjualan Bulan Ini</Text>
        </View>
      </View>

      <Text style={styles.heading}>Ringkasan Toko</Text>
      <View style={styles.grid}>
        {cards.map((c) => (
          <View key={c.label} style={styles.statCard} testID={`stat-${c.label}`}>
            <View style={[styles.statIcon, { backgroundColor: c.color }]}>
              <MaterialDesignIcons name={c.icon as any} size={22} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.statValue}>{c.value}</Text>
            <Text style={styles.statLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Aksi Cepat</Text>
      <View style={{ gap: 12 }}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.route}
            testID={`shortcut-${s.label}`}
            style={styles.shortcut}
            onPress={() => router.push(s.route as any)}
          >
            <View style={styles.shortcutIcon}>
              <MaterialDesignIcons name={s.icon as any} size={22} color={colors.onBrandTertiary} />
            </View>
            <Text style={styles.shortcutText}>{s.label}</Text>
            <MaterialDesignIcons name="chevron-right" size={22} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: 16 },
  heading: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.onSurface,
    marginTop: 4,
  },
  notifCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  notifTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.onSurface,
  },
  notifSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.onSurface,
  },
  statValueSales: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.onSurface,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  shortcut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
  },
  shortcutIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.onSurface,
  },
}));
