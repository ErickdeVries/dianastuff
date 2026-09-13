import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type ToastType = "success" | "error" | "info";
type ToastState = { message: string; type: ToastType } | null;

const ToastContext = createContext<{ show: (message: string, type?: ToastType) => void } | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
  }, [opacity]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const bg = toast?.type === "success" ? colors.success : toast?.type === "error" ? colors.error : colors.surfaceInverse;
  const fg = toast?.type === "success" ? colors.onSuccess : toast?.type === "error" ? colors.onError : colors.onSurfaceInverse;
  const icon = toast?.type === "success" ? "check-circle" : toast?.type === "error" ? "alert-circle" : "information";

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { bottom: insets.bottom + 24, opacity }]}
          testID="toast"
        >
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <MaterialDesignIcons name={icon as any} size={20} color={fg} />
            <Text style={[styles.text, { color: fg }]}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const useStyles = makeStyles(() => ({
  wrap: { position: "absolute", left: 20, right: 20, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    maxWidth: 420,
  },
  text: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14 },
}));
