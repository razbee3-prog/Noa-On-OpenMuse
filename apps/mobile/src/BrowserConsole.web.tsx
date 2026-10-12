import { useEffect, useRef } from "react";
import { colors } from "./ui";

export default function BrowserConsole({
  url,
  title = "Remote browser session console",
  sandboxed = false,
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
  const ref = useRef<HTMLIFrameElement>(null);
  const sendControl = () => {
    if (control !== undefined)
      ref.current?.contentWindow?.postMessage({ type: "control", value: control }, "*");
  };
  useEffect(sendControl, [control]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source === ref.current?.contentWindow && event.data?.type === "locked")
        onLocked?.();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onLocked]);
  return (
    <iframe
      ref={ref}
      title={title}
      src={url}
      onLoad={sendControl}
      sandbox={sandboxed ? "allow-scripts allow-same-origin allow-pointer-lock" : undefined}
      referrerPolicy={sandboxed ? "no-referrer" : undefined}
      style={
        fill
          ? { flex: 1, height: "100%", width: "100%", border: 0, background: "#111416" }
          : { height: 540, width: "100%", border: 0, borderRadius: 12, background: colors.onDark }
      }
    />
  );
}
