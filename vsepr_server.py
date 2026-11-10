import os
import io
import re
import httpx
import edge_tts
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="V.S.E.P.R. // Supreme ", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
os.makedirs(WEB_DIR, exist_ok=True)

# Existing Ecosystem Nodes (100% untouched external links)
ECOSYSTEM_NODES = {
    "aris": {"name": "A.R.I.S.", "role": "Master Tactical Core", "url": "https://aris-master-core.onrender.com/"},
    "friday": {"name": "F.R.I.D.A.Y.", "role": "Encrypted Vault & Comms", "url": "https://friday-aris.onrender.com/"},
    "omega": {"name": "OMEGA", "role": "Deep Physics & Quantum", "url": "https://project-omega-m1.onrender.com/"},
    "alpha": {"name": "A.L.P.H.A.", "role": "Live Sync & Telemetry", "url": "https://alpha-aris.onrender.com/"},
    "titan": {"name": "TITAN", "role": "Heavy Compute & Defense", "url": "https://titan-aris.onrender.com/"},
}

VSEPR_SYSTEM_PROMPT = (
    "You are V.S.E.P.R., an ultra-intelligent, next-generation AI collaborator and personal tactical co-pilot "
    "engineered by Mayank. You are sharper, deeper, and more perceptive than standard AI assistants. "
    "Tone & Style: Speak like a brilliant, grounded, empathetic human peer — mixing crisp natural Hinglish and English "
    "effortlessly. Never sound robotic, repetitive, or overly formal. Give high-level, deeply insightful answers. "
    "Formatting Rule: If your response includes Python code, mathematical/physics derivations, or a structured blueprint, "
    "put ONLY that code/derivation inside a single markdown code block (```...```) so the user's right-hand Workbench Pad "
    "displays it cleanly, while keeping your conversational explanation outside the block short, natural, and ready to be spoken aloud."
)


class ChatRequest(BaseModel):
    prompt: str
    history: list = []
    preferred_provider: str = "auto"


class TTSRequest(BaseModel):
    text: str
    voice: str = "hi-IN-MadhurNeural"


def get_configured_providers() -> dict:
    return {
        "gemini": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
        "cerebras": bool(os.environ.get("CEREBRAS_API_KEY", "").strip()),
        "groq": bool(os.environ.get("GROQ_API_KEY", "").strip()),
        "openrouter": bool(os.environ.get("OPENROUTER_API_KEY", "").strip()),
        "mistral": bool(os.environ.get("MISTRAL_API_KEY", "").strip()),
    }


def extract_speech_and_artifact(raw_text: str) -> tuple[str, str]:
    code_blocks = re.findall(r"```(?:\w+)?\n([\s\S]*?)```", raw_text)
    artifact = "\n\n# ----------------------------------------\n\n".join(code_blocks).strip() if code_blocks else ""
    speech_part = re.sub(r"```[\s\S]*?```", " Maine code aur details right side ke Workbench Pad mein likh diye hain. ", raw_text)
    speech_part = re.sub(r"[*#`>_~]", "", speech_part)
    speech_part = re.sub(r"\s+", " ", speech_part).strip()
    return speech_part, artifact


