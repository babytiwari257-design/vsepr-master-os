let audioEnabled = true;
let continuousVoice = false;
let activeAudio = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let orbMode = "idle"; // idle | listening | thinking | speaking
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

// 1. REAL-TIME AUDIO-REACTIVE NEURAL ORB (HTML5 CANVAS)
let phase = 0;
function drawOrb() {
  requestAnimationFrame(drawOrb);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  let energy = 0.15;
  if (orbMode === "speaking" && analyser && dataArray) {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    energy = Math.max(0.2, (sum / dataArray.length) / 90);
  } else if (orbMode === "listening") {
    energy = 0.55 + Math.sin(phase * 2) * 0.2;
  } else if (orbMode === "thinking") {
    energy = 0.45 + Math.cos(phase * 3) * 0.25;
  }

  const color =
    orbMode === "listening" ? "#ef4444" :
    orbMode === "thinking" ? "#eab308" :
    orbMode === "speaking" ? "#10b981" : "#38bdf8";

  // Draw glowing waveform core
  ctx.beginPath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 14;
  ctx.shadowColor = color;

  for (let x = 15; x < w - 15; x++) {
    const norm = (x - w / 2) / (w / 2);
    const envelope = Math.cos(norm * (Math.PI / 2));
    const wave =
      Math.sin(x * 0.07 + phase) * 18 * energy * envelope +
      Math.cos(x * 0.15 - phase * 1.6) * 8 * energy * envelope;
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

// 2. CHECK ACTIVE FREE API PROVIDERS
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

// 3. UI HELPERS & WORKBENCH PAD CONTROLS
function appendMessage(role, text, metaLabel) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const cleanDisplay = text.replace(/```[\s\S]*?```/g, "\n[📐 Code / Derivation sent to Right Workbench Pad]").trim();
  div.innerHTML = `<div class="meta">◈ ${metaLabel}</div>${cleanDisplay.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
  chatFeed.appendChild(div);
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

// 4. HUMAN NEURAL VOICE PLAYBACK + WEB AUDIO ANALYSER
async function speakHuman(text, onDoneCallback) {
  if (!audioEnabled || !text) {
    setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
    if (onDoneCallback) onDoneCallback();
    return;
  }

  if (activeAudio) activeAudio.pause();
  setOrbState("speaking", "V.S.E.P.R. SPEAKING...");

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        voice: voiceSelect.value || "hi-IN-MadhurNeural"
      })
    });
    if (!res.ok) throw new Error("TTS failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    activeAudio = new Audio(url);
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const src = audioCtx.createMediaElementSource(activeAudio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);

    activeAudio.onended = () => {
      setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
      if (onDoneCallback) onDoneCallback();
    };
    activeAudio.onerror = () => {
      setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
      if (onDoneCallback) onDoneCallback();
    };
    await activeAudio.play();
  } catch (e) {
    setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
    if (onDoneCallback) onDoneCallback();
  }
}

// 5. CORE MULTI-API ROUTING DISPATCH
async function sendPrompt(customText = null) {
  const prompt = (customText !== null ? customText : promptInput.value).trim();
  if (!prompt) return;
  if (customText === null) promptInput.value = "";

  if (activeAudio) activeAudio.pause();
  appendMessage("user", prompt, "MAYANK // COMMAND");
  setOrbState("thinking", "ROUTING ACROSS NEURAL ENGINES...");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        history: chatHistory,
        preferred_provider: providerSelect.value
      })
    });
    const data = await res.json();

    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: data.reply });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

    const brainUsed = data.brain || "V.S.E.P.R. CORE";
    activeBrainTag.textContent = brainUsed;
    appendMessage("vsepr", data.reply, `V.S.E.P.R. // ${brainUsed}`);

    if (data.artifact) {
      artifactScreen.textContent = data.artifact;
    }

    speakHuman(data.speech, () => {
      if (continuousVoice) startListening();
    });
  } catch (err) {
    setOrbState("idle", "CONNECTION INTERRUPTED");
    appendMessage("vsepr", "Network link weak hai Mayank, ek baar phir try karo.", "SYSTEM ALERT");
  }
}

sendBtn.addEventListener("click", () => sendPrompt());
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendPrompt();
});

// 6. SPEECH RECOGNITION & HANDS-FREE CALL MODE
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRec) {
  recognition = new SpeechRec();
  recognition.lang = "en-IN";
  recognition.interimResults = false;

  recognition.onstart = () => {
    micBtn.classList.add("listening");
    setOrbState("listening", "LISTENING TO MAYANK...");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    micBtn.classList.remove("listening");
    sendPrompt(transcript);
  };

  recognition.onerror = () => {
    micBtn.classList.remove("listening");
    setOrbState("idle", "MIC STANDBY");
  };

  recognition.onend = () => {
    micBtn.classList.remove("listening");
    if (orbMode === "listening") setOrbState("idle", "V.S.E.P.R. ONLINE // READY");
  };
}

function startListening() {
  if (!recognition) {
    alert("Is browser mein Voice Mic supported nahi hai — Chrome/Edge use karein.");
    return;
  }
  if (activeAudio) activeAudio.pause();
  try {
    recognition.start();
  } catch (e) {}
}

micBtn.addEventListener("click", startListening);

continuousBtn.addEventListener("click", () => {
  continuousVoice = !continuousVoice;
  continuousBtn.classList.toggle("active", continuousVoice);
  continuousBtn.textContent = continuousVoice ? "🔄 HANDS-FREE: ON" : "🔄 HANDS-FREE: OFF";
  if (continuousVoice) startListening();
});
