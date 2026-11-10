import os
import io
import re
import time
import hashlib
import secrets
import httpx
import edge_tts
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="V.S.E.P.R. OS // Neural Workbench + Pulse Social DM", version="2.0.0")

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

ECOSYSTEM_NODES = {
    "aris": {"name": "A.R.I.S.", "role": "Master Tactical Core", "url": "https://aris-master-core.onrender.com/"},
    "friday": {"name": "F.R.I.D.A.Y.", "role": "Encrypted Vault & Comms", "url": "https://friday-aris.onrender.com/"},
    "omega": {"name": "OMEGA", "role": "Deep Physics & Quantum", "url": "https://project-omega-m1.onrender.com/"},
    "alpha": {"name": "A.L.P.H.A.", "role": "Live Sync & Telemetry", "url": "https://alpha-aris.onrender.com/"},
    "titan": {"name": "TITAN", "role": "Heavy Compute & Defense", "url": "https://titan-aris.onrender.com/"},
}

VSEPR_SYSTEM_PROMPT = (
    "You are V.S.E.P.R., an ultra-intelligent, next-generation AI collaborator and personal tactical co-pilot "
    "engineered by Mayank. Speak like a brilliant, grounded, empathetic human peer — mixing crisp natural Hinglish and English. "
    "If your response includes Python code, mathematical/physics derivations, or a structured blueprint, put ONLY that inside "
    "a single markdown code block (```...```) so the right-hand Workbench Pad displays it cleanly, while keeping your spoken "
    "explanation outside short and natural."
)

# ================= IN-MEMORY SOCIAL & AUTH STORE =================
# Pre-seeded Commander account (you can also register any new User ID + Password from UI!)
def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()

USERS_DB = {
    "mayank": {"password_hash": hash_pw("aris123"), "display_name": "Mayank (Founder)", "last_seen": 0.0},
    "janvi": {"password_hash": hash_pw("janvi123"), "display_name": "Janvi", "last_seen": 0.0},
}
SESSIONS = {}  # token -> user_id
FRIEND_REQUESTS = []  # [{"from": u1, "to": u2, "status": "pending"|"accepted"}]
DM_MESSAGES = []  # [{"id": int, "from": u1, "to": u2, "text": str, "ts": float, "read": bool}]


class AuthPayload(BaseModel):
    user_id: str
    password: str
    mode: str = "login"  # login | register


class FriendActionPayload(BaseModel):
    target_id: str


class DMPayload(BaseModel):
    to_user: str
    text: str


class ChatRequest(BaseModel):
    prompt: str
    history: list = []
    preferred_provider: str = "auto"


class TTSRequest(BaseModel):
    text: str
    voice: str = "hi-IN-MadhurNeural"


def get_current_user(authorization: str = Header(default="")) -> str:
    token = authorization.replace("Bearer ", "").strip()
    user_id = SESSIONS.get(token)
    if not user_id or user_id not in USERS_DB:
        raise HTTPException(status_code=401, detail="Unauthorized")
    USERS_DB[user_id]["last_seen"] = time.time()
    return user_id


def are_friends(u1: str, u2: str) -> bool:
    for r in FRIEND_REQUESTS:
        if r["status"] == "accepted" and {r["from"], r["to"]} == {u1, u2}:
            return True
    return False


# ================= AUTH & SOCIAL ENDPOINTS =================
@app.post("/api/auth")
async def auth_user(payload: AuthPayload):
    uid = re.sub(r"[^a-zA-Z0-9_.]", "", payload.user_id.strip().lower())
    pw = payload.password.strip()
    if len(uid) < 3 or len(pw) < 3:
        raise HTTPException(status_code=400, detail="User ID aur Password kam se kam 3 characters ke hone chahiye.")

    if payload.mode == "register":
        if uid in USERS_DB:
            raise HTTPException(status_code=400, detail="Yeh User ID pehle se li ja chuki hai, koi aur try karo!")
        USERS_DB[uid] = {"password_hash": hash_pw(pw), "display_name": uid.capitalize(), "last_seen": time.time()}
    else:
        if uid not in USERS_DB or USERS_DB[uid]["password_hash"] != hash_pw(pw):
            raise HTTPException(status_code=401, detail="Galat User ID ya Password! Naya account banane ke liye 'Create Account' dabao.")

    USERS_DB[uid]["last_seen"] = time.time()
    token = secrets.token_hex(24)
    SESSIONS[token] = uid
    return {"token": token, "user_id": uid}


@app.get("/api/social/overview")
async def social_overview(authorization: str = Header(default="")):
    me = get_current_user(authorization)
    now = time.time()

    incoming_requests = [
        r["from"] for r in FRIEND_REQUESTS if r["to"] == me and r["status"] == "pending"
    ]
    outgoing_requests = [
        r["to"] for r in FRIEND_REQUESTS if r["from"] == me and r["status"] == "pending"
    ]

    friends = []
    total_unread = 0
    for uid, info in USERS_DB.items():
        if uid == me:
            continue
        if are_friends(me, uid):
            unread = sum(1 for m in DM_MESSAGES if m["from"] == uid and m["to"] == me and not m["read"])
            total_unread += unread
            convo = [m for m in DM_MESSAGES if {m["from"], m["to"]} == {me, uid}]
            last_msg = convo[-1]["text"] if convo else "Say hi! 👋"
            is_online = (now - info["last_seen"]) < 25
            friends.append({
                "user_id": uid,
                "online": is_online,
                "unread": unread,
                "last_msg": last_msg[:38],
            })

    return {
        "me": me,
        "friends": friends,
        "incoming_requests": incoming_requests,
        "outgoing_requests": outgoing_requests,
        "total_unread": total_unread,
        "all_users": [u for u in USERS_DB.keys() if u != me],
    }


