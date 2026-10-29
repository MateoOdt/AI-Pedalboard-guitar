import json
import os
import re
import difflib
import urllib.request
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage

# ── Dataset ───────────────────────────────────────────────────────────────────

DATASET: list[dict] = []
DATASET_URL   = "https://raw.githubusercontent.com/Pera-Labs/guitar-tone-dataset/master/guitar-tones.json"
DATASET_CACHE = os.path.join(os.path.dirname(__file__), "guitar-tones-cache.json")


def _load_dataset():
    global DATASET
    # Use local cache if available
    if os.path.exists(DATASET_CACHE):
        with open(DATASET_CACHE, encoding="utf-8") as f:
            DATASET = json.load(f)
        print(f"[Dataset] Loaded {len(DATASET)} entries from cache")
        return
    # Otherwise download
    try:
        print("[Dataset] Downloading guitar-tone-dataset…")
        with urllib.request.urlopen(DATASET_URL, timeout=15) as r:
            data = json.loads(r.read())
        DATASET = data if isinstance(data, list) else data.get("tones", data.get("data", []))
        with open(DATASET_CACHE, "w", encoding="utf-8") as f:
            json.dump(DATASET, f)
        print(f"[Dataset] Downloaded and cached {len(DATASET)} entries")
    except Exception as e:
        print(f"[Dataset] Failed to load ({e}) — falling back to pure AI generation")


def _score_entry(entry: dict, prompt: str) -> float:
    p = prompt.lower()
    song   = (entry.get("song")   or "").lower()
    artist = (entry.get("artist") or "").lower()
    score  = 0.0
    # Substring match (highest priority)
    if song   and song   in p: score = max(score, 0.95)
    if artist and artist in p: score = max(score, 0.75)
    # Fuzzy match
    if song:
        score = max(score, difflib.SequenceMatcher(None, p, song).ratio())
    if artist:
        score = max(score, difflib.SequenceMatcher(None, p, artist).ratio() * 0.85)
    return score


def search_dataset(prompt: str, threshold: float = 0.65) -> Optional[dict]:
    if not DATASET:
        return None
    best_score, best_entry = 0.0, None
    for entry in DATASET:
        s = _score_entry(entry, prompt)
        if s > best_score:
            best_score, best_entry = s, entry
    return best_entry if best_score >= threshold else None


# ── App lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_):
    _load_dataset()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_BASE = """You are a guitar tone expert. Suggest optimal guitar amp and effects settings.

Respond ONLY with a valid JSON object:
{
  "explanation": "Brief explanation in the same language as the user (1-2 sentences)",
  "source": "dataset" or "ai",
  "preset": {
    "ampModel": "fender|marshall|mesa|vox|tweed",
    "channel": "clean|crunch|lead",
    "amp": { "gain": <0-10>, "volume": 7, "presence": <0-10>, "bass": <0-10>, "mid": <0-10>, "treble": <0-10> },
    "effects": {
      "compressor": { "on": true/false, "threshold": <-40 to 0>, "ratio": <1-20> },
      "overdrive":  { "on": true/false, "drive": <0-1>, "tone": <1000-8000>, "level": <0.1-1> },
      "distortion": { "on": true/false, "drive": <0-1>, "tone": <500-8000>,  "level": <0.1-1> },
      "chorus":     { "on": true/false, "rate": <0.1-5>, "depth": <0-1>, "mix": <0-1> },
      "phaser":     { "on": true/false, "rate": <0.1-5>, "depth": <0-1>, "mix": <0-1> },
      "delay":      { "on": true/false, "time": <0.05-1>, "feedback": <0-0.9>, "mix": <0-1> },
      "reverb":     { "on": true/false, "room": <0.1-1>, "decay": <0.1-1>, "mix": <0-1> },
      "tremolo":    { "on": true/false, "rate": <0.5-15>, "depth": <0-1> },
      "eq":         { "on": true/false, "bass": <-15 to 15>, "mid": <-15 to 15>, "treble": <-15 to 15> }
    }
  }
}

Amp model guidelines: fender=clean/blues, marshall=rock/crunch, mesa=metal, vox=indie/britpop, tweed=vintage blues.
Only activate effects that make sense for the sound. Respond in the user's language."""

SYSTEM_DATASET = SYSTEM_BASE + """

IMPORTANT: A reference tone from a verified dataset is provided below.
Use it as the primary source for amp settings. Adapt it to the JSON format above,
filling in any missing effects logically. Set source to "dataset"."""

SYSTEM_AI = SYSTEM_BASE + """

No dataset entry found for this request — use your knowledge to generate the best tone.
Set source to "ai"."""

# ── Helpers ───────────────────────────────────────────────────────────────────

def extract_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find('{')
    if start == -1:
        raise ValueError("No JSON found in response")
    json_str = text[start:]
    try:
        return json.loads(json_str)
    except Exception:
        pass
    # Repair truncated JSON
    depth_brace = depth_bracket = 0
    in_string = escape = False
    for ch in json_str:
        if escape:
            escape = False; continue
        if ch == '\\' and in_string:
            escape = True; continue
        if ch == '"':
            in_string = not in_string; continue
        if in_string:
            continue
        if ch == '{': depth_brace += 1
        elif ch == '}': depth_brace = max(0, depth_brace - 1)
        elif ch == '[': depth_bracket += 1
        elif ch == ']': depth_bracket = max(0, depth_bracket - 1)
    repaired = json_str.rstrip().rstrip(',') + ']' * depth_bracket + '}' * depth_brace
    return json.loads(repaired)

# ── Request model ─────────────────────────────────────────────────────────────

class SuggestRequest(BaseModel):
    prompt: str
    model:  str = "mistral"

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "dataset_entries": len(DATASET)}


@app.get("/models")
async def list_models():
    try:
        import ollama
        result = ollama.list()
        models = [
            {"name": m.model, "size_gb": round(m.size / 1_073_741_824, 1) if m.size else 0}
            for m in result.models
        ]
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/suggest")
async def suggest(req: SuggestRequest):
    try:
        match = search_dataset(req.prompt)
        if match:
            system  = SYSTEM_DATASET
            human   = (
                f"Request: {req.prompt}\n\n"
                f"Dataset reference:\n{json.dumps(match, indent=2)}"
            )
        else:
            system  = SYSTEM_AI
            human   = f"Suggest guitar tone settings for: {req.prompt}"

        llm = ChatOllama(model=req.model, temperature=0.7, num_predict=2048, format="json")
        messages = [SystemMessage(content=system), HumanMessage(content=human)]
        result = await llm.ainvoke(messages)
        return extract_json(result.content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5174, log_level="warning")
