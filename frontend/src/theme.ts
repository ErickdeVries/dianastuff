// Design tokens for Diana Stuff. Material 3 Expressive, light theme only.
//
// The keys match the "color" block of /app/design_guidelines.json. Values are
// filled from the design guidelines (Soft Purple #A855F7 on a #FAF5FF canvas).
// Never write color literals in components; read colors via makeStyles/useTheme.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FAF5FF",
  onSurface: "#1A1124",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1124",
  surfaceTertiary: "#F3E8FF",
  onSurfaceTertiary: "#3B0764",
  surfaceInverse: "#2A1D38",
  onSurfaceInverse: "#F3E8FF",
  muted: "#6B7280",

  // Brand
  brand: "#A855F7",
  onBrand: "#FFFFFF",
  brandPrimary: "#A855F7",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D8B4FE",
  onBrandSecondary: "#3B0764",
  brandTertiary: "#E9D5FF",
  onBrandTertiary: "#3B0764",

  // Status
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E5E7EB",
  borderStrong: "#A855F7",
  divider: "#F3F4F6",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

// Font families loaded in app/_layout.tsx via expo-font.
export const fonts = {
  heading: "Poppins-SemiBold",
  headingMedium: "Poppins-Medium",
  headingRegular: "Poppins-Regular",
  body: "Inter-Regular",
  bodyMedium: "Inter-Medium",
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