@app.post("/api/social/request")
async def send_friend_request(payload: FriendActionPayload, authorization: str = Header(default="")):
    me = get_current_user(authorization)
    target = payload.target_id.strip().lower()
    if target == me or target not in USERS_DB:
        raise HTTPException(status_code=404, detail="Yeh User ID nahi mili! Pehle unhe account banane bolo.")
    if are_friends(me, target):
        return {"message": "Tum dono pehle se connected ho!"}

    for r in FRIEND_REQUESTS:
        if r["from"] == target and r["to"] == me and r["status"] == "pending":
            r["status"] = "accepted"
            return {"message": f"@{target} ki request pehle se aayi thi — ab tum dono connected ho!"}
        if r["from"] == me and r["to"] == target and r["status"] == "pending":
            return {"message": "Request pehle hi bhej di gayi hai!"}

    FRIEND_REQUESTS.append({"from": me, "to": target, "status": "pending"})
    return {"message": f"@{target} ko follow/chat request bhej di gayi!"}


@app.post("/api/social/accept")
async def accept_friend_request(payload: FriendActionPayload, authorization: str = Header(default="")):
    me = get_current_user(authorization)
    sender = payload.target_id.strip().lower()
    for r in FRIEND_REQUESTS:
        if r["from"] == sender and r["to"] == me and r["status"] == "pending":
            r["status"] = "accepted"
            return {"message": f"@{sender} accepted! Ab DM chat khul gayi hai."}
    raise HTTPException(status_code=404, detail="Pending request nahi mili.")


@app.post("/api/social/decline")
async def decline_friend_request(payload: FriendActionPayload, authorization: str = Header(default="")):
    me = get_current_user(authorization)
    sender = payload.target_id.strip().lower()
    global FRIEND_REQUESTS
    FRIEND_REQUESTS = [r for r in FRIEND_REQUESTS if not (r["from"] == sender and r["to"] == me and r["status"] == "pending")]
    return {"message": "Request hata di gayi."}


@app.get("/api/social/messages/{friend_id}")
async def get_dm_thread(friend_id: str, authorization: str = Header(default="")):
    me = get_current_user(authorization)
    fid = friend_id.strip().lower()
    if not are_friends(me, fid):
        raise HTTPException(status_code=403, detail="Pehle friend request accept honi zaroori hai!")

    thread = []
    for m in DM_MESSAGES:
        if {m["from"], m["to"]} == {me, fid}:
            if m["to"] == me and not m["read"]:
                m["read"] = True
            thread.append(m)
    return {"messages": thread[-80:], "online": (time.time() - USERS_DB[fid]["last_seen"]) < 25}


@app.post("/api/social/send")
async def send_dm_message(payload: DMPayload, authorization: str = Header(default="")):
    me = get_current_user(authorization)
    to_user = payload.to_user.strip().lower()
    txt = payload.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Empty message")
    if not are_friends(me, to_user):
        raise HTTPException(status_code=403, detail="Pehle request accept hone do!")

    msg = {
        "id": len(DM_MESSAGES) + 1,
        "from": me,
        "to": to_user,
        "text": txt,
        "ts": time.time(),
        "read": False,
    }
    DM_MESSAGES.append(msg)
    return {"ok": True, "message": msg}


# ================= V.S.E.P.R. MULTI-API AI BRAIN =================
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
        return data["candidates"][0]["content"]["parts"][0]["text"], "GEMINI 2.5 FLASH"


async def call_openai_compatible(provider: str, url: str, key: str, model: str, label: str, messages: list) -> tuple[str, str]:
    if not key:
        raise RuntimeError(f"No {provider} key")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://vsepr-master-os.onrender.com"
        headers["X-Title"] = "V.S.E.P.R. Master OS"
    payload = {"model": model, "messages": messages, "temperature": 0.72, "max_tokens": 850}
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"], label


@app.get("/api/status")
async def get_system_status():
    return {"providers": get_configured_providers(), "nodes": ECOSYSTEM_NODES}


@app.post("/api/chat")
async def vsepr_brain_router(req: ChatRequest):
    messages = [{"role": "system", "content": VSEPR_SYSTEM_PROMPT}]
    for h in req.history[-8:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": req.prompt.strip()})

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
            return {"reply": full_text, "speech": speech_text, "artifact": artifact, "brain": brain_label, "ok": True}
        except Exception as e:
            errors.append(f"{name}: {str(e)[:70]}")
            continue

    return {
        "reply": f"Render Environment mein kam se kam ek free API key add karo! ({' | '.join(errors[:2])})",
        "speech": "Render environment mein koi active API key add karo taaki mera neural core online ho sake.",
        "artifact": "",
        "brain": "OFFLINE",
        "ok": False,
    }


@app.post("/api/tts")
async def human_voice_tts(req: TTSRequest):
    clean = re.sub(r"[*#`>_~]", "", req.text).strip()[:650] or "Ready for your command, Mayank."
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
    if css:
        html = html.replace('<link rel="stylesheet" href="/style.css" />', f"<style>{css}</style>")
        html = html.replace('<link rel="stylesheet" href="/style.css">', f"<style>{css}</style>")
    if js:
        html = html.replace('<script src="/app.js"></script>', f"<script>{js}</script>")
    return HTMLResponse(html)
