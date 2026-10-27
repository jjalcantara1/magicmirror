// The page's side of the local hearing worker (stt.worker.ts).
import type { SttReply, SttRequest } from "./stt.worker.ts";

export function createLocalEars(stt: { model: string; device: string }, onStatus: (text: string) => void) {
  const worker = new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" });
  const send = (msg: SttRequest, transfer: Transferable[] = []) => worker.postMessage(msg, { transfer });
  const waiting = new Map<number, (r: { text: string; ms: number; error?: string }) => void>();
  let nextId = 0;
  const ready = new Promise<string>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<SttReply>) => {
      const msg = e.data;
      if (msg.type === "ready") resolve(msg.engine);
      else if (msg.type === "failed") reject(new Error(msg.error));
      else if (msg.type === "status") onStatus(msg.text);
      else {
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
      }
    };
  });
  send({ type: "init", model: stt.model, device: stt.device });
  return {
    ready,
    /** 16 kHz mono audio in, the words out ("" for noise or nothing understood). */
    hear(audio: Float32Array): Promise<{ text: string; ms: number; error?: string }> {
      const id = nextId++;
      const copy = new Float32Array(audio);
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        send({ type: "hear", id, audio: copy }, [copy.buffer]);
      });
    },
  };
}
