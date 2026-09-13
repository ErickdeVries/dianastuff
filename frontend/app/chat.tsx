import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api/client";
import { pickAndUploadImages } from "@/src/api/uploads";
import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/context/toast";
import { connectSocket } from "@/src/lib/socket";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

type Message = {
  id: string;
  room: string;
  sender_id: string;
  sender_role: string;
  sender_nama?: string;
  text?: string | null;
  image_url?: string | null;
  created_at?: string | null;
};

export default function ChatScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ room?: string; title?: string }>();

  const room = user?.role === "admin" ? params.room ?? "" : user?.user_id ?? "";
  const title = params.title || (user?.role === "admin" ? "Chat Pembeli" : "Chat Admin");

  const markRead = () => {
    apiRequest("/api/chat/read", { method: "POST", body: user?.role === "admin" ? { room } : {} })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["chat", "unread"] });
        queryClient.invalidateQueries({ queryKey: ["chat", "rooms"] });
      })
      .catch(() => {});
  };

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const { data: history } = useQuery<Message[]>({
    queryKey: ["chat", room],
    queryFn: () => apiRequest<Message[]>(`/api/chat/history${room ? `?room=${encodeURIComponent(room)}` : ""}`),
    enabled: !!room,
  });

  useEffect(() => {
    if (history) setMessages(history);
    if (history && room) markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  useEffect(() => {
    if (!room) return;
    let active = true;
    let socketRef: any = null;
    let doJoin: (() => void) | null = null;
    let onMessage: ((msg: Message) => void) | null = null;
    (async () => {
      const socket = await connectSocket();
      socketRef = socket;
      doJoin = () => socket.emit("join", { room });
      if (socket.connected) doJoin();
      socket.on("connect", doJoin);
      onMessage = (msg: Message) => {
        if (!active || msg.room !== room) return;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (msg.sender_id !== user?.user_id) markRead();
      };
      socket.on("message", onMessage);
    })();
    return () => {
      active = false;
      if (socketRef) {
        // Remove only this screen's listeners — the shared socket is also
        // used by other screens (e.g. the admin room list).
        if (onMessage) socketRef.off("message", onMessage);
        if (doJoin) socketRef.off("connect", doJoin);
      }
    };
  }, [room]);

  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const send = async (payload: { text?: string; image_url?: string }) => {
    if (!room) return;
    const socket = await connectSocket();
    socket.emit("message", { room, ...payload });
  };

  const onSendText = () => {
    const t = text.trim();
    if (!t) return;
    send({ text: t });
    setText("");
  };

  const onSendImage = async () => {
    setSending(true);
    try {
      const res = await pickAndUploadImages(1);
      if (res.permissionDenied) {
        toast.show(res.canAskAgain ? "Izin galeri diperlukan" : "Izin galeri diblokir. Buka Pengaturan", "error");
        return;
      }
      if (res.error) { toast.show(res.error, "error"); return; }
      if (res.urls[0]) send({ image_url: res.urls[0] });
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const mine = item.sender_id === user?.user_id;
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {item.image_url ? (
            <Image source={{ uri: resolveImageUrl(item.image_url) }} style={styles.msgImage} contentFit="cover" />
          ) : null}
          {item.text ? (
            <Text style={[styles.msgText, { color: mine ? colors.onBrandPrimary : colors.onSurface }]}>{item.text}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="chat-back" onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <MaterialDesignIcons name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialDesignIcons name="chat-outline" size={48} color={colors.muted} />
            <Text style={styles.emptyText}>Mulai percakapan</Text>
          </View>
        }
      />

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable testID="chat-image" onPress={onSendImage} disabled={sending} style={styles.iconBtn}>
            <MaterialDesignIcons name="image-plus" size={24} color={colors.brandPrimary} />
          </Pressable>
          <TextInput
            testID="chat-input"
            style={styles.input}
            placeholder="Tulis pesan..."
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable testID="chat-send" onPress={onSendText} style={styles.sendBtn}>
            <MaterialDesignIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: fonts.heading, fontSize: 18, color: colors.onSurface },
  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: 18, padding: 10, gap: 6 },
  bubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  msgText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  msgImage: { width: 180, height: 180, borderRadius: 12, backgroundColor: colors.surfaceTertiary },
  empty: { alignItems: "center", gap: 8, paddingVertical: 100 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
