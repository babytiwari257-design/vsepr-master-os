let authToken = localStorage.getItem("vsepr_token") || "";
let currentUser = localStorage.getItem("vsepr_user") || "";
let activeFriendId = "";
let activeTaskMode = "auto";

let audioEnabled = true;
let continuousVoice = false;
let activeAudio = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let orbMode = "idle";
let chatHistory = [];

const chatFeed = document.getElementById("chatFeed");
const promptInput = document.getElementById("promptInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const continuousBtn = document.getElementById("continuousBtn");
const audioToggleBtn = document.getElementById("audioToggleBtn");
const providerSelect = document.getElementById("providerSelect");
const voiceSelect = document.getElementById("voiceSelect");
const orbStatus = document.getElementById("orbStatus");
const artifactScreen = document.getElementById("artifactScreen");
const activeBrainTag = document.getElementById("activeBrainTag");
const canvas = document.getElementById("neuralOrb");
const ctx = canvas.getContext("2d");

function renderMathCleanly(el) {
  if (window.renderMathInElement && el) {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }
}

// ================= 1. LOGIN & REGISTER GATE =================
const authGate = document.getElementById("authGate");
const authError = document.getElementById("authError");
const loggedUserLabel = document.getElementById("loggedUserLabel");

function unlockApp(token, userId) {
  authToken = token;
  currentUser = userId;
  localStorage.setItem("vsepr_token", token);
  localStorage.setItem("vsepr_user", userId);
  loggedUserLabel.textContent = `@${userId.toUpperCase()}`;
  authGate.style.display = "none";
  pollSocialOverview();
}

async function handleAuth(mode) {
  const user_id = document.getElementById("authUserId").value.trim();
  const password = document.getElementById("authPassword").value.trim();
  authError.textContent = "";
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id, password, mode })
    });
    const data = await res.json();
    if (!res.ok) {
      authError.textContent = data.detail || "Login failed";
      return;
    }
    unlockApp(data.token, data.user_id);
  } catch (e) {
    authError.textContent = "Server se connection nahi ho paya.";
  }
}

document.getElementById("loginBtn").addEventListener("click", () => handleAuth("login"));
document.getElementById("registerBtn").addEventListener("click", () => handleAuth("register"));
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("vsepr_token");
  localStorage.removeItem("vsepr_user");
  location.reload();
});

if (authToken && currentUser) {
  unlockApp(authToken, currentUser);
}

// ================= 2. INSTAGRAM-STYLE PULSE DM APP =================
const pulseDrawer = document.getElementById("pulseDrawer");
const globalUnreadBadge = document.getElementById("globalUnreadBadge");
const dmMessages = document.getElementById("dmMessages");
const dmInput = document.getElementById("dmInput");
const dmSendBtn = document.getElementById("dmSendBtn");

document.getElementById("openPulseBtn").addEventListener("click", () => {
  pulseDrawer.classList.add("open");
  pollSocialOverview();
});
document.getElementById("closePulseBtn").addEventListener("click", () => {
  pulseDrawer.classList.remove("open");
});

document.getElementById("sendReqBtn").addEventListener("click", async () => {
  const target_id = document.getElementById("friendSearchInput").value.trim();
  if (!target_id) return;
  const fb = document.getElementById("reqFeedback");
  try {
    const res = await fetch("/api/social/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ target_id })
    });
    const data = await res.json();
    fb.textContent = data.message || data.detail || "";
    document.getElementById("friendSearchInput").value = "";
    pollSocialOverview();
  } catch (e) {}
});

async function respondRequest(target_id, action) {
  await fetch(`/api/social/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ target_id })
  });
  pollSocialOverview();
}

async function openFriendChat(friendId) {
  activeFriendId = friendId;
  document.getElementById("activeFriendName").textContent = `@${friendId}`;
  dmInput.disabled = false;
  dmSendBtn.disabled = false;
  await loadDmMessages();
  pollSocialOverview();
}

async function loadDmMessages() {
  if (!activeFriendId || !authToken) return;
  try {
    const res = await fetch(`/api/social/messages/${activeFriendId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const st = document.getElementById("activeFriendStatus");
    st.textContent = data.online ? "● ONLINE" : "OFFLINE";
    st.classList.toggle("live", data.online);

    dmMessages.innerHTML = "";
    if (!data.messages.length) {
      dmMessages.innerHTML = `<div class="dm-empty">Say hello to @${activeFriendId}!</div>`;
      return;
    }
    data.messages.forEach((m) => {
      const mine = m.from === currentUser;
      const div = document.createElement("div");
      div.className = `dm-bubble ${mine ? "mine" : "theirs"}`;
      div.innerHTML = `${m.text.replace(/</g, "&lt;")}${mine ? `<div class="dm-seen">${m.read ? "Seen ✓✓" : "Sent ✓"}</div>` : ""}`;
      dmMessages.appendChild(div);
    });
    dmMessages.scrollTop = dmMessages.scrollHeight;
  } catch (e) {}
}

async function sendDm() {
  const text = dmInput.value.trim();
  if (!text || !activeFriendId) return;
  dmInput.value = "";
  await fetch("/api/social/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ to_user: activeFriendId, text })
  });
  await loadDmMessages();
  pollSocialOverview();
}

