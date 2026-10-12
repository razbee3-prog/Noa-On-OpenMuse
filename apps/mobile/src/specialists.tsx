import { useThreads } from "@copilotkit/react-native/headless";
import {
  BadgeDollarSign,
  ChevronRight,
  type LucideIcon,
  Plus,
  ReceiptText,
  Scissors,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { tapHaptic } from "./haptics";
import { useMuseThread } from "./threads";
import { Button, Card, colors, ErrorNotice, Field, Mascot, s } from "./ui";
import { useWorkspace } from "./workspace";

type Look = "sky" | "sand" | "lilac" | "mint" | "rose" | "peach";
interface Preset {
  id: string;
  name: string;
  mascot: Look;
  blurb: string;
}
interface Specialist extends Preset {
  preset?: string;
}

const badges: Record<string, LucideIcon> = {
  "refund-tracker": ReceiptText,
  "bill-negotiator": BadgeDollarSign,
  "insurance-shopper": ShieldCheck,
  "subscription-canceler": Scissors,
};

/** A specialist's own capybara: its colour plus a small badge for its job. */
export function SpecialistAvatar({
  look,
  badge = Sparkles,
  size = 52,
}: {
  look: Look;
  badge?: LucideIcon;
  size?: number;
}) {
  const Badge = badge;
  return (
    <View style={{ width: size, height: size }}>
      <Mascot size={size} variant={look} />
      <View
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: size * 0.42,
          height: size * 0.42,
          borderRadius: size,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Badge size={size * 0.24} strokeWidth={2} color={colors.text} />
      </View>
    </View>
  );
}

function Row({
  title,
  detail,
  avatar,
  busy,
  onPress,
}: {
  title: string;
  detail: string;
  avatar: React.ReactNode;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      disabled={busy}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        s.row,
        {
          gap: 14,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 22,
          backgroundColor: pressed ? colors.line : colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        },
      ]}
    >
      {avatar}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600", fontSize: 16 }]}>{title}</Text>
        <Text style={s.small}>{detail}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <ChevronRight size={18} color={colors.muted} />
      )}
    </Pressable>
  );
}

/** Specialist Noas, each opening its own side chat that shares memory and apps. */
export function SpecialistsScreen() {
  const { api } = useWorkspace();
  const { enabled, select } = useMuseThread();
  const threads = useThreads({ agentId: "default", enabled, limit: 20 });
  const [data, setData] = useState<{ presets: Preset[]; specialists: Specialist[] }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  useEffect(() => {
    api
      .request<{ presets: Preset[]; specialists: Specialist[] }>("/api/specialists")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);
  async function open(key: string, body: object) {
    setError("");
    setBusy(key);
    try {
      const specialist = await api.request<Specialist>("/api/specialists", body);
      known.set(specialist.id, specialist);
      await threads.renameThread(specialist.id, specialist.name).catch(() => undefined);
      setData((current) =>
        current && !current.specialists.some((item) => item.id === specialist.id)
          ? { ...current, specialists: [...current.specialists, specialist] }
          : current,
      );
      setCreating(false);
      setName("");
      setJob("");
      select({ id: specialist.id, existing: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  if (!data) return error ? <ErrorNotice error={error} /> : <ActivityIndicator />;
  const custom = data.specialists.filter((item) => !item.preset);
  return (
    <View style={{ gap: 12 }}>
      <Text style={[s.muted, { marginBottom: 6 }]}>
        Each one is a Noa with a single job and its own chat. They all know your memory and
        connected apps.
      </Text>
      {!enabled && (
        <ErrorNotice error="Specialists open as side chats, which aren't available right now." />
      )}
      <ErrorNotice error={error} />
      {data.presets.map((preset) => (
        <Row
          key={preset.id}
          title={preset.name}
          detail={preset.blurb}
          busy={busy === preset.id}
          avatar={<SpecialistAvatar look={preset.mascot} badge={badges[preset.id]} />}
          onPress={() => void open(preset.id, { preset: preset.id })}
        />
      ))}
      {custom.map((item) => (
        <Row
          key={item.id}
          title={item.name}
          detail={item.blurb}
          avatar={<SpecialistAvatar look={item.mascot} badge={specialistBadge(item)} />}
          onPress={() => select({ id: item.id, existing: true })}
        />
      ))}
      {creating ? (
        <Card style={{ gap: 12 }}>
          <Text style={s.heading}>New specialist</Text>
          <Field label="Name" value={name} onChangeText={setName} maxLength={40} />
          <Field
            label="Its job"
            placeholder="e.g. Track my airline points and tell me before any expire."
            value={job}
            onChangeText={setJob}
            multiline
            maxLength={1500}
          />
          <View style={[s.row, { gap: 8 }]}>
            <Button
              primary
              busy={busy === "custom"}
              disabled={!enabled || !name.trim() || !job.trim()}
              onPress={() => void open("custom", { name: name.trim(), instructions: job.trim() })}
            >
              Create
            </Button>
            <Button quiet onPress={() => setCreating(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Row
          title="Create your own"
          detail="Give a Noa one job, in your own words."
          avatar={
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.handle,
              }}
            >
              <Plus size={22} color={colors.text} />
            </View>
          }
          onPress={() => setCreating(true)}
        />
      )}
    </View>
  );
}

const known = new Map<string, Specialist | null>();

/** The specialist behind a side chat, if any (cached per thread). */
export function useSpecialist(threadId?: string) {
  const { api } = useWorkspace();
  const [specialist, setSpecialist] = useState(threadId ? known.get(threadId) : null);
  useEffect(() => {
    if (!threadId) return setSpecialist(null);
    if (known.has(threadId)) return setSpecialist(known.get(threadId));
    let active = true;
    api
      .request<{ specialists: Specialist[] }>("/api/specialists")
      .then(({ specialists }) => {
        for (const item of specialists) known.set(item.id, item);
        if (!known.has(threadId)) known.set(threadId, null);
        if (active) setSpecialist(known.get(threadId));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, threadId]);
  return specialist ?? undefined;
}

export function specialistBadge(specialist: { preset?: string }) {
  return (specialist.preset && badges[specialist.preset]) || Sparkles;
}
