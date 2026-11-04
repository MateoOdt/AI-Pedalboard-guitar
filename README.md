# Guitar Pedalboard

A desktop guitar effects pedalboard built with **Electron** and the **Web Audio API**, with an **AI tone assistant** powered by a local LLM (via [Ollama](https://ollama.com) and LangChain).

Plug in your guitar (or any audio input), shape your tone with a chain of amps and effects, and ask the assistant for a sound — e.g. *"give me the tone from Comfortably Numb"* — to have it dial in the pedalboard for you.

## Features

- **Real-time effects chain** processed live through the Web Audio API
  - Amp models: `fender`, `marshall`, `mesa`, `vox` (with clean/drive channels)
  - Effects: compressor, overdrive, distortion, chorus, phaser, delay, reverb, tremolo, EQ
- **AI tone assistant** — describe a sound or a song/artist and get a full pedalboard preset back
  - Runs entirely locally against Ollama
  - **Semantic RAG** — tones from the [guitar-tone dataset](https://github.com/Pera-Labs/guitar-tone-dataset) are embedded into an in-memory vector store, so requests match by *meaning* (e.g. *"warm bluesy solo"*) via cosine similarity, not just keywords; below a similarity threshold it falls back to pure LLM generation
  - **Agentic research mode** — a [LangGraph](https://langchain-ai.github.io/langgraph/) agent with a `search_tones` tool drives its own retrieval: it reformulates vague prompts ("something dreamy" → "ambient clean reverb"), searches the dataset more than once, and grounds the final preset in what it finds
- **Presets** — save and recall your own setups (stored in `presets.json`)

## Requirements

- [Node.js](https://nodejs.org) + npm
- [Python 3](https://www.python.org)
- [Ollama](https://ollama.com) running locally (default API at `http://localhost:11434`) with:
  - at least one chat model pulled (e.g. `ollama pull mistral`)
  - an embedding model for semantic RAG — `nomic-embed-text` by default (`ollama pull nomic-embed-text`)

## Setup

Install the Electron app dependencies:

```bash
npm install
```

Install the AI server dependencies:

```bash
pip install -r ai-server/requirements.txt
```

## Running

```bash
npm start
```

This launches the Electron window and automatically starts the local AI server (`ai-server/server.py`) as a child process.

- AI server: FastAPI on `http://127.0.0.1:5174`
- Ollama: expected on `http://localhost:11434`

## Project structure

```
main.js            Electron entry point; spawns the AI server
index.html         App shell / UI markup
renderer.js        Audio engine, effects chain, UI logic, AI client
styles.css         UI styling
presets.json       Saved user presets
ai-server/
  server.py                FastAPI service: dataset loading, semantic RAG, /suggest endpoints
  agent.py                 LangGraph agentic pipeline + the search_tones tool
  requirements.txt         Python dependencies
  guitar-tones-cache.json  Cached tone dataset
  tone-vectors-cache.json  Cached tone embeddings (vector store)
```

## AI server endpoints

| Method | Path             | Description                                                              |
|--------|------------------|--------------------------------------------------------------------------|
| GET    | `/health`        | Health check — dataset size, whether RAG is ready, and the embed model   |
| GET    | `/models`        | List available Ollama chat models (embedding models are filtered out)    |
| POST   | `/suggest`       | Generate a preset from a prompt (single semantic-RAG retrieval)          |
| POST   | `/suggest/agent` | Generate a preset via the agentic pipeline (agent-driven, multi-search)  |

Both `/suggest` endpoints accept a JSON body `{ "prompt": "...", "model": "mistral" }`.

## License

ISC