dmSendBtn.addEventListener("click", sendDm);
dmInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendDm(); });

async function pollSocialOverview() {
  if (!authToken) return;
  try {
    const res = await fetch("/api/social/overview", {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (res.status === 401) {
      authGate.style.display = "flex";
      return;
    }
    const data = await res.json();

    const totalAlerts = (data.total_unread || 0) + (data.incoming_requests?.length || 0);
    if (totalAlerts > 0) {
      globalUnreadBadge.style.display = "inline-block";
      globalUnreadBadge.textContent = totalAlerts > 4 ? "4+" : String(totalAlerts);
    } else {
      globalUnreadBadge.style.display = "none";
    }

    const incBox = document.getElementById("incomingBox");
    const incList = document.getElementById("incomingList");
    if (data.incoming_requests && data.incoming_requests.length > 0) {
      incBox.style.display = "block";
      incList.innerHTML = "";
      data.incoming_requests.forEach((sender) => {
        const row = document.createElement("div");
        row.className = "req-item";
        row.innerHTML = `<span><b>@${sender}</b> wants to chat</span>
          <div style="display:flex;gap:5px;">
            <button class="btn-small" style="border-color:#10b981;color:#34d399;" onclick="respondRequest('${sender}','accept')">ACCEPT</button>
            <button class="btn-small" style="border-color:#f43f5e;color:#fb7185;" onclick="respondRequest('${sender}','decline')">DECLINE</button>
          </div>`;
        incList.appendChild(row);
      });
    } else {
      incBox.style.display = "none";
    }

    const friendsList = document.getElementById("friendsList");
    friendsList.innerHTML = "";
    (data.friends || []).forEach((f) => {
      const card = document.createElement("div");
      card.className = `friend-card ${f.user_id === activeFriendId ? "active" : ""}`;
      card.onclick = () => openFriendChat(f.user_id);
      const badge = f.unread > 0 ? `<span class="unread-badge">${f.unread > 4 ? "4+" : f.unread}</span>` : "";
      card.innerHTML = `
        <div class="friend-top">
          <span><i class="online-dot ${f.online ? "live" : ""}"></i>@${f.user_id}</span>
          ${badge}
        </div>
        <div class="friend-preview">${f.last_msg.replace(/</g, "&lt;")}</div>
      `;
      friendsList.appendChild(card);
    });

    if (activeFriendId && pulseDrawer.classList.contains("open")) {
      loadDmMessages();
    }
  } catch (e) {}
}

setInterval(pollSocialOverview, 3500);

// ================= 3. AUDIO-REACTIVE NEURAL ORB =================
let phase = 0;
function drawOrb() {
  requestAnimationFrame(drawOrb);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  let energy = 0.22;
  if (orbMode === "speaking" && analyser && dataArray) {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    energy = Math.max(0.28, (sum / dataArray.length) / 80);
  } else if (orbMode === "listening") {
    energy = 0.6 + Math.sin(phase * 2) * 0.2;
  } else if (orbMode === "thinking") {
    energy = 0.5 + Math.cos(phase * 3) * 0.25;
  }

  const color =
    orbMode === "listening" ? "#f43f5e" :
    orbMode === "thinking" ? "#fbbf24" :
    orbMode === "speaking" ? "#22d3ee" : "#e879f9";

  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 18;
  ctx.shadowColor = color;

  for (let x = 15; x < w - 15; x++) {
    const norm = (x - w / 2) / (w / 2);
    const envelope = Math.cos(norm * (Math.PI / 2));
    const wave =
      Math.sin(x * 0.07 + phase) * 19 * energy * envelope +
      Math.cos(x * 0.15 - phase * 1.6) * 9 * energy * envelope;
    const y = h / 2 + wave;
    if (x === 15) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  phase += orbMode === "thinking" ? 0.16 : 0.08;
}
drawOrb();

function setOrbState(state, label) {
  orbMode = state;
  if (orbStatus && label) orbStatus.textContent = label;
}

// ================= 4. V.S.E.P.R. MULTI-API AI ROUTER, DEDICATED TASKS & HUMAN VOICE =================
async function refreshApiStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const providers = data.providers || {};
    Object.keys(providers).forEach((key) => {
      const pill = document.getElementById(`pill-${key}`);
      if (pill) pill.classList.toggle("online", providers[key]);
    });
  } catch (e) {}
}
refreshApiStatus();

function appendMessage(role, text, metaLabel) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const cleanDisplay = text.replace(/```[\s\S]*?```/g, "\n[Deliverable sent to Right Workbench Pad]").trim();
  div.innerHTML = `<div class="meta">◈ ${metaLabel}</div>${cleanDisplay.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
  chatFeed.appendChild(div);
  renderMathCleanly(div);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

document.getElementById("copyPadBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(artifactScreen.textContent);
  setOrbState("idle", "COPIED TO CLIPBOARD");
});
document.getElementById("downloadPadBtn").addEventListener("click", () => {
  const blob = new Blob([artifactScreen.textContent], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vsepr_workbench_output.txt";
  a.click();
});
document.getElementById("clearPadBtn").addEventListener("click", () => {
  artifactScreen.textContent = "// Workbench Pad Cleared.";
});

audioToggleBtn.addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  audioToggleBtn.classList.toggle("active", audioEnabled);
  audioToggleBtn.textContent = audioEnabled ? "🔊 AUDIO: LIVE" : "🔇 AUDIO: MUTE";
  if (!audioEnabled && activeAudio) {
    activeAudio.pause();
    setOrbState("idle", "AUDIO MUTED");
  }
});

async function speakHuman(text, onDoneCallback) {
  if (!audioEnabled || !text) {
    setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
    if (onDoneCallback) onDoneCallback();
    return;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  setOrbState("speaking", "V.S.E.P.R. SPEAKING...");

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voiceSelect.value || "hi-IN-MadhurNeural" })
    });
    if (!res.ok) throw new Error("TTS failed");
    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    activeAudio = audio;

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const src = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);

    const cleanup = () => {
      URL.revokeObjectURL(audioUrl);
      setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
      if (onDoneCallback) onDoneCallback();
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;
    await audio.play();
  } catch (e) {
    setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
    if (onDoneCallback) onDoneCallback();
  }
}

// Parse slash commands like "/code build a timer" or "/physics derive escape velocity"
function parseCommandPrefix(rawPrompt) {
  const match = rawPrompt.match(/^\/(code|physics|notes|plan)\s+([\s\S]+)$/i);
  if (match) {
    return { mode: match[1].toLowerCase(), cleanPrompt: match[2].trim() };
  }
  return { mode: activeTaskMode, cleanPrompt: rawPrompt };
}

window.runDedicatedTask = function(mode, customPrompt = null) {
  activeTaskMode = mode;
  if (customPrompt) {
    sendPrompt(customPrompt, mode);
  } else {
    setOrbState("idle", `TASK MODE ARMED: ${mode.toUpperCase()}`);
    promptInput.focus();
  }
};

async function sendPrompt(customText = null, forcedMode = null) {
  const rawInput = (customText !== null ? customText : promptInput.value).trim();
  if (!rawInput) return;
  if (customText === null) promptInput.value = "";

  const parsed = parseCommandPrefix(rawInput);
  const taskModeToSend = forcedMode || parsed.mode;
  const prompt = parsed.cleanPrompt;

  if (activeAudio) activeAudio.pause();
  appendMessage("user", prompt, `${currentUser.toUpperCase()} // ${taskModeToSend !== "auto" ? taskModeToSend.toUpperCase() : "COMMAND"}`);
  setOrbState("thinking", `EXECUTING ${taskModeToSend.toUpperCase()} ROUTINE...`);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        history: chatHistory,
        preferred_provider: providerSelect.value,
        task_mode: taskModeToSend
      })
    });
    const data = await res.json();

    // Reset one-shot task mode back to auto after execution
    activeTaskMode = "auto";

    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: data.reply });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

    const brainUsed = data.brain || "V.S.E.P.R. CORE";
    const taskTag = data.task_mode && data.task_mode !== "GENERAL" ? ` • [${data.task_mode}]` : "";
    activeBrainTag.textContent = `${brainUsed}${taskTag}`;
    appendMessage("vsepr", data.reply, `V.S.E.P.R. // ${brainUsed}${taskTag}`);

    if (data.artifact) {
      artifactScreen.textContent = data.artifact;
      renderMathCleanly(artifactScreen);
    }

    speakHuman(data.speech, () => {
      if (continuousVoice) startListening();
    });
  } catch (err) {
    setOrbState("idle", "CONNECTION INTERRUPTED");
  }
}

sendBtn.addEventListener("click", () => sendPrompt());
promptInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendPrompt(); });

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRec) {
  recognition = new SpeechRec();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.onstart = () => { micBtn.classList.add("listening"); setOrbState("listening", "LISTENING..."); };
  recognition.onresult = (e) => { micBtn.classList.remove("listening"); sendPrompt(e.results[0][0].transcript); };
  recognition.onerror = () => { micBtn.classList.remove("listening"); setOrbState("idle", "MIC STANDBY"); };
  recognition.onend = () => { micBtn.classList.remove("listening"); if (orbMode === "listening") setOrbState("idle", "V.S.E.P.R. ONLINE // READY"); };
}

function startListening() {
  if (!recognition) return;
  if (activeAudio) activeAudio.pause();
  try { recognition.start(); } catch (e) {}
}

micBtn.addEventListener("click", startListening);
continuousBtn.addEventListener("click", () => {
  continuousVoice = !continuousVoice;
  continuousBtn.classList.toggle("active", continuousVoice);
  continuousBtn.textContent = continuousVoice ? "🔄 HANDS-FREE: ON" : "🔄 HANDS-FREE: OFF";
  if (continuousVoice) startListening();
});
