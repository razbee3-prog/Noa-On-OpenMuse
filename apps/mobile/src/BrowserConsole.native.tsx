import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { ErrorNotice } from "./ui";

// `title` labels the web iframe; the native WebView has no equivalent.
export default function BrowserConsole({
  url,
  control,
  onLocked,
  fill = false,
}: {
  url: string;
  title?: string;
  sandboxed?: boolean;
  control?: boolean;
  onLocked?: () => void;
  fill?: boolean;
}) {
  const [error, setError] = useState("");
  const ref = useRef<WebView>(null);
  const sendControl = () => {
    if (control !== undefined)
      ref.current?.injectJavaScript(
        `window.postMessage({ type: "control", value: ${control} }, "*"); true;`,
      );
  };
  useEffect(sendControl, [control]);
  return (
    <View style={fill ? { flex: 1 } : undefined}>
      <ErrorNotice error={error} />
      <WebView
        ref={ref}
        source={{ uri: url }}
        onError={(event) => setError(event.nativeEvent.description)}
        onLoadEnd={sendControl}
        onMessage={(event) => {
          try {
            if (JSON.parse(event.nativeEvent.data)?.type === "locked") onLocked?.();
          } catch {}
        }}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        style={fill ? { flex: 1, backgroundColor: "#111416" } : { height: 620, borderRadius: 12 }}
      />
    </View>
  );
}
