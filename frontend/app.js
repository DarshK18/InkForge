const form = document.querySelector("#form");
const topic = document.querySelector("#topic");
const submit = document.querySelector("#submit");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const apiKeyPanel = document.querySelector("#api-key-panel");
const apiKeyInput = document.querySelector("#api-key-input");
const saveApiKey = document.querySelector("#save-api-key");
const forgetApiKey = document.querySelector("#forget-api-key");
let sessionApiKey = sessionStorage.getItem("inkforge_google_api_key") || "";
let draft = {};

document.querySelector("#year").textContent = new Date().getFullYear();
forgetApiKey.classList.toggle("hidden", !sessionApiKey);
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    topic.value = button.textContent.trim();
    topic.focus();
  });
});

document.querySelector("#download").addEventListener("click", () => {
  const blob = new Blob([draft.markdown || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(draft.title || "inkforge-draft").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
});

saveApiKey.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyInput.focus();
    return;
  }
  sessionApiKey = key;
  sessionStorage.setItem("inkforge_google_api_key", key);
  apiKeyInput.value = "";
  forgetApiKey.classList.remove("hidden");
  apiKeyPanel.classList.add("hidden");
  status.className = "status";
  status.textContent = "Key saved for this browser session. Continuing your draft…";
  form.requestSubmit();
});
apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveApiKey.click();
});

forgetApiKey.addEventListener("click", () => {
  sessionStorage.removeItem("inkforge_google_api_key");
  sessionApiKey = "";
  forgetApiKey.classList.add("hidden");
  apiKeyPanel.classList.add("hidden");
  status.className = "status";
  status.textContent = "Saved key removed from this browser session.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.className = "status";
  status.textContent = "Planning, researching, and writing your first draft… This can take a few minutes.";
  result.classList.add("hidden");
  try {
    const headers = { "Content-Type": "application/json" };
    if (sessionApiKey) headers["X-Google-API-Key"] = sessionApiKey;
    const response = await fetch("/api/generate", {
      method: "POST",
      headers,
      body: JSON.stringify({ topic: topic.value.trim() }),
    });
    const data = await response.json();
    if (response.status === 503) {
      apiKeyPanel.classList.remove("hidden");
      apiKeyInput.focus();
      status.className = "status";
      status.textContent = "Add your Google AI API key to continue. It will be kept for this browser session only.";
      return;
    }
    if (response.status === 502 && sessionApiKey) {
      apiKeyPanel.classList.remove("hidden");
      apiKeyInput.focus();
      status.className = "status error";
      status.textContent = "Google could not use that key. Check it or enter a different key for this session.";
      return;
    }
    if (!response.ok) throw new Error(data.detail || "Could not generate a draft.");
    draft = data;
    document.querySelector("#result-title").textContent = data.title;
    document.querySelector("#result-meta").textContent = `${(data.mode || "closed_book").replaceAll("_", " ")} mode · ${data.evidence.length} research sources`;
    document.querySelector("#markdown").textContent = data.markdown;
    result.classList.remove("hidden");
    status.className = "status";
    status.textContent = "Your draft is ready. Give it a read, then download the Markdown.";
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.className = "status error";
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
