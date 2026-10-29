# The Magic Mirror: party guide

## Once, before the party

1. Install **Node.js 24 or newer** (nodejs.org, the LTS button), **Git**, and **Chrome**.
2. Get the latest mirror. In the `magicmirror` folder (`C:\Users\Jodie\Documents\magicmirror`):
   ```
   git pull
   npm install
   ```
3. **Settings:** copy `.env.example` to `.env` (if you have no `.env` yet) and put your Groq key in `GROQ_API_KEY`.
   - If you already have an `.env`, compare it with the table under "Settings worth changing" below.
   - Lines in your `.env` win over the built-in values. An old `VAD_REDEMPTION_MS=1200`, for example, makes the mirror slow to answer.
4. **Windows:**
   - **Power:** under Settings, System, Power, set "screen" and "sleep" to **Never** when plugged in, and plug the charger in.
   - **Sound output:** the speaker, at a good volume.
   - **Sound input:** the microphone nearest the mirror. The mirror uses the Windows default microphone.
   - **Notifications:** turn on **Do not disturb**, so no pop-ups show through the glass.
5. **Test run:** double-click **`start-mirror.bat`**.
   - The first time, Chrome asks to use the microphone. Click **Allow**; it remembers.
   - The black "Magic Mirror server" window should end with `[check] all good: the mirror is ready for the party`.

## At the party

- Double-click **`start-mirror.bat`**. The mirror opens full screen; wait for `[check] all good` in the server window.
- **Children wake it by saying "Hello, Mirror!"**: the words glow in the glass while it sleeps. "Mirror, mirror", "Magic mirror" and "Salamin, salamin" work too.
- **After 30 s with nobody talking to it**, it says goodbye and falls asleep. It forgets that child, so every child starts fresh.
- **To finish:** press Alt+F4 to close the mirror, then close the server window.

### Keys (for a grown-up, any time)

| Key | What it does |
|---|---|
| G | Wake up and say the opening (same as "Hello, Mirror!") |
| N | New visitor: forget this child and start again with the opening |
| C | Give a treat: a "take your treat" line |
| H | "Happy Halloween!" goodbye line |
| R | Sleep now |
| X | Restart the page (if the sound, mic or face gets stuck) |
| V | Try the next voice (put the one you like in `.env` as `GROQ_TTS_VOICE`) |
| D | Show or hide the panel below |

## The D panel

| Line | What it tells you |
|---|---|
| `state` | Sleeping, listening, thinking or speaking. |
| `heard` | How loud the last voice was, and whether it was near enough to answer. `IGNORED` means too far away or too quiet. |
| `stt` | What hearing took. While asleep, also what it heard ("asleep: heard ..."). |
| `llm` | Which AI model answered, and how fast its first word came. |
| `speech` | How the voice was made. `groq` is the normal voice; `piper backup` means Groq didn't answer. |
| `reply` | **How long a child waited**, step by step: `silence · hearing · AI · voice`. Send this line if replies feel slow. |
| `sound` | `waiting for a key press` means the browser blocked sound: press any key, or start with `start-mirror.bat`. |
| `screen` | `kept on` means the screen won't dim. |

## Settings worth changing

Change them in `.env`, then close both windows and double-click `start-mirror.bat` again.

| Setting | Default | Change it when |
|---|---|---|
| `MIC_NEAR_DB` | 7 | It ignores children: lower it (5). It answers people across the room: raise it (9–10). |
| `VAD_REDEMPTION_MS` | 600 | It cuts children off mid-sentence: raise it (700–800). |
| `LISTEN_AFTER_MS` | 600 | It answers its own echo: raise it (800–900). It misses quick answers: lower it. |
| `IDLE_SLEEP_S` | 30 | It sleeps too soon or too late. 0 = never sleeps by itself. |
| `WAKE_WORDS` | on | `off` = only the G key wakes it. |
| `WAKE_HINT` | on | `off` = no "Say Hello, Mirror!" in the glass. |
| `VOICE_PITCH`, `VOICE_SPEED` | 0.8, 0.85 | Deeper/higher, slower/faster. |
| `VOICE_ACTING` | on | `off` = one plain, natural tone. |
| `STARTUP_CHECK` | on | `off` = skip the check at start. |

## If something goes wrong

| Problem | Fix |
|---|---|
| No sound | Press any key on the mirror. Check the Windows volume and output. |
| It doesn't hear anyone | In the D panel, `heard` should change when someone speaks. If not, check the Windows default microphone. If it says `IGNORED`, lower `MIC_NEAR_DB`. |
| It talks to itself | Turn the volume down a little, or raise `LISTEN_AFTER_MS`. |
| A `[check]` line says FAILED | The line says what failed: usually the Groq key, the internet, or the Groq spend limit. |
| Stuck, or the face froze | Press X. If that doesn't help, close both windows and start again. |
| Chrome was not found | Open http://127.0.0.1:5173 in any browser and press F11. |
