import { Check, Globe2, Maximize2, RotateCw } from "lucide-react-native";
import { createContext, useContext, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, Text, View } from "react-native";
import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src";
import { Button, Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

export const BrowserRunContext = createContext({ running: false, active: false });

const observationSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  url: z.url(),
});

function resultValue(result: unknown) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function siteLabel(url: unknown) {
  if (typeof url !== "string") return "Opening a page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Opening a page";
  }
}

/** A server tool result stays with the request that produced it, including on replay. */
export function BrowserToolCard({
  url,
  result,
  loading,
}: {
  url: unknown;
  result: unknown;
  loading: boolean;
}) {
  const { api, workspace, open } = useWorkspace();
  const { active } = useContext(BrowserRunContext);
  const working = loading && active;
  const value = resultValue(result);
  const observation = observationSchema.safeParse(value);
  const toolError = z.object({ error: z.string() }).safeParse(value);
  const sessionId = observation.success ? observation.data.sessionId : undefined;
  const current = workspace.browsers.find((browser) => browser.id === sessionId);
  const [browser, setBrowser] = useState<BrowserSession>();
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    async function connect() {
      setError("");
      setPreviewFailed(false);
      try {
        const session = await api.request<BrowserSession>(
          `/api/browsers/${encodeURIComponent(sessionId || "")}`,
        );
        if (active) setBrowser(session);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void connect();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void connect();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [api, sessionId, current?.updatedAt, retry]);

  const visited = observation.success ? observation.data : undefined;
  // A later turn can reuse the same browser. Never label that new page as an old source.
  const preview =
    browser?.status === "active" && browser.url === visited?.url && !previewFailed
      ? browser.previewUrl
      : undefined;
  const failure = toolError.success
    ? toolError.data.error
    : !loading && !visited
      ? "The browser did not return a page. Try your request again."
      : "";
  return (
    <Card
      style={{ padding: 13, backgroundColor: colors.line, gap: 12, width: "100%", maxWidth: 440 }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 10 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>Browser</Text>
          <Text numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
            {working
              ? "Reading the page…"
              : loading
                ? "Browsing paused"
                : failure
                  ? "Couldn’t read the page"
                  : siteLabel(visited?.url)}
          </Text>
        </View>
        {working ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : visited ? (
          <Check size={17} color={colors.success} accessibilityLabel="Page read" />
        ) : null}
      </View>
      {preview ? (
        <View style={{ height: 210, borderRadius: 12, overflow: "hidden" }}>
          <Image
            accessibilityLabel={`Browser preview: ${visited?.title}`}
            source={{ uri: api.url(preview) }}
            style={{ width: "100%", aspectRatio: 412 / 860, backgroundColor: colors.card }}
            resizeMode="cover"
            onError={() => setPreviewFailed(true)}
          />
        </View>
      ) : (
        <View style={{ backgroundColor: colors.canvas, borderRadius: 12, padding: 21, gap: 12 }}>
          <Text numberOfLines={2} style={[s.text, { fontSize: 14 }]}>
            {visited?.title || siteLabel(url)}
          </Text>
          {working ? (
            <View style={{ gap: 8 }}>
              {(["90%", "74%", "84%"] as const).map((width) => (
                <View
                  key={width}
                  style={{ height: 7, width, borderRadius: 4, backgroundColor: colors.track }}
                />
              ))}
            </View>
          ) : visited ? (
            <Text style={s.small}>
              {browser && browser.url !== visited.url
                ? "Page visited. The browser has moved on."
                : browser?.status === "closed"
                  ? "Session saved. Open the browser to reopen it."
                  : browser?.status === "error"
                    ? "Session needs attention. Open the browser to reconnect."
                    : previewFailed
                      ? "Preview unavailable. You can still open the browser."
                      : "Connecting to the saved session…"}
            </Text>
          ) : null}
        </View>
      )}
      <ErrorNotice error={failure || error} />
      {!loading && visited && (
        <Button
          icon={Maximize2}
          disabled={!browser}
          onPress={() => browser && open({ type: "browser", browser })}
          style={{ backgroundColor: colors.canvas, minHeight: 38, paddingVertical: 8 }}
        >
          Open browser
        </Button>
      )}
      {!!error && (
        <Button small icon={RotateCw} onPress={() => setRetry((attempt) => attempt + 1)}>
          Reconnect preview
        </Button>
      )}
    </Card>
  );
}
