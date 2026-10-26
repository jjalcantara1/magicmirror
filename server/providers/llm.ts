import OpenAI from "openai";
import { DEFAULT_CANDY_RULE, systemPrompt } from "../../src/prompt.ts";

export const SYSTEM_PROMPT = systemPrompt(process.env.CANDY_RULE || DEFAULT_CANDY_RULE);

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Turn = { role: "user" | "assistant"; content: string };

export type LlmTarget = {
  provider: "groq" | "ollama";
  model: string;
  client: OpenAI;
  // Provider-specific body fields that the openai types do not declare.
  extra: Record<string, unknown>;
};

export type StreamStats = {
  firstTokenMs: number;
  totalMs: number;
  text: string;
  completionTokens?: number;
  totalTokens?: number;
  remainingRequests?: number;
};

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODELS = "qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b";
// Groq free tier per model per day (checked 2026-10). Switch away at 90%, before Groq refuses.
const FREE_TIER_DAILY = { requests: 1000, tokens: 200_000 };
const HEADROOM = 0.9;

const ollamaUrl = () => process.env.OLLAMA_URL ?? "http://localhost:11434";
const label = (t: LlmTarget) => `${t.provider}:${t.model}`;

// Groq's free chat models are all reasoning models. Keep reasoning short and out of the spoken text.
function groqExtra(model: string): Record<string, unknown> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/")) return { reasoning_effort: "none" };
  return {};
}

export function groqTarget(model: string): LlmTarget | undefined {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return undefined;
  return { provider: "groq", model, client: new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 }), extra: groqExtra(model) };
}

export function ollamaTarget(model: string): LlmTarget {
  return { provider: "ollama", model, client: new OpenAI({ apiKey: "ollama", baseURL: `${ollamaUrl()}/v1`, maxRetries: 0 }), extra: {} };
}

export async function streamChat(
  target: LlmTarget,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamStats> {
  const start = performance.now();
  let firstTokenMs = -1;
  let text = "";
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;
  const { data: stream, response } = await target.client.chat.completions
    .create(
      {
        model: target.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.9,
        // Reasoning tokens count toward this cap on Groq, so leave headroom above a two-sentence reply.
        max_completion_tokens: target.provider === "groq" ? 512 : 150,
        ...target.extra,
      },
      { signal: signal ?? AbortSignal.timeout(20_000) },
    )
    .withResponse();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      if (firstTokenMs < 0) firstTokenMs = performance.now() - start;
      text += delta;
      onDelta(delta);
    }
    if (chunk.usage) {
      completionTokens = chunk.usage.completion_tokens;
      totalTokens = chunk.usage.total_tokens;
    }
  }
  const remaining = response.headers.get("x-ratelimit-remaining-requests");
  return { firstTokenMs, totalMs: performance.now() - start, text, completionTokens, totalTokens, remainingRequests: remaining ? Number(remaining) : undefined };
}

type Health = { day: string; requests: number; tokens: number; remainingRequests?: number; cooldownUntil: number; lastError?: string };
const health = new Map<string, Health>();

// shortcut: counts live in memory and restart from zero when the server restarts. Groq's
// x-ratelimit-remaining-requests header still guards the request limit. Persist them if restarts become common.
function healthOf(target: LlmTarget): Health {
  const day = new Date().toISOString().slice(0, 10);
  const h = health.get(label(target));
  if (h && h.day === day) return h;
  const fresh: Health = { day, requests: 0, tokens: 0, cooldownUntil: h?.cooldownUntil ?? 0 };
  health.set(label(target), fresh);
  return fresh;
}

function usable(target: LlmTarget, h: Health): boolean {
  if (Date.now() < h.cooldownUntil) return false;
  if (target.provider !== "groq") return true;
  const reserve = FREE_TIER_DAILY.requests * (1 - HEADROOM);
  return (
    h.requests < FREE_TIER_DAILY.requests * HEADROOM &&
    h.tokens < FREE_TIER_DAILY.tokens * HEADROOM &&
    (h.remainingRequests === undefined || h.remainingRequests > reserve)
  );
}

function cooldownMs(e: unknown): number {
  if (e instanceof OpenAI.APIError && e.status === 429) {
    const retryAfter = Number(e.headers?.get("retry-after"));
    return retryAfter > 0 ? retryAfter * 1000 : 60_000;
  }
  return 30_000;
}

let targets: LlmTarget[] | undefined;
function chatTargets(): LlmTarget[] {
  targets ??= [
    ...(process.env.LLM_MODEL || DEFAULT_GROQ_MODELS)
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .flatMap((m) => groqTarget(m) ?? []),
    ...(process.env.OLLAMA_CHAT_MODEL ? [ollamaTarget(process.env.OLLAMA_CHAT_MODEL)] : []),
  ];
  return targets;
}

// Tries each provider in order. It moves to the next one only before the first word arrives,
// because the mirror may already be speaking the start of the reply.
export async function chatWithFallback(
  turns: Turn[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<StreamStats & { target: string }> {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...turns];
  let lastError: unknown = new Error("No chat provider is available");
  for (const target of chatTargets()) {
    const h = healthOf(target);
    if (!usable(target, h)) continue;
    let started = false;
    const timeout = AbortSignal.timeout(target.provider === "groq" ? 10_000 : 30_000);
    try {
      const stats = await streamChat(target, messages, (d) => ((started = true), onDelta(d)), AbortSignal.any([signal, timeout]));
      h.requests++;
      h.tokens += stats.totalTokens ?? 0;
      h.remainingRequests = stats.remainingRequests;
      h.lastError = undefined;
      return { ...stats, target: label(target) };
    } catch (e) {
      if (signal.aborted) throw e;
      h.lastError = (e as Error).message;
      h.cooldownUntil = Date.now() + cooldownMs(e);
      console.warn(`[llm] ${label(target)} failed: ${h.lastError}`);
      if (started) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export function chatStatus() {
  return chatTargets().map((t) => {
    const h = healthOf(t);
    return {
      target: label(t),
      requests: h.requests,
      tokens: h.tokens,
      remainingRequests: h.remainingRequests,
      coolingDownSec: Math.max(0, Math.round((h.cooldownUntil - Date.now()) / 1000)),
      lastError: h.lastError,
    };
  });
}

// Loads the Ollama fallback model and pre-fills the system prompt, so the first offline reply
// does not wait ~60 s for the model load and prompt prefill (measured on this laptop).
export async function warmOllama(): Promise<void> {
  const model = process.env.OLLAMA_CHAT_MODEL;
  if (!model) return;
  await fetch(`${ollamaUrl()}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM_PROMPT }], stream: false, keep_alive: "24h", options: { num_predict: 1 } }),
    signal: AbortSignal.timeout(180_000),
  });
}
