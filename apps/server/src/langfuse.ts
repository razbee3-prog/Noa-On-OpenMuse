import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { type OtelSpanInfo, otelMiddleware } from "@tanstack/ai/middlewares/otel";

/** How one model run shows up in Langfuse: trace name, person, and conversation. */
export type TraceInfo = {
  name: string;
  userId?: string;
  sessionId?: string;
  tags?: string[];
};

const OBSERVATION_TYPE = {
  chat: "agent",
  iteration: "generation",
  tool: "tool",
  generation: "generation",
};

let provider: NodeTracerProvider | undefined;

/** Langfuse is on when both project keys are set; LANGFUSE_BASE_URL picks the region. */
export function langfuseEnabled() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}

function langfuseTracer(): Tracer | undefined {
  if (!langfuseEnabled()) return undefined;
  // A private provider: only Noa's model spans go to Langfuse, not other libraries' telemetry.
  provider ??= new NodeTracerProvider({
    spanProcessors: [new LangfuseSpanProcessor({ shouldExportSpan: () => true })],
  });
  return provider.getTracer("noa");
}

/** TanStack AI middleware that sends one trace per model run to Langfuse; none when it's off. */
export function langfuseMiddleware(info: TraceInfo, tracer = langfuseTracer()) {
  if (!tracer) return [];
  const shared = {
    "langfuse.trace.name": info.name,
    ...(info.userId ? { "langfuse.user.id": info.userId } : {}),
    ...(info.sessionId ? { "langfuse.session.id": info.sessionId } : {}),
    ...(info.tags?.length ? { "langfuse.trace.tags": info.tags } : {}),
  };
  return [
    otelMiddleware({
      tracer,
      captureContent: process.env.LANGFUSE_CAPTURE_CONTENT?.trim() !== "false",
      maxContentLength: 50_000,
      spanNameFormatter: (span: OtelSpanInfo) =>
        span.kind === "chat"
          ? info.name
          : span.kind === "tool"
            ? span.toolName
            : span.kind === "iteration"
              ? "call-model"
              : "generate",
      attributeEnricher: (span: OtelSpanInfo) => ({
        ...shared,
        "langfuse.observation.type": OBSERVATION_TYPE[span.kind],
      }),
    }),
  ];
}

/** Sends any buffered spans; call before the process exits. */
export async function flushLangfuse() {
  await provider?.forceFlush();
}

export async function shutdownLangfuse() {
  await provider?.shutdown();
  provider = undefined;
}
