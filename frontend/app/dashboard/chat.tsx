import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { apiRequest } from "@/src/api/client";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Room = { room: string; nama: string; last_text: string; last_at: string | null; unread: number };

export default function AdminChatScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();

  const { data, refetch } = useQuery<Room[]>({
    queryKey: ["chat", "rooms"],
    queryFn: () => apiRequest<Room[]>("/api/chat/rooms"),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const renderItem = ({ item }: { item: Room }) => (
    <Pressable
      testID={`chat-room-${item.room}`}
      style={styles.card}
      onPress={() => router.push({ pathname: "/chat", params: { room: item.room, title: item.nama } })}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.nama || "?").charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{item.nama}</Text>
        <Text style={styles.last} numberOfLines={1}>{item.last_text || "—"}</Text>
      </View>
      {item.unread > 0 ? (
        <View style={styles.badge} testID={`unread-${item.room}`}>
          <Text style={styles.badgeText}>{item.unread}</Text>
        </View>
      ) : null}
      <MaterialDesignIcons name="chevron-right" size={22} color={colors.muted} />
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.room}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialDesignIcons name="chat-outline" size={56} color={colors.muted} />
            <Text style={styles.emptyText}>Belum ada percakapan</Text>
          </View>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.heading, fontSize: 18, color: colors.onBrandTertiary },
  name: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  last: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onBrandPrimary },
  empty: { alignItems: "center", gap: 8, paddingVertical: 100 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
}));
