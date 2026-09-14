// Live video — WEB implementation (agora-rtc-sdk-ng). Audience only on web.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";

import { getLiveToken } from "@/src/api/live";

export type LiveFilterId = "none" | "halus" | "cerah" | "vivid" | "jernih" | "lowlight";
export type LiveVideoHandle = {
  switchCamera: () => void;
  applyFilter: (id: LiveFilterId) => void;
};

type Props = { role: "host" | "audience"; style?: any };

export const LiveVideo = forwardRef<LiveVideoHandle, Props>(function LiveVideo({ role, style }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({ switchCamera: () => {}, applyFilter: () => {} }), []);

  useEffect(() => {
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

  // Render a native View wrapping a DOM node for the video.
  return (
    <View style={style}>
      {/* @ts-expect-error web-only DOM node inside RN Web */}
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#000" }} />
    </View>
  );
});
