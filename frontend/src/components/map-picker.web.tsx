// Web (react-native-web) interactive map pinpoint via an <iframe srcDoc>.
// Supports two-way binding: external `value` changes recenter the pin by
// postMessage-ing a setPin command into the iframe.
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";

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
  const lat = value?.lat ?? -6.2;
  const lng = value?.lng ?? 106.816666;
  const html = useMemo(() => buildMapHtml(lat, lng), []); // eslint-disable-line react-hooks/exhaustive-deps
  const iframeRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastFromMap = useRef<string>(keyOf({ lat, lng }));

  // Map -> host
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const p = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (p && typeof p.lat === "number" && typeof p.lng === "number") {
          lastFromMap.current = keyOf(p);
          onChangeRef.current({ lat: p.lat, lng: p.lng, address: p.address });
        }
      } catch {
        // ignore non-map messages
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // External value change -> recenter pin (skip if it came from the map).
  useEffect(() => {
    if (!value) return;
    const k = keyOf(value);
    if (k === lastFromMap.current) return;
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ type: "setPin", lat: value.lat, lng: value.lng }), "*");
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.wrap, { height }]}>
      {/* @ts-expect-error — iframe is a DOM element available on react-native-web */}
      <iframe ref={iframeRef} title="map" srcDoc={html} allow="geolocation" style={{ border: "0", width: "100%", height: "100%" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: "hidden", backgroundColor: "#eee" },
});
