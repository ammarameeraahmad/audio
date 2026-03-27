// ===== DOM REFS =====
const videoScript = document.getElementById("videoScript");
const aiModel = document.getElementById("aiModel");
const voice = document.getElementById("voice");
const generateButton = document.getElementById("generateButton");
const cancelButton = document.getElementById("cancelButton");
const advancedOptionsToggle = document.getElementById("advancedOptionsToggle");
const advancedPanel = document.getElementById("advancedOptions");
const statusArea = document.getElementById("statusArea");
const colorDot = document.getElementById("colorDot");
const subtitlesColor = document.getElementById("subtitlesColor");
const subtitlesPosition = document.getElementById("subtitlesPosition");
const threads = document.getElementById("threads");
const paragraphNumber = document.getElementById("paragraphNumber");
const customPrompt = document.getElementById("customPrompt");
const youtubeUploadToggle = document.getElementById("youtubeUploadToggle");
const useMusicToggle = document.getElementById("useMusicToggle");
const reuseChoicesToggle = document.getElementById("reuseChoicesToggle");
const logViewer = document.getElementById("logViewer");
const logViewerBody = document.getElementById("logViewerBody");
const logClearBtn = document.getElementById("logClearBtn");

// Default to localhost if hosted on GitHub Pages (since backend runs locally)
const isGithubPages = window.location.hostname.includes("github.io");
const backendHost = isGithubPages ? "localhost" : (window.location.hostname || "localhost");
const backendProtocol = isGithubPages ? "http:" : (window.location.protocol || "http:");

const API_BASE_URL = `${backendProtocol}//${backendHost}:8080`;
const API_FALLBACK_URL = `http://localhost:8080`;

let activeJobId = null;
let pollHandle = null;
let lastEventId = 0;

