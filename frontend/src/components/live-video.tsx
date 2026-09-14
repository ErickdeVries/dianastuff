// Fallback module for TypeScript/Metro resolution. At runtime Metro picks the
// platform-specific implementation (live-video.web.tsx / live-video.native.tsx).
import { forwardRef, useImperativeHandle } from "react";
import { View } from "react-native";

export type LiveFilterId = "none" | "halus" | "cerah" | "vivid" | "jernih" | "lowlight";
export type LiveQuality = "HD" | "normal" | "hemat";
export type LiveVideoHandle = {
  switchCamera: () => void;
  applyFilter: (id: LiveFilterId, level?: number) => void;
  setQuality: (q: LiveQuality) => void;
};

type Props = { role: "host" | "audience"; style?: any };

export const LiveVideo = forwardRef<LiveVideoHandle, Props>(function LiveVideo(props, ref) {
  useImperativeHandle(ref, () => ({ switchCamera: () => {}, applyFilter: () => {}, setQuality: () => {} }), []);
  return <View style={props.style} />;
});
