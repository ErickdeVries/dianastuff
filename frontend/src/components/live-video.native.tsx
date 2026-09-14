// Live video — NATIVE implementation (react-native-agora).
// Loaded via runtime require so Expo Go (which lacks the native module) shows
// a friendly message instead of crashing. Full video works only in a build.
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, Text, View } from "react-native";

import { getLiveToken } from "@/src/api/live";
import { fonts, useTheme } from "@/src/theme";

type Props = { role: "host" | "audience"; style?: any };

let Agora: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Agora = require("react-native-agora");
} catch {
  Agora = null;
}

export function LiveVideo({ role, style }: Props) {
  const { colors } = useTheme();
  const engineRef = useRef<any>(null);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [selfUid] = useState(() =>
    role === "host" ? 1 : Math.floor(Math.random() * 2_000_000_000) + 2,
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!Agora?.createAgoraRtcEngine) {
      setErr("expo-go");
      return;
    }
    let engine: any;
    (async () => {
      try {
        if (Platform.OS === "android") {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
        }
        const t = await getLiveToken(role, selfUid);
        engine = Agora.createAgoraRtcEngine();
        engineRef.current = engine;
        engine.initialize({
          appId: t.appId,
          channelProfile: Agora.ChannelProfileType.ChannelProfileLiveBroadcasting,
        });
        engine.registerEventHandler({
          onJoinChannelSuccess: () => setJoined(true),
          onUserJoined: (_c: any, uid: number) => setRemoteUid(uid),
          onUserOffline: () => setRemoteUid(null),
          onTokenPrivilegeWillExpire: async () => {
            const fresh = await getLiveToken(role, selfUid);
            engine.renewToken(fresh.token);
          },
        });
        engine.enableVideo();
        if (role === "host") engine.startPreview();
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
        engine?.leaveChannel();
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
  const showUid = role === "host" ? selfUid : remoteUid;

  return (
    <View style={[{ backgroundColor: "#000" }, style]}>
      {RtcSurfaceView && joined && showUid != null ? (
        <RtcSurfaceView canvas={{ uid: showUid }} style={{ flex: 1 }} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <MaterialDesignIcons name="access-point" size={40} color={colors.brandPrimary} />
          <Text style={{ color: "#fff", fontFamily: fonts.body, marginTop: 8 }}>
            {role === "host" ? "Menyiapkan kamera..." : "Menunggu siaran host..."}
          </Text>
          {err ? <Text style={{ color: "#f88", fontFamily: fonts.body, marginTop: 6, fontSize: 12 }}>{err}</Text> : null}
        </View>
      )}
    </View>
  );
}