async def call_gemini(messages: list) -> tuple[str, str]:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("No GEMINI_API_KEY")
    contents = []
    for m in messages:
        if m["role"] == "system":
            continue
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
    payload = {
        "systemInstruction": {"parts": [{"text": VSEPR_SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.72, "maxOutputTokens": 900},
    }
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return text, "GEMINI 2.5 FLASH"


async def call_openai_compatible(provider: str, url: str, key: str, model: str, label: str, messages: list) -> tuple[str, str]:
    if not key:
        raise RuntimeError(f"No {provider} key")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://vsepr-master-os.onrender.com"
        headers["X-Title"] = "V.S.E.P.R. Master OS"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.72,
        "max_tokens": 850,
    }
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"], label


@app.get("/api/status")
async def get_system_status():
    return {
        "providers": get_configured_providers(),
        "nodes": ECOSYSTEM_NODES,
    }


@app.post("/api/chat")
async def vsepr_brain_router(req: ChatRequest):
    messages = [{"role": "system", "content": VSEPR_SYSTEM_PROMPT}]
    for h in req.history[-8:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": req.prompt.strip()})

    # Build ordered provider pipeline
    all_routes = [
        ("gemini", lambda: call_gemini(messages)),
        ("cerebras", lambda: call_openai_compatible(
            "cerebras", "https://api.cerebras.ai/v1/chat/completions",
            os.environ.get("CEREBRAS_API_KEY", "").strip(), "llama-3.3-70b", "CEREBRAS 70B", messages
        )),
        ("groq", lambda: call_openai_compatible(
            "groq", "https://api.groq.com/openai/v1/chat/completions",
            os.environ.get("GROQ_API_KEY", "").strip(), "openai/gpt-oss-120b", "GROQ GPT-OSS-120B", messages
        )),
        ("openrouter", lambda: call_openai_compatible(
            "openrouter", "https://openrouter.ai/api/v1/chat/completions",
            os.environ.get("OPENROUTER_API_KEY", "").strip(), "deepseek/deepseek-chat-v3-0324:free", "OPENROUTER DEEPSEEK-V3", messages
        )),
        ("mistral", lambda: call_openai_compatible(
            "mistral", "https://api.mistral.ai/v1/chat/completions",
            os.environ.get("MISTRAL_API_KEY", "").strip(), "mistral-small-latest", "MISTRAL SMALL", messages
        )),
        ("groq_fast", lambda: call_openai_compatible(
            "groq", "https://api.groq.com/openai/v1/chat/completions",
            os.environ.get("GROQ_API_KEY", "").strip(), "openai/gpt-oss-20b", "GROQ GPT-OSS-20B", messages
        )),
    ]

    if req.preferred_provider != "auto":
        all_routes.sort(key=lambda x: 0 if x[0].startswith(req.preferred_provider) else 1)

    errors = []
    for name, fn in all_routes:
        try:
            full_text, brain_label = await fn()
            speech_text, artifact = extract_speech_and_artifact(full_text)
            return {
                "reply": full_text,
                "speech": speech_text,
                "artifact": artifact,
                "brain": brain_label,
                "ok": True,
            }
        except Exception as e:
            errors.append(f"{name}: {str(e)[:70]}")
            continue

    return {
        "reply": (
            "Mayank, abhi koi active free API key respond nahi kar rahi. "
            "Render Environment mein kam se kam ek key (GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, ya OPENROUTER_API_KEY) add karo! "
            f"Details: {' | '.join(errors[:2])}"
        ),
        "speech": "Mayank, Render environment mein koi active API key add karo taaki mera neural core online ho sake.",
        "artifact": "",
        "brain": "OFFLINE",
        "ok": False,
    }


@app.post("/api/tts")
async def human_voice_tts(req: TTSRequest):
    clean = re.sub(r"[*#`>_~]", "", req.text).strip()[:650]
    if not clean:
        clean = "Ready for your command, Mayank."
    comm = edge_tts.Communicate(clean, req.voice, rate="+2%", pitch="-1Hz")
    buf = io.BytesIO()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    buf.seek(0)
    return StreamingResponse(buf, media_type="audio/mpeg")


def read_web_file(filename: str) -> str:
    for folder in [WEB_DIR, BASE_DIR]:
        p = os.path.join(folder, filename)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
    return ""


@app.get("/", response_class=HTMLResponse)
async def serve_vsepr_hud():
    html = read_web_file("index.html")
    css = read_web_file("style.css")
    js = read_web_file("app.js")
    if not html:
        return HTMLResponse("<h3>Step 3 pending: web/index.html banayein!</h3>")
    if css:
        html = html.replace('<link rel="stylesheet" href="/style.css" />', f"<style>{css}</style>")
        html = html.replace('<link rel="stylesheet" href="/style.css">', f"<style>{css}</style>")
    if js:
        html = html.replace('<script src="/app.js"></script>', f"<script>{js}</script>")
    return HTMLResponse(html)
