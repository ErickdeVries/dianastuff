// Shopee-style product variation editor: up to 2 variation groups, with an
// auto-generated combination matrix where each combo has its own price,
// discount price, stock, and photo.
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { pickAndUploadImages } from "@/src/api/uploads";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { resolveImageUrl } from "@/src/utils/image";

export type VarGroup = { name: string; options: string[] };
export type Combo = { options: string[]; harga: number; harga_diskon?: number | null; stok: number; foto?: string | null };

const PRESET_NAMES = ["Ukuran", "Berat", "Warna", "Volume", "Aroma", "Ukuran Curling", "Jenis Kulit"];

function cartesian(groups: VarGroup[]): string[][] {
  const lists = groups.map((g) => g.options).filter((o) => o.length > 0);
  if (lists.length === 0) return [];
  return lists.reduce<string[][]>(
    (acc, opts) => acc.flatMap((combo) => opts.map((o) => [...combo, o])),
    [[]],
  );
}

function keyOf(options: string[]) {
  return options.join("|");
}

export function VariationEditor({
  variations,
  combinations,
  onChange,
}: {
  variations: VarGroup[];
  combinations: Combo[];
  onChange: (variations: VarGroup[], combinations: Combo[]) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [optionDraft, setOptionDraft] = useState<Record<number, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // Rebuild combos from current groups, preserving existing values by key.
  const rebuild = (groups: VarGroup[]) => {
    const existing: Record<string, Combo> = {};
    for (const c of combinations) existing[keyOf(c.options)] = c;
    const combos = cartesian(groups).map((opts) => {
      const k = keyOf(opts);
      return existing[k] ?? { options: opts, harga: 0, harga_diskon: null, stok: 0, foto: null };
    });
    onChange(groups, combos);
  };

  const setGroupName = (gi: number, name: string) => {
    const groups = variations.map((g, i) => (i === gi ? { ...g, name } : g));
    rebuild(groups);
  };

  const addOption = (gi: number) => {
    const val = (optionDraft[gi] || "").trim();
    if (!val) return;
    const g = variations[gi];
    if (g.options.includes(val)) return;
    const groups = variations.map((x, i) => (i === gi ? { ...x, options: [...x.options, val] } : x));
    setOptionDraft((p) => ({ ...p, [gi]: "" }));
    rebuild(groups);
  };

  const removeOption = (gi: number, opt: string) => {
    const groups = variations.map((x, i) => (i === gi ? { ...x, options: x.options.filter((o) => o !== opt) } : x));
    rebuild(groups);
  };

  const addGroup = () => {
    if (variations.length >= 2) return;
    rebuild([...variations, { name: "", options: [] }]);
  };

  const removeGroup = (gi: number) => {
    rebuild(variations.filter((_, i) => i !== gi));
  };

  const updateCombo = (k: string, patch: Partial<Combo>) => {
    onChange(variations, combinations.map((c) => (keyOf(c.options) === k ? { ...c, ...patch } : c)));
  };

  const uploadComboFoto = async (k: string) => {
    setUploadingKey(k);
    try {
      const res = await pickAndUploadImages(1);
      if (res.urls.length) updateCombo(k, { foto: res.urls[0] });
    } finally {
      setUploadingKey(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {variations.map((g, gi) => (
        <View key={gi} style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>Variasi {gi + 1}</Text>
            <Pressable testID={`remove-group-${gi}`} onPress={() => removeGroup(gi)} hitSlop={8}>
              <MaterialDesignIcons name="close" size={18} color={colors.error} />
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Nama variasi</Text>
          <TextInput
            testID={`group-name-${gi}`}
            value={g.name}
            onChangeText={(t) => setGroupName(gi, t)}
            placeholder="mis. Warna"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <View style={styles.presetRow}>
            {PRESET_NAMES.map((n) => (
              <Pressable key={n} onPress={() => setGroupName(gi, n)} style={[styles.presetChip, g.name === n && styles.presetChipActive]}>
                <Text style={[styles.presetText, g.name === n && styles.presetTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Opsi</Text>
          <View style={styles.optChips}>
            {g.options.map((opt) => (
              <View key={opt} style={styles.optChip}>
                <Text style={styles.optChipText}>{opt}</Text>
                <Pressable testID={`remove-opt-${gi}-${opt}`} onPress={() => removeOption(gi, opt)} hitSlop={6}>
                  <MaterialDesignIcons name="close-circle" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </View>
          <View style={styles.addOptRow}>
            <TextInput
              testID={`opt-input-${gi}`}
              value={optionDraft[gi] || ""}
              onChangeText={(t) => setOptionDraft((p) => ({ ...p, [gi]: t }))}
              onSubmitEditing={() => addOption(gi)}
              placeholder="Tambah opsi (mis. Merah)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable testID={`add-opt-${gi}`} onPress={() => addOption(gi)} style={styles.addOptBtn}>
              <MaterialDesignIcons name="plus" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </View>
      ))}

      {variations.length < 2 ? (
        <Pressable testID="add-variation-group" onPress={addGroup} style={styles.addGroupBtn}>
          <MaterialDesignIcons name="plus" size={18} color={colors.brandPrimary} />
          <Text style={styles.addGroupText}>Tambah Variasi</Text>
        </Pressable>
      ) : null}

      {combinations.length > 0 ? (
        <View style={styles.matrix}>
          <Text style={styles.matrixTitle}>Daftar Harga & Stok per Kombinasi</Text>
          {combinations.map((c) => {
            const k = keyOf(c.options);
            const cover = resolveImageUrl(c.foto);
            return (
              <View key={k} style={styles.comboRow} testID={`combo-${k}`}>
                <Pressable testID={`combo-foto-${k}`} onPress={() => uploadComboFoto(k)} style={styles.comboFoto}>
                  {uploadingKey === k ? (
                    <ActivityIndicator color={colors.brandPrimary} />
                  ) : cover ? (
                    <Image source={{ uri: cover }} style={styles.comboFotoImg} contentFit="cover" />
                  ) : (
                    <MaterialDesignIcons name="camera-plus-outline" size={20} color={colors.muted} />
                  )}
                </Pressable>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.comboLabel}>{c.options.join(" / ")}</Text>
                  <View style={styles.comboInputs}>
                    <View style={styles.comboField}>
                      <Text style={styles.comboFieldLabel}>Harga</Text>
                      <TextInput
                        testID={`combo-harga-${k}`}
                        value={c.harga ? String(c.harga) : ""}
                        onChangeText={(t) => updateCombo(k, { harga: parseFloat(t) || 0 })}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.comboField}>
                      <Text style={styles.comboFieldLabel}>Stok</Text>
                      <TextInput
                        testID={`combo-stok-${k}`}
                        value={c.stok ? String(c.stok) : ""}
                        onChangeText={(t) => updateCombo(k, { stok: parseInt(t, 10) || 0 })}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                      />
                    </View>
                  </View>
                  <View style={styles.comboField}>
                    <Text style={styles.comboFieldLabel}>Harga Diskon (opsional)</Text>
                    <TextInput
                      testID={`combo-diskon-${k}`}
                      value={c.harga_diskon ? String(c.harga_diskon) : ""}
                      onChangeText={(t) => updateCombo(k, { harga_diskon: t.trim() ? parseFloat(t) || 0 : null })}
                      keyboardType="number-pad"
                      placeholder="Kosongkan jika tanpa diskon"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: 12 },
  groupCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, gap: 8 },
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.onSurface },
  fieldLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 4 },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 14, color: colors.onSurface,
  },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  presetChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  presetChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  presetText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceTertiary },
  presetTextActive: { color: colors.brandPrimary },
  optChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  optChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandTertiary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  optChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brandPrimary },
  addOptRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addOptBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  addGroupBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brandPrimary },
  addGroupText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brandPrimary },
  matrix: { gap: 10, marginTop: 4 },
  matrixTitle: { fontFamily: fonts.heading, fontSize: 15, color: colors.onSurface },
  comboRow: { flexDirection: "row", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12 },
  comboFoto: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  comboFotoImg: { width: 56, height: 56 },
  comboLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.onSurface },
  comboInputs: { flexDirection: "row", gap: 8 },
  comboField: { flex: 1, gap: 4 },
  comboFieldLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
}));
