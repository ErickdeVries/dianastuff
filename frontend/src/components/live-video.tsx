// Fallback module for TypeScript/Metro resolution. At runtime Metro picks the
// platform-specific implementation (live-video.web.tsx / live-video.native.tsx).
import { View } from "react-native";

type Props = { role: "host" | "audience"; style?: any };

export function LiveVideo(_props: Props) {
  return <View style={_props.style} />;
}
