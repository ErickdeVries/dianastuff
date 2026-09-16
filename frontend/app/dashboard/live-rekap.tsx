import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { deleteLiveRecap, getLiveChatHistory, getLiveHistory, LiveFeedMsg, LiveHistoryItem } from "@/src/api/live";
import { ConfirmDialog } from "@/src/components/confirm-dialog";
import { useToast } from "@/src/context/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { formatDateTime, formatRupiah } from "@/src/utils/format";

function fmtTime(ts?: string): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function LiveRekapScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<LiveHistoryItem | null>(null);
  const [chatFor, setChatFor] = useState<LiveHistoryItem | null>(null);

  const { data, isLoading } = useQuery<LiveHistoryItem[]>({
    queryKey: ["live", "history"],
    queryFn: getLiveHistory,
  });

  const chatQuery = useQuery({
    queryKey: ["live", "chat", chatFor?.id],
    queryFn: () => getLiveChatHistory(chatFor!.id),
    enabled: !!chatFor,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLiveRecap(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live", "history"] });
      toast.show("Rekap live dihapus", "success");
    },
    onError: () => toast.show("Gagal menghapus rekap", "error"),
  });

  const renderItem = ({ item }: { item: LiveHistoryItem }) => (
    <View style={styles.card} testID={`rekap-${item.id}`}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          {item.started_at ? <Text style={styles.date}>{formatDateTime(item.started_at)}</Text> : null}
        </View>
        <Pressable testID={`rekap-delete-${item.id}`} style={styles.deleteBtn} onPress={() => setToDelete(item)} hitSlop={8}>
          <MaterialDesignIcons name="trash-can-outline" size={20} color={colors.error} />
        </Pressable>
      </View>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <MaterialDesignIcons name="eye" size={20} color={colors.brandPrimary} />
          <Text style={styles.statValue}>{item.recap.peak_viewers}</Text>
          <Text style={styles.statLabel}>Puncak Penonton</Text>
        </View>
        <View style={styles.stat}>
          <MaterialDesignIcons name="heart" size={20} color={colors.error} />
          <Text style={styles.statValue}>{item.recap.total_likes}</Text>
          <Text style={styles.statLabel}>Total Like</Text>
        </View>
        <View style={styles.stat}>
          <MaterialDesignIcons name="receipt-text-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.statValue}>{item.recap.orders_count}</Text>
          <Text style={styles.statLabel}>Pesanan</Text>
        </View>
      </View>
      {item.recap.orders_total > 0 ? (
        <Text style={styles.omzet}>Omzet saat live: {formatRupiah(item.recap.orders_total)}</Text>
      ) : null}
      <Pressable testID={`rekap-chat-${item.id}`} style={styles.chatBtn} onPress={() => setChatFor(item)}>
        <MaterialDesignIcons name="message-text-outline" size={16} color={colors.brandPrimary} />
        <Text style={styles.chatBtnText}>Lihat Chat Live</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={data ?? []}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <MaterialDesignIcons name="chart-box-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Belum ada rekap live.</Text>
            </View>
          ) : null
        }
      />
      <Modal visible={!!chatFor} transparent animationType="slide" onRequestClose={() => setChatFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChatFor(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>Chat Live — {chatFor?.title}</Text>
                {chatFor?.started_at ? <Text style={styles.modalSub}>{formatDateTime(chatFor.started_at)}</Text> : null}
              </View>
              <Pressable testID="chat-close" onPress={() => setChatFor(null)} hitSlop={10}>
                <MaterialDesignIcons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            {chatQuery.isLoading ? (
              <Text style={styles.modalEmpty}>Memuat chat...</Text>
            ) : (chatQuery.data?.messages?.length ?? 0) === 0 ? (
              <Text style={styles.modalEmpty}>Tidak ada chat di sesi ini.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
                {(chatQuery.data?.messages ?? []).map((m: LiveFeedMsg) =>
                  m.role === "system" ? (
                    <Text key={m.id} style={styles.chatJoin}>✨ {m.text}</Text>
                  ) : (
                    <View key={m.id} style={styles.chatRow}>
                      <Text style={styles.chatLine} numberOfLines={3}>
                        <Text style={styles.chatSender}>{m.role === "admin" ? "👑 " : ""}{m.name}: </Text>
                        {m.text}
                      </Text>
                      <Text style={styles.chatTime}>{fmtTime(m.ts)}</Text>
                    </View>
                  ),
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmDialog
        visible={!!toDelete}
        title="Hapus Rekap Live?"
        message={`Rekap "${toDelete?.title ?? ""}" akan dihapus permanen.`}
        confirmLabel="Hapus"
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 16, color: colors.onSurface },
  date: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  deleteBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textAlign: "center" },
  omzet: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary, marginTop: 8, textAlign: "center" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 80 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  chatBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingVertical: 10 },
  chatBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.onSurface },
  modalSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  modalEmpty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 28 },
  chatRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  chatLine: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.onSurface },
  chatSender: { fontFamily: fonts.bodyMedium, color: colors.brandPrimary },
  chatTime: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 1 },
  chatJoin: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 2 },
}));
