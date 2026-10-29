// The server window shows what the D panel shows, as it happens, so a second screen can watch the
// mirror without the panel showing through the glass:
//   21:04:16  state    THINKING
//   21:04:16  child    I'm a witch!
//   21:04:17  mirror   Ooh, a witch! Is your broom fast?
//   21:04:17  reply    voice started 1650 ms after the child stopped (silence 600 · hearing 420 · AI 380 · voice 250 ms)
// MONITOR=off keeps the window quiet. Children's words are only shown, never saved.
import { styleText } from "node:util";

export type MonitorEvent = { key: string; value: string };

const time = (d: Date) => d.toTimeString().slice(0, 8);

/** One terminal line for a panel change; chat lines and alerts stand out. */
export function monitorLine(e: MonitorEvent, at = new Date()): string {
  const key = String(e.key).slice(0, 12);
  const value = String(e.value).replace(/\s+/g, " ").slice(0, 300);
  const line = `${time(at)}  ${key.padEnd(8)} ${value}`;
  if (key === "ALERT") return styleText(["bold", "red"], `${line}  <<< check on this child`);
  if (key === "child") return styleText("cyan", line);
  if (key === "mirror") return styleText("yellow", line);
  if (key === "visit") return styleText("dim", line);
  return line;
}
