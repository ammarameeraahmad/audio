// ===== DOM REFS =====
const videoSubject = document.getElementById("videoSubject");
const voice = document.getElementById("voice");
const pexelsApi = document.getElementById("pexelsApi");
const generateButton = document.getElementById("generateButton");
const cancelButton = document.getElementById("cancelButton");
const statusArea = document.getElementById("statusArea");
const logViewer = document.getElementById("logViewer");
const logViewerBody = document.getElementById("logViewerBody");
const logClearBtn = document.getElementById("logClearBtn");
const backendHost = window.location.hostname || "localhost";
const backendProtocol = window.location.protocol || "http:";
const API_BASE_URL = `${backendProtocol}//${backendHost}:8080`;
const API_FALLBACK_URL = `http://${backendHost}:8080`;

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



async function generateVideo() {
  const script = videoSubject.value.trim();
  if (!script) {
    showToast("Please enter a script.", "error");
    videoSubject.focus();
    return;
  }

  const lines = script.split('\n').filter(line => line.trim());
  const parsed = lines.map(line => {
    const parts = line.split('\t');
    // Jika ada 3 kolom, ambil kolom ke-3 sebagai searchTerms, kolom 1 sebagai videoSubject
    return {
      videoSubject: parts[0] || '',
      searchTerms: parts[2] ? parts[2] : (parts[1] || '')
    };
  });

  if (parsed.some(item => !item.videoSubject || !item.searchTerms)) {
    showToast("Each line must have at least 2 tab-separated columns (No. & Search Query).", "error");
    return;
  }

  generateButton.disabled = true;
  const originalText = generateButton.innerHTML;
  generateButton.innerHTML = '<span class="spinner" style="margin-right:8px;width:16px;height:16px;border:2px solid #fff;border-top:2px solid #16a34a;border-radius:50%;display:inline-block;vertical-align:middle;animation:spin 0.8s linear infinite;"></span>Generating...';
  setGeneratingState(true);

  // Clear previous log entries
  logViewerBody.innerHTML = "";

  const aiModel = document.getElementById("aiModel");
  const paragraphNumber = document.getElementById("paragraphNumber");
  const youtubeUploadToggle = document.getElementById("youtubeUploadToggle");
  const useMusicToggle = document.getElementById("useMusicToggle");
  const threads = document.getElementById("threads");
  const subtitlesPosition = document.getElementById("subtitlesPosition");
  const customPrompt = document.getElementById("customPrompt");
  const subtitlesColor = document.getElementById("subtitlesColor");

  const data = {
    searchTerms: parsed.map(item => item.searchTerms),
    videoSubject: parsed.map(item => item.videoSubject).join(' '),
    pexelsApi: pexelsApi.value.trim(),
    aiModel: aiModel ? aiModel.value : "llama3.1:8b",
    voice: voice ? voice.value : "en_us_001",
    paragraphNumber: paragraphNumber ? (parseInt(paragraphNumber.value) || 1) : 1,
    automateYoutubeUpload: youtubeUploadToggle ? youtubeUploadToggle.checked : false,
    useMusic: useMusicToggle ? useMusicToggle.checked : false,
    threads: threads ? threads.value : 4,
    subtitlesPosition: subtitlesPosition ? subtitlesPosition.value : "center,center",
    customPrompt: customPrompt ? customPrompt.value : "",
    color: subtitlesColor ? subtitlesColor.value : "#FFFF00"
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
      generateButton.innerHTML = originalText;
    }
  } catch {
    showToast("Connection error. Is the backend server running?", "error");
    setGeneratingState(false);
    generateButton.innerHTML = originalText;
  }
}

// Spinner animation
const style = document.createElement('style');
style.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
document.head.appendChild(style);

generateButton.addEventListener("click", generateVideo);
cancelButton.addEventListener("click", cancelGeneration);

videoSubject.addEventListener("keydown", (event) => {
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
  "reuseChoicesToggle",
];
const fieldIds = [
  "videoSubject",
  "pexelsApi",
];

document.addEventListener("DOMContentLoaded", () => {
  const reuseEnabled =
    localStorage.getItem("reuseChoicesToggleValue") === "true";

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
});
