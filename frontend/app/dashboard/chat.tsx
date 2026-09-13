import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { Text, View } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function ChatScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.root} testID="chat-placeholder">
      <MaterialDesignIcons name="chat-outline" size={56} color={colors.brandSecondary} />
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.desc}>Fitur chat pembeli akan segera hadir. Untuk sekarang, komunikasi lewat WhatsApp toko.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  desc: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },
}));
