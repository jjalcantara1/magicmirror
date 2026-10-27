# Running the Magic Mirror on this computer (the `local-models` branch)

On this branch everything runs on the computer itself: no Groq account, no daily limits, and no
internet needed once the models are downloaded.

| Job | Local engine | Runs in |
|---|---|---|
| The AI (what the mirror says) | Ollama, model `llama3.1:8b` | the Ollama app |
| Hearing the child | Whisper (`whisper-small`) | the browser |
| The voice | Kokoro, voice `am_fenrir` (Piper as backup) | the browser |

A computer with a graphics card (NVIDIA, AMD, or a recent Apple/Intel GPU) runs it much faster.

## Set up (once)

1. Install **Node.js 22 or newer** (nodejs.org), **Git**, and **Chrome** or **Edge**.
2. Get the code:
   ```
   git clone https://github.com/jjalcantara1/magicmirror.git
   cd magicmirror
   git checkout local-models
   npm install
   ```
3. Install **Ollama** from ollama.com, open it, then download the AI model (about 5 GB):
   ```
   ollama pull llama3.1:8b
   ```
   On a slower computer use `gemma3:4b` instead (about 3 GB), and put `OLLAMA_CHAT_MODEL=gemma3:4b` in `.env`.
4. Copy the settings: `copy .env.example .env` (Windows) or `cp .env.example .env`. No key is needed.

## Run

```
npm start
```

The terminal says what runs where, and whether Ollama is ready:

```
[engines] AI: local (Ollama llama3.1:8b) · hearing: local (whisper-small) · voice: kokoro am_fenrir · local models run on: auto
[local] AI: Ollama llama3.1:8b is ready
```

Open http://127.0.0.1:5173 in Chrome. **The first start downloads the voice and the ears** (a few
hundred MB, once); the screen shows the progress. After that it starts in seconds, even offline.

## Is it fast enough?

Press **D** and talk to the mirror:

- `speech  kokoro am_fenrir (webgpu): 400 ms to make 2.5 s of audio`: the first number must be well
  below the second, or the voice stutters.
- `stt  local whisper-small · 600 ms`: how long hearing took.
- `llm  ollama:llama3.1:8b · first word 900 ms`: how long before the AI starts answering.

`(webgpu)` means the graphics card is used; `(wasm)` means the processor (slower). For a full speed
test, open http://127.0.0.1:5173/bench.html.

## If it is too slow

Change one line at a time in `.env`, then restart (Ctrl+C, `npm start`):

| Slow part | Try |
|---|---|
| The voice | `TTS_ENGINE=piper` (smaller voice, fast on any processor) |
| Hearing | `STT_LOCAL_MODEL=onnx-community/whisper-base` |
| The AI | `OLLAMA_CHAT_MODEL=gemma3:4b` (after `ollama pull gemma3:4b`) |

With a strong graphics card, hearing Taglish improves with
`STT_LOCAL_MODEL=onnx-community/whisper-large-v3-turbo`.

Any job can also go back to Groq on its own, e.g. `AI_ENGINE=groq` (needs `GROQ_API_KEY`).
