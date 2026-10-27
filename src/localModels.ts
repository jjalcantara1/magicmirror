// Shared by the local voice (Kokoro) and local hearing (Whisper), which run in browser workers.
import type { ProgressCallback } from "@huggingface/transformers";

/** auto: the graphics card (WebGPU) when there is one, many times faster; else the processor (wasm). */
export async function pickDevice(preference: string): Promise<"webgpu" | "wasm"> {
  if (preference === "webgpu" || preference === "wasm") return preference;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu && (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/** A model's first download, over all its files, as whole percentages (at most every 2%). */
export function downloadProgress(onPercent: (percent: number) => void): ProgressCallback {
  const files = new Map<string, { loaded: number; total: number }>();
  let last = -2;
  return (info) => {
    if (info.status !== "progress") return;
    files.set(info.file, { loaded: info.loaded, total: info.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) (loaded += f.loaded), (total += f.total);
    const percent = Math.floor((100 * loaded) / Math.max(1, total));
    if (percent >= last + 2) onPercent((last = percent));
  };
}
