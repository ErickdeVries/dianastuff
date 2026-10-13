// Native (iOS/Android) interactive map pinpoint via react-native-webview.
// Supports two-way binding: when `value` changes from OUTSIDE the map (e.g. the
// user geocoded a typed address), the pin recenters via injected JS.
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { buildMapHtml, MapPoint } from "@/src/components/map-html";

export type { MapPoint };

type Props = {
  value?: MapPoint | null;
  onChange: (p: MapPoint) => void;
  height?: number;
};

function keyOf(p: MapPoint) {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

export function MapPicker({ value, onChange, height = 300 }: Props) {
  const ref = useRef<WebView>(null);
  const lat = value?.lat ?? -6.2;
  const lng = value?.lng ?? 106.816666;
  const html = useMemo(() => buildMapHtml(lat, lng), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lastFromMap = useRef<string>(keyOf({ lat, lng }));

  // External value change -> recenter the pin (skip if it came from the map).
  useEffect(() => {
    if (!value) return;
    const k = keyOf(value);
    if (k === lastFromMap.current) return;
    ref.current?.injectJavaScript(`window.setPin(${value.lat}, ${value.lng}, true); true;`);
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        ref={ref}
        testID="map-picker"
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        geolocationEnabled
        onMessage={(e) => {
          try {
            const p = JSON.parse(e.nativeEvent.data);
            if (typeof p.lat === "number" && typeof p.lng === "number") {
              lastFromMap.current = keyOf(p);
              onChange({ lat: p.lat, lng: p.lng, address: p.address });
            }
          } catch {
            // ignore
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: "hidden", backgroundColor: "#eee" },
  web: { flex: 1, backgroundColor: "transparent" },
});
