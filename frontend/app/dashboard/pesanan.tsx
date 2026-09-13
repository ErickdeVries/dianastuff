import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { Text, View } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function PesananScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.root} testID="pesanan-placeholder">
      <MaterialDesignIcons name="receipt-text-outline" size={56} color={colors.brandSecondary} />
      <Text style={styles.title}>Pesanan</Text>
      <Text style={styles.desc}>Fitur pesanan akan segera hadir. Pembeli akan bisa checkout dan mengirim order lewat WhatsApp.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.onSurface },
  desc: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },
}));
