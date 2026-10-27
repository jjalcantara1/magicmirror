import OpenAI from "openai";
import { DEFAULT_CANDY_RULE, systemPrompt } from "../../src/prompt.ts";
import { firstGroqKey, groqKeyCount, keyName, keysFor, noteRefusal, retryAfterSeconds } from "./groqKeys.ts";

export const SYSTEM_PROMPT = systemPrompt(process.env.CANDY_RULE || DEFAULT_CANDY_RULE);

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Turn = { role: "user" | "assistant"; content: string };

export type LlmTarget = {
  provider: "groq" | "ollama";
  model: string;
  label: string; // "groq:model" (with "key 2" when there are several keys)
  keyIndex?: number;
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
const label = (t: LlmTarget) => t.label;
const groqModels = () =>
  (process.env.LLM_MODEL || DEFAULT_GROQ_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

// Groq's free chat models are all reasoning models. Keep reasoning short and out of the spoken text.
function groqExtra(model: string): Record<string, unknown> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/")) return { reasoning_effort: "none" };
  return {};
}

const clients = new Map<string, OpenAI>();
function groqClient(apiKey: string): OpenAI {
  let client = clients.get(apiKey);
  if (!client) clients.set(apiKey, (client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 })));
  return client;
}

const groqLabel = (model: string, keyIndex: number) => `groq:${model}${groqKeyCount() > 1 ? ` (${keyName(keyIndex)})` : ""}`;

export function groqTarget(model: string, apiKey = firstGroqKey(), keyIndex = 0): LlmTarget | undefined {
  if (!apiKey) return undefined;
  return { provider: "groq", model, label: groqLabel(model, keyIndex), keyIndex, client: groqClient(apiKey), extra: groqExtra(model) };
}

export function ollamaTarget(model: string): LlmTarget {
  const client = new OpenAI({ apiKey: "ollama", baseURL: `${ollamaUrl()}/v1`, maxRetries: 0 });
  return { provider: "ollama", model, label: `ollama:${model}`, client, extra: {} };
}

// Replies are at most 30 words (about 60 tokens with tags). Groq counts this cap against the
// tokens-per-minute limit, so keep it small; gpt-oss also spends some of it on short reasoning.
const maxTokens = (t: LlmTarget) => (t.provider !== "groq" ? 150 : t.model.startsWith("openai/gpt-oss") ? 400 : 150);

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
        max_completion_tokens: maxTokens(target),
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
function healthOf(name: string): Health {
  const day = new Date().toISOString().slice(0, 10);
  const h = health.get(name);
  if (h && h.day === day) return h;
  const fresh: Health = { day, requests: 0, tokens: 0, cooldownUntil: h?.cooldownUntil ?? 0 };
  health.set(name, fresh);
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
  if (e instanceof OpenAI.APIError && e.status === 429) return retryAfterSeconds(e.headers) * 1000;
  if (e instanceof OpenAI.APIError && (e.status === 401 || e.status === 403)) return 600_000; // a bad key
  return 30_000;
}

// The local-models branch: the AI runs on this computer through Ollama, unless AI_ENGINE=groq (and a
// Groq key is set), in which case Groq answers and Ollama is only the backup.
export const AI_LOCAL = process.env.AI_ENGINE !== "groq" || !groqKeyCount();
export const OLLAMA_MODEL = process.env.OLLAMA_CHAT_MODEL || (AI_LOCAL ? "llama3.1:8b" : "");
const ollama = OLLAMA_MODEL ? ollamaTarget(OLLAMA_MODEL) : undefined;

// The order to try for one reply: each model in turn, and for each model the keys in turn (starting
// one further along each time, so the load is shared), then the local model.
function chatTargets(): LlmTarget[] {
  return [
    ...(AI_LOCAL ? [] : groqModels().flatMap((m) => keysFor(`chat:${m}`).flatMap(({ key, index }) => groqTarget(m, key, index) ?? []))),
    ...(ollama ? [ollama] : []),
  ];
}

// Every model and key, for the status panel.
function allLabels(): string[] {
  const keyed = AI_LOCAL ? [] : Array.from({ length: groqKeyCount() }, (_, i) => i);
  return [...groqModels().flatMap((m) => keyed.map((i) => groqLabel(m, i))), ...(ollama ? [ollama.label] : [])];
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
    const h = healthOf(label(target));
    if (!usable(target, h)) continue;
    let started = false;
    // A local model on a laptop can need a while for a whole reply.
    const timeout = AbortSignal.timeout(target.provider === "groq" ? 10_000 : 60_000);
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
      if (target.keyIndex !== undefined) noteRefusal(target.keyIndex, h.lastError);
      h.cooldownUntil = Date.now() + cooldownMs(e);
      console.warn(`[llm] ${label(target)} failed: ${h.lastError}`);
      if (started) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export function chatStatus() {
  return allLabels().map((name) => {
    const h = healthOf(name);
    return {
      target: name,
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
  const model = OLLAMA_MODEL;
  if (!model) return;
  await fetch(`${ollamaUrl()}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM_PROMPT }], stream: false, keep_alive: "24h", options: { num_predict: 1 } }),
    signal: AbortSignal.timeout(180_000),
  });
}

// For a fresh computer: says whether Ollama is running and has the model, and what to do if not.
export async function checkOllama(): Promise<string> {
  if (!OLLAMA_MODEL) return "";
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    const have = models.some((m) => m.name === OLLAMA_MODEL || m.name === `${OLLAMA_MODEL}:latest`);
    return have
      ? `[local] AI: Ollama ${OLLAMA_MODEL} is ready`
      : `[local] Ollama is running but does not have ${OLLAMA_MODEL} yet: run  ollama pull ${OLLAMA_MODEL}`;
  } catch {
    return `[local] Ollama is not running at ${ollamaUrl()}: install it from ollama.com, start it, then run  ollama pull ${OLLAMA_MODEL}`;
  }
}
