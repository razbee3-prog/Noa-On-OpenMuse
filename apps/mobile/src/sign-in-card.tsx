import { Check, Hand, LogIn } from "lucide-react-native";
import { useContext, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src";
import { JevInteractionContext } from "./jev-tool-card";
import { Button, Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

const signInSchema = z.object({
  kind: z.literal("sign_in"),
  site: z.string(),
  reason: z.string(),
  sessionId: z.string(),
});

function parse(result: unknown) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const parsed = signInSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** "Open browser to sign in" opens the existing Take control console on the agent's browser;
 * the person types any password or code there, never into chat. */
export function SignInPanel({
  site,
  reason,
  sessionId,
  onConfirm,
  confirmed = false,
}: {
  site: string;
  reason: string;
  sessionId: string;
  onConfirm: () => Promise<void>;
  confirmed?: boolean;
}) {
  const { api, open } = useWorkspace();
  const [busy, setBusy] = useState<"" | "open" | "confirm">("");
  const [error, setError] = useState("");
  async function takeControl() {
    setBusy("open");
    setError("");
    try {
      const browser = await api.request<BrowserSession>(
        `/api/browsers/${encodeURIComponent(sessionId)}`,
      );
      open({ type: "browser", browser });
    } catch (e) {
      setError(
        `Couldn't open the browser: ${e instanceof Error ? e.message : String(e)}. Try again.`,
      );
    } finally {
      setBusy("");
    }
  }
  async function confirm() {
    setBusy("confirm");
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <Card style={{ backgroundColor: colors.sky, gap: 10, padding: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LogIn size={18} color={colors.text} />
        <Text style={s.heading}>Sign in to {site}</Text>
      </View>
      <Text style={s.muted}>{reason}</Text>
      <Text style={s.muted}>
        You type your password and any codes yourself. Noa never sees or stores them.
      </Text>
      <ErrorNotice error={error} />
      <Button primary icon={Hand} busy={busy === "open"} onPress={() => void takeControl()}>
        Open browser to sign in
      </Button>
      <Button
        icon={Check}
        busy={busy === "confirm"}
        disabled={confirmed}
        onPress={() => void confirm()}
      >
        {confirmed ? "Signed in" : "I've signed in"}
      </Button>
    </Card>
  );
}

export function SignInToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const interaction = useContext(JevInteractionContext);
  const [sent, setSent] = useState(false);
  const value = parse(result);
  if (loading || !value)
    return (
      <Card style={{ padding: 16 }}>
        <Text style={s.muted}>
          {loading ? "Opening the sign-in page…" : "Sign-in unavailable."}
        </Text>
      </Card>
    );
  return (
    <SignInPanel
      {...value}
      confirmed={sent}
      onConfirm={async () => {
        await interaction.send(`I've signed in to ${value.site}. Please continue.`);
        setSent(true);
      }}
    />
  );
}
