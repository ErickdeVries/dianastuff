import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatRupiah } from "@/src/utils/format";
import { resolveImageUrl } from "@/src/utils/image";

type Product = {
  id: string;
  kategori: string;
  nama_produk: string;
  harga: number;
  stok: number;
  bisa_po: boolean;
  foto_urls: string[];
};

export default function ProdukScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery<Product[]>({
    queryKey: ["products", search],
    queryFn: () => apiRequest<Product[]>(`/api/products${search ? `?search=${encodeURIComponent(search)}` : ""}`, { auth: false }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/products/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setToDelete(null);
    },
  });

  const renderItem = ({ item }: { item: Product }) => {
    const cover = resolveImageUrl(item.foto_urls?.[0]);
    return (
      <View style={styles.card} testID={`product-${item.id}`}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <MaterialDesignIcons name="image-off-outline" size={22} color={colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.nama_produk}</Text>
          <Text style={styles.meta}>{item.kategori || "Tanpa kategori"}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatRupiah(item.harga)}</Text>
            <Text style={styles.stock}>Stok {item.stok}</Text>
            {item.bisa_po ? <Text style={styles.poBadge}>PO</Text> : null}
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            testID={`preview-product-${item.id}`}
            onPress={() => router.push(`/produk/${item.id}`)}
            style={styles.iconBtn}
          >
            <MaterialDesignIcons name="eye-outline" size={20} color={colors.info} />
          </Pressable>
          <Pressable
            testID={`edit-product-${item.id}`}
            onPress={() => router.push({ pathname: "/product-form", params: { id: item.id } })}
            style={styles.iconBtn}
          >
            <MaterialDesignIcons name="pencil-outline" size={20} color={colors.brandPrimary} />
          </Pressable>
          <Pressable
            testID={`delete-product-${item.id}`}
            onPress={() => setToDelete(item)}
            style={styles.iconBtn}
          >
            <MaterialDesignIcons name="trash-can-outline" size={20} color={colors.error} />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <MaterialDesignIcons name="magnify" size={20} color={colors.muted} />
        <TextInput
          testID="product-search"
          style={styles.searchInput}
          placeholder="Cari produk..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="package-variant" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada produk</Text>
            </View>
          ) : null
        }
      />

      <Pressable
        testID="add-product-fab"
        onPress={() => router.push("/product-form")}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      >
        <MaterialDesignIcons name="plus" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <ConfirmDialog
        visible={!!toDelete}
        title="Hapus Produk"
        message={`Yakin ingin menghapus "${toDelete?.nama_produk}"?`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMut.mutate(toDelete.id)}
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
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
  },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  name: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  price: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  stock: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  poBadge: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onBrandTertiary,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  actions: { flexDirection: "row", gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
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