// ===== API HELPERS =====
async function apiRequest(path, options = {}) {
  const endpoint = path.startsWith("/") ? path : `/${path}`;

  async function request(baseUrl) {
    const response = await fetch(`${baseUrl}${endpoint}`, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Request failed with status ${response.status}`);
    }
    return data;
  }

  try {
    return await request(API_BASE_URL);
  } catch (firstError) {
    if (API_BASE_URL !== API_FALLBACK_URL) {
      return request(API_FALLBACK_URL);
    }
    throw firstError;
  }
}

function setModelOptions(models, preferredModel) {
  aiModel.innerHTML = "";

  models.forEach((modelName) => {
    const option = document.createElement("option");
    option.value = modelName;
    option.textContent = modelName;
    aiModel.appendChild(option);
  });

  if (preferredModel && models.includes(preferredModel)) {
    aiModel.value = preferredModel;
  } else if (models.length > 0) {
    aiModel.value = models[0];
  }
}

async function loadOllamaModels(reuseEnabled) {
  const fallbackModel = localStorage.getItem("aiModelValue") || "llama3.1:8b";

  try {
    const data = await apiRequest("/api/models", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const models = Array.isArray(data.models)
      ? data.models.filter((item) => typeof item === "string" && item.trim())
      : [];
    const defaultModel =
      typeof data.default === "string" && data.default.trim()
        ? data.default.trim()
        : fallbackModel;
    const preferredModel =
      reuseEnabled && localStorage.getItem("aiModelValue")
        ? localStorage.getItem("aiModelValue")
        : defaultModel;

    if (data.status && data.status !== "success" && data.message) {
      showToast(data.message, "error");
    }

    if (models.length === 0) {
      setModelOptions([defaultModel], preferredModel);
      showToast("No Ollama models found. Pull one with: ollama pull llama3.1:8b", "error");
      return;
    }

    setModelOptions(models, preferredModel);
  } catch {
    setModelOptions([fallbackModel], fallbackModel);
    showToast("Could not load Ollama models. Is backend/Ollama running?", "error");
  }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-dot"></span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => {
    dismissToast(toast);
  });
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });

  setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast) {
  toast.classList.remove("show");
  toast.addEventListener("transitionend", () => toast.remove(), { once: true });
}

// ===== COLOR DOT =====
function updateColorDot() {
  if (colorDot && subtitlesColor) {
    colorDot.style.backgroundColor = subtitlesColor.value;
  }
}
updateColorDot();
subtitlesColor.addEventListener("change", updateColorDot);

// ===== ADVANCED OPTIONS TOGGLE =====
advancedOptionsToggle.addEventListener("click", () => {
  advancedOptionsToggle.classList.toggle("open");
  advancedPanel.classList.toggle("open");
});

// ===== LOG STREAM (SSE) =====
function formatTimestamp(ts) {
  const d = new Date((ts || Date.now() / 1000) * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function appendLogEntry(entry) {
  const row = document.createElement("div");
  row.className = "log-entry";

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = formatTimestamp(entry.timestamp);

  const msg = document.createElement("span");
  msg.className = `log-msg log-${entry.level || "info"}`;
  msg.textContent = entry.message;

  row.appendChild(time);
  row.appendChild(msg);
  logViewerBody.appendChild(row);

  // Auto-scroll to bottom
  logViewerBody.scrollTop = logViewerBody.scrollHeight;
}

async function pollJob() {
  if (!activeJobId) return;

  try {
    const eventsResult = await apiRequest(`/api/jobs/${activeJobId}/events?after=${lastEventId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const events = Array.isArray(eventsResult.events) ? eventsResult.events : [];
    events.forEach((event) => {
      appendLogEntry({
        timestamp: event.timestamp,
        message: event.message,
        level: event.level || "info",
      });
      lastEventId = Math.max(lastEventId, event.id || 0);
    });

    const jobResult = await apiRequest(`/api/jobs/${activeJobId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const state = jobResult?.job?.state;
    if (state === "completed") {
      showToast("Video generated successfully.", "success");
      stopJobPolling();
      setGeneratingState(false);
    } else if (state === "failed") {
      showToast(jobResult?.job?.errorMessage || "Generation failed.", "error");
      stopJobPolling();
      setGeneratingState(false);
    } else if (state === "cancelled") {
      showToast("Generation cancelled.", "warning");
      stopJobPolling();
      setGeneratingState(false);
    }
  } catch {
    // Ignore transient polling failures.
  }
}

function startJobPolling(jobId) {
  stopJobPolling();
  activeJobId = jobId;
  lastEventId = 0;
  logViewer.classList.add("active");
  pollHandle = setInterval(pollJob, 1200);
  pollJob();
}

function stopJobPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

// ===== GENERATE / CANCEL =====
function setGeneratingState(active) {
  if (active) {
    generateButton.classList.add("hidden");
    cancelButton.classList.remove("hidden");
    statusArea.classList.add("active");
  } else {
    stopJobPolling();
    activeJobId = null;
    generateButton.classList.remove("hidden");
    cancelButton.classList.add("hidden");
    statusArea.classList.remove("active");
    generateButton.disabled = false;
    logViewer.classList.remove("active");
  }
}

function cancelGeneration() {
  const targetPath = activeJobId ? `/api/jobs/${activeJobId}/cancel` : "/api/cancel";

  apiRequest(targetPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  })
    .then((data) => showToast(data.message, "success"))
    .catch(() => showToast("Failed to cancel. Is the server running?", "error"));
}

function parseScript(script) {
  const lines = script.trim().split('\n');
  const queries = [];
  lines.forEach(line => {
    if (line.startsWith('#') || line.trim() === '') return;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const query = parts.slice(2).join(' ').trim();
      if (query) queries.push(query);
    }
  });
  return queries;
}

async function generateVideo() {
  const script = videoScript.value.trim();
  if (!script) {
    showToast("Please enter a video script.", "error");
    videoScript.focus();
    return;
  }

  const searchTerms = parseScript(script);
  if (searchTerms.length === 0) {
    showToast("No valid search queries found in script.", "error");
    return;
  }

  generateButton.disabled = true;
  setGeneratingState(true);

  // Clear previous log entries
  logViewerBody.innerHTML = "";

  const data = {
    videoSubject: script, // Send script as subject, backend will parse
    aiModel: aiModel.value || "llama3.1:8b",
    voice: voice.value,
    paragraphNumber: parseInt(paragraphNumber.value) || 1,
    automateYoutubeUpload: youtubeUploadToggle.checked,
    useMusic: useMusicToggle.checked,
    threads: threads.value,
    subtitlesPosition: subtitlesPosition.value,
    customPrompt: customPrompt.value,
    color: subtitlesColor.value,
    searchTerms: searchTerms, // Add parsed search terms
  };

  try {
    const result = await apiRequest("/api/generate-shorts", {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (result.status === "success") {
      if (!result.jobId) {
        showToast("Generation queued, but no job ID was returned.", "error");
        setGeneratingState(false);
        return;
      }
      startJobPolling(result.jobId);
    } else {
      showToast(result.message, "error");
      setGeneratingState(false);
    }
  } catch {
    showToast("Connection error. Is the backend server running?", "error");
    setGeneratingState(false);
  }
}

generateButton.addEventListener("click", generateVideo);
cancelButton.addEventListener("click", cancelGeneration);

videoScript.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    generateVideo();
  }
});

// ===== LOG CLEAR BUTTON =====
logClearBtn.addEventListener("click", () => {
  logViewerBody.innerHTML = "";
});

// ===== LOCAL STORAGE PERSISTENCE =====
const toggleIds = [
  "youtubeUploadToggle",
  "useMusicToggle",
  "reuseChoicesToggle",
];
const fieldIds = [
  "voice",
  "threads",
  "subtitlesPosition",
  "subtitlesColor",
  "paragraphNumber",
  "customPrompt",
];

document.addEventListener("DOMContentLoaded", async () => {
  const reuseEnabled =
    localStorage.getItem("reuseChoicesToggleValue") === "true";

  await loadOllamaModels(reuseEnabled);

  aiModel.addEventListener("change", (e) => {
    localStorage.setItem("aiModelValue", e.target.value);
  });

  // Restore toggles
  toggleIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = localStorage.getItem(`${id}Value`);
    if (stored !== null && reuseEnabled) {
      el.checked = stored === "true";
    }
    el.addEventListener("change", (e) => {
      localStorage.setItem(`${id}Value`, e.target.checked);
    });
  });

  // Restore fields
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = localStorage.getItem(`${id}Value`);
    if (stored && reuseEnabled) {
      el.value = stored;
    }
    el.addEventListener("change", (e) => {
      localStorage.setItem(`${id}Value`, e.target.value);
    });
  });

  // Update color dot after restoring values
  updateColorDot();
});