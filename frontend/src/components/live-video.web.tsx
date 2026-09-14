// Live video — WEB implementation (agora-rtc-sdk-ng). Audience only on web.
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Text, View } from "react-native";

import { getLiveToken } from "@/src/api/live";
import { fonts } from "@/src/theme";

export type LiveFilterId = "none" | "halus" | "cerah" | "vivid" | "jernih" | "lowlight";
export type LiveQuality = "HD" | "normal" | "hemat";
export type LiveVideoHandle = {
  switchCamera: () => void;
  applyFilter: (id: LiveFilterId, level?: number) => void;
  setQuality: (q: LiveQuality) => void;
};

type Props = { role: "host" | "audience"; style?: any };

export const LiveVideo = forwardRef<LiveVideoHandle, Props>(function LiveVideo({ role, style }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({ switchCamera: () => {}, applyFilter: () => {}, setQuality: () => {} }), []);

  useEffect(() => {
    if (role === "host") return; // host camera only on native build
    let client: any;
    let remoteTrack: any;
    let cancelled = false;

    (async () => {
      try {
        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        const uid = Math.floor(Math.random() * 2_000_000_000) + 1;
        const t = await getLiveToken(role === "host" ? "host" : "audience", uid);
        client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
        await client.setClientRole("audience", { level: 2 });
        await client.join(t.appId, t.channel, t.token, uid);
        client.on("user-published", async (u: any, mediaType: string) => {
          await client.subscribe(u, mediaType);
          if (mediaType === "video" && containerRef.current && !cancelled) {
            remoteTrack = u.videoTrack;
            remoteTrack.play(containerRef.current);
          }
          if (mediaType === "audio") u.audioTrack?.play();
        });
      } catch (e) {
        // Silent fail — the parent screen shows product list regardless.
        console.log("live web error", e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        remoteTrack?.stop();
        client?.leave();
      } catch {}
    };
  }, [role]);

  // Host camera preview tidak tersedia di web — tampilkan pesan informatif,
  // bukan layar hitam kosong.
  if (role === "host") {
    return (
      <View style={[{ flex: 1, backgroundColor: "#1A0F2E", alignItems: "center", justifyContent: "center", padding: 24 }, style]}>
        <MaterialDesignIcons name="video-wireless-outline" size={44} color="#A855F7" />
        <Text style={{ color: "#fff", fontFamily: fonts.bodyMedium, fontSize: 15, textAlign: "center", marginTop: 12 }}>
          Kamera siaran hanya aktif di aplikasi HP (APK)
        </Text>
        <Text style={{ color: "#C9B8E8", fontFamily: fonts.body, fontSize: 13, textAlign: "center", marginTop: 6 }}>
          Penonton tetap melihat Anda dari aplikasi. Layar ini hanya preview di browser.
        </Text>
      </View>
    );
  }

  // Render a native View wrapping a DOM node for the video.
  return (
    <View style={style}>
      {/* @ts-expect-error web-only DOM node inside RN Web */}
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#000" }} />
    </View>
  );
});
