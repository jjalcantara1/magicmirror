// Groq's Orpheus voice is a language model that writes audio, and now and then it loops: it says a
// phrase again and again ("Mirror, mirror, on the wall... mirror, mirror..."). Speech that runs far
// longer than its words need is such a loop. People say 2 to 3 words a second; slower than 2 a second,
// plus 1.5 s to spare, is too long. `seconds` is the speech without its long pauses.
export function tooLong(text: string, seconds: number): boolean {
  const words = text.match(/\S+/g)?.length ?? 0;
  return seconds > 1.5 + 0.5 * words;
}
