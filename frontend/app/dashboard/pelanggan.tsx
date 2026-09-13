import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Customer = {
  user_id: string;
  email: string | null;
  username: string;
  nama: string;
  wa: string | null;
  status: string;
};

export default function PelangganScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<Customer | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery<Customer[]>({
    queryKey: ["customers", search],
    queryFn: () => apiRequest<Customer[]>(`/api/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setToDelete(null);
    },
  });

  const renderItem = ({ item }: { item: Customer }) => (
    <View style={styles.card} testID={`customer-${item.user_id}`}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.nama || item.username || "?").charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.nama || item.username}</Text>
        <Text style={styles.meta}>@{item.username}</Text>
        {item.wa ? <Text style={styles.meta}>{item.wa}</Text> : null}
      </View>
      <View style={styles.rightCol}>
        <Text style={[styles.status, item.status === "approved" ? styles.approved : styles.pending]}>
          {item.status === "approved" ? "Aktif" : "Pending"}
        </Text>
        <View style={styles.actions}>
          <Pressable
            testID={`edit-customer-${item.user_id}`}
            onPress={() => router.push({ pathname: "/customer-form", params: { id: item.user_id } })}
            style={styles.iconBtn}
          >
            <MaterialDesignIcons name="pencil-outline" size={18} color={colors.brandPrimary} />
          </Pressable>
          <Pressable
            testID={`delete-customer-${item.user_id}`}
            onPress={() => setToDelete(item)}
            style={styles.iconBtn}
          >
            <MaterialDesignIcons name="trash-can-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <MaterialDesignIcons name="magnify" size={20} color={colors.muted} />
        <TextInput
          testID="customer-search"
          style={styles.searchInput}
          placeholder="Cari pelanggan..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.user_id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="account-off-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada pelanggan</Text>
            </View>
          ) : null
        }
      />

      <Pressable
        testID="add-customer-fab"
        onPress={() => router.push("/customer-form")}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      >
        <MaterialDesignIcons name="account-plus-outline" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      <ConfirmDialog
        visible={!!toDelete}
        title="Hapus Pelanggan"
        message={`Yakin ingin menghapus "${toDelete?.nama || toDelete?.username}"?`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMut.mutate(toDelete.user_id)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.onSurface,
    paddingVertical: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 18,
    padding: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.heading, fontSize: 18, color: colors.onBrandTertiary },
  name: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  rightCol: { alignItems: "flex-end", gap: 6 },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
  approved: { color: colors.onSuccess, backgroundColor: colors.success },
  pending: { color: colors.onWarning, backgroundColor: colors.warning },
  actions: { flexDirection: "row", gap: 4 },
  iconBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.surfaceTertiary,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  fab: {
    position: "absolute",
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
