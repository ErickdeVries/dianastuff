// Live video — NATIVE implementation (react-native-agora).
// Loaded via runtime require so Expo Go (which lacks the native module) shows
// a friendly message instead of crashing. Full video works only in a build.
//
// Exposes an imperative handle so the host screen can switch camera and apply
// camera filters without tearing down the live session.
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { PermissionsAndroid, Platform, Text, View } from "react-native";

import { getLiveToken } from "@/src/api/live";
import { fonts, useTheme } from "@/src/theme";

export type LiveFilterId = "none" | "halus" | "cerah" | "vivid" | "jernih" | "lowlight";
export type LiveQuality = "HD" | "normal" | "hemat";
export type LiveVideoHandle = {
  switchCamera: () => void;
  applyFilter: (id: LiveFilterId, level?: number) => void;
  setQuality: (q: LiveQuality) => void;
};

type Props = { role: "host" | "audience"; style?: any };

let Agora: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Agora = require("react-native-agora");
} catch {
  Agora = null;
}

export const LiveVideo = forwardRef<LiveVideoHandle, Props>(function LiveVideo({ role, style }, ref) {
  const { colors } = useTheme();
  const engineRef = useRef<any>(null);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [selfUid] = useState(() =>
    role === "host" ? 1 : Math.floor(Math.random() * 2_000_000_000) + 2,
  );
  const [err, setErr] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    switchCamera: () => {
      try {
        engineRef.current?.switchCamera();
      } catch {}
    },
    applyFilter: (id: LiveFilterId, level?: number) => {
      const e = engineRef.current;
      if (!e) return;
      const lv = typeof level === "number" ? Math.max(0, Math.min(1, level)) : 0.6;
      // Reset all enhancers first.
      try { e.setBeautyEffectOptions(false, {}); } catch {}
      try { e.setColorEnhanceOptions(false, {}); } catch {}
      try { e.setLowlightEnhanceOptions(false, {}); } catch {}
      try { e.setVideoDenoiserOptions(false, {}); } catch {}
      // Enable the clear-vision extension for colour/low-light filters.
      try { e.enableExtension("agora_video_filters_clear_vision", "clear_vision", true); } catch {}
      try {
        if (id === "halus") {
          e.setBeautyEffectOptions(true, { lighteningContrastLevel: 1, lighteningLevel: 0.4 + lv * 0.3, smoothnessLevel: lv, rednessLevel: 0.3, sharpnessLevel: 0.4 });
        } else if (id === "cerah") {
          e.setBeautyEffectOptions(true, { lighteningContrastLevel: 2, lighteningLevel: lv, smoothnessLevel: 0.3 + lv * 0.3, rednessLevel: 0.2, sharpnessLevel: 0.2 });
        } else if (id === "vivid") {
          e.setColorEnhanceOptions(true, { strengthLevel: 0.7, skinProtectLevel: 0.7 });
        } else if (id === "jernih") {
          e.setVideoDenoiserOptions(true, {});
        } else if (id === "lowlight") {
          e.setLowlightEnhanceOptions(true, {});
        }
      } catch {}
    },
    setQuality: (q: LiveQuality) => {
      const e = engineRef.current;
      if (!e) return;
      const cfg =
        q === "HD"
          ? { dimensions: { width: 1280, height: 720 }, frameRate: 24, bitrate: 0 }
          : q === "hemat"
            ? { dimensions: { width: 480, height: 360 }, frameRate: 15, bitrate: 400 }
            : { dimensions: { width: 640, height: 480 }, frameRate: 15, bitrate: 0 };
      try { e.setVideoEncoderConfiguration(cfg); } catch {}
    },
  }), []);

  useEffect(() => {
    if (!Agora?.createAgoraRtcEngine) {
      setErr("expo-go");
      return;
    }
    let engine: any;
    let handler: any;
    (async () => {
      try {
        if (Platform.OS === "android") {
          const result = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
          const granted = Object.values(result).every(
            (v) => v === PermissionsAndroid.RESULTS.GRANTED,
          );
          if (!granted) {
            setErr("Izin kamera & mikrofon ditolak. Aktifkan di Pengaturan HP lalu coba lagi.");
            return;
          }
        }
        const t = await getLiveToken(role, selfUid);
        engine = Agora.createAgoraRtcEngine();
        engineRef.current = engine;
        engine.initialize({ appId: t.appId });
        handler = {
          onJoinChannelSuccess: () => setJoined(true),
          onUserJoined: (_c: any, uid: number) => setRemoteUid(uid),
          onUserOffline: () => setRemoteUid(null),
          onError: (code: number, msg: string) => setErr(`Agora error ${code}: ${msg || ""}`),
          onTokenPrivilegeWillExpire: async () => {
            const fresh = await getLiveToken(role, selfUid);
            engine.renewToken(fresh.token);
          },
        };
        engine.registerEventHandler(handler);
        engine.enableVideo();
        if (role === "host") {
          const rc = engine.startPreview();
          if (rc === 0) {
            setPreviewReady(true);
          } else {
            setErr(`Kamera gagal dibuka (kode ${rc}). Tutup aplikasi lain yang memakai kamera lalu coba lagi.`);
          }
        }
        engine.joinChannel(t.token, t.channel, selfUid, {
          channelProfile: Agora.ChannelProfileType.ChannelProfileLiveBroadcasting,
          clientRoleType:
            role === "host"
              ? Agora.ClientRoleType.ClientRoleBroadcaster
              : Agora.ClientRoleType.ClientRoleAudience,
          publishCameraTrack: role === "host",
          publishMicrophoneTrack: role === "host",
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        });
      } catch (e: any) {
        setErr(e?.message || "Gagal memulai live");
      }
    })();

    return () => {
      try {
        engine?.stopPreview?.();
        engine?.leaveChannel();
        if (handler) engine?.unregisterEventHandler(handler);
        engine?.release();
      } catch {}
      engineRef.current = null;
    };
  }, [role, selfUid]);

  if (err === "expo-go") {
    return (
      <View style={[{ alignItems: "center", justifyContent: "center", backgroundColor: "#000", padding: 24 }, style]}>
        <MaterialDesignIcons name="video-wireless-outline" size={40} color="#fff" />
        <Text style={{ color: "#fff", fontFamily: fonts.bodyMedium, textAlign: "center", marginTop: 10 }}>
          Fitur live memerlukan aplikasi hasil build (tidak jalan di Expo Go).
        </Text>
      </View>
    );
  }

  const RtcSurfaceView = Agora?.RtcSurfaceView;
  // UID HARUS sama antara joinChannel dan canvas render (panduan resmi Agora),
  // plus sourceType kamera eksplisit untuk preview lokal host.
  const showUid = role === "host" ? selfUid : remoteUid;
  const canShow = role === "host" ? previewReady : joined && remoteUid != null;

  return (
    <View style={[{ backgroundColor: "#000" }, style]}>
      {RtcSurfaceView && canShow && showUid != null ? (
        <RtcSurfaceView
          canvas={{
            uid: showUid,
            // Host = kamera lokal; penonton = stream REMOTE host (wajib beda sourceType!).
            sourceType:
              role === "host"
                ? Agora.VideoSourceType?.VideoSourceCamera
                : Agora.VideoSourceType?.VideoSourceRemote,
          }}
          style={{ flex: 1 }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <MaterialDesignIcons name="access-point" size={40} color={colors.brandPrimary} />
          <Text style={{ color: "#fff", fontFamily: fonts.body, marginTop: 8, textAlign: "center" }}>
            {role === "host" ? "Menyiapkan kamera..." : "Menunggu siaran host..."}
          </Text>
          {err ? (
            <Text style={{ color: "#f88", fontFamily: fonts.body, marginTop: 8, fontSize: 12, textAlign: "center" }}>{err}</Text>
          ) : null}
        </View>
      )}
      {/* Status diagnostik kecil untuk host (membantu laporan jika masih hitam) */}
      {role === "host" ? (
        <View style={{ position: "absolute", bottom: 4, left: 8 }} pointerEvents="none">
          <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 9, fontFamily: fonts.body }}>
            cam:{previewReady ? "on" : "off"} join:{joined ? "ok" : "..."}{err ? ` err:${err.slice(0, 40)}` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
