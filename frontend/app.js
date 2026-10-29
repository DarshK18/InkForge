const form = document.querySelector("#form");
const topic = document.querySelector("#topic");
const submit = document.querySelector("#submit");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const apiKeyPanel = document.querySelector("#api-key-panel");
const apiKeyInput = document.querySelector("#api-key-input");
const saveApiKey = document.querySelector("#save-api-key");
const forgetApiKey = document.querySelector("#forget-api-key");
const documentInput = document.querySelector("#document-input");
const documentList = document.querySelector("#document-list");
const libraryCount = document.querySelector("#library-count");
const IDB_NAME = "inkforge-private-library";
const IDB_STORE = "documents";
const MAX_LIBRARY_CHUNKS = 120;
let sessionApiKey = sessionStorage.getItem("inkforge_google_api_key") || "";
let draft = {};
let db;

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.className = `status-message ${kind}`;
}

function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE, { keyPath: "filename" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE, mode);
    const request = action(transaction.objectStore(IDB_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const allDocuments = () => storeRequest("readonly", (store) => store.getAll());
const saveDocument = (record) => storeRequest("readwrite", (store) => store.put(record));
const removeDocument = (filename) => storeRequest("readwrite", (store) => store.delete(filename));

function updateKeyState() {
  document.querySelector("#key-indicator").classList.toggle("active", Boolean(sessionApiKey));
  document.querySelector("#key-state").textContent = sessionApiKey ? "connected" : "not set";
  document.querySelector("#forget-api-key").classList.toggle("hidden", !sessionApiKey);
}

function showKeyPanel() {
  apiKeyPanel.classList.remove("hidden");
  apiKeyInput.focus();
}

function hideKeyPanel() {
  apiKeyPanel.classList.add("hidden");
}

async function renderLibrary() {
  const docs = await allDocuments();
  documentList.replaceChildren();
  libraryCount.textContent = String(docs.length);
  if (!docs.length) {
    const empty = document.createElement("li");
    empty.id = "empty-library";
    empty.className = "empty-library";
    empty.textContent = "Add notes, briefs, or research to ground your writing.";
    documentList.append(empty);
    return;
  }
  docs.sort((a, b) => a.filename.localeCompare(b.filename));
  for (const doc of docs) {
    const item = document.createElement("li");
    item.className = "document-item";
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = doc.filename.split(".").pop().slice(0, 3).toUpperCase();
    const info = document.createElement("span");
    info.className = "document-info";
    const name = document.createElement("b");
    name.textContent = doc.filename;
    const details = document.createElement("small");
    details.textContent = `${doc.chunks.length} passages · ${formatBytes(doc.size)}`;
    info.append(name, details);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-document";
    remove.setAttribute("aria-label", `Remove ${doc.filename}`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await removeDocument(doc.filename);
      await renderLibrary();
      setStatus(`${doc.filename} removed from this browser's private library.`);
    });
    item.append(icon, info, remove);
    documentList.append(item);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function applyKey(key) {
  sessionApiKey = key;
  sessionStorage.setItem("inkforge_google_api_key", key);
  apiKeyInput.value = "";
  updateKeyState();
  hideKeyPanel();
}

saveApiKey.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) return apiKeyInput.focus();
  applyKey(key);
  setStatus("Google AI key saved for this tab session. Your private library can now be indexed.");
  if (topic.value.trim().length >= 3) form.requestSubmit();
});
apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveApiKey.click();
});

function forgetKey() {
  sessionStorage.removeItem("inkforge_google_api_key");
  sessionApiKey = "";
  updateKeyState();
  showKeyPanel();
  setStatus("Session key forgotten. Add a Google AI key to index documents or generate a draft.");
}
forgetApiKey.addEventListener("click", forgetKey);
document.querySelector("#manage-api-key").addEventListener("click", showKeyPanel);
document.querySelector("#manage-key-top").addEventListener("click", showKeyPanel);

document.querySelector("#add-document").addEventListener("click", () => {
  if (!sessionApiKey) {
    setStatus("Add a Google AI key before indexing documents.", "error");
    showKeyPanel();
    return;
  }
  documentInput.click();
});
documentInput.addEventListener("change", async () => {
  const files = Array.from(documentInput.files || []);
  documentInput.value = "";
  for (const file of files) {
    if (file.size > 3 * 1024 * 1024) {
      setStatus(`${file.name} is larger than the 3 MB per-document limit.`, "error");
      continue;
    }
    try {
      setStatus(`Reading and embedding ${file.name} with Gemini…`);
      const contentBase64 = await fileToBase64(file);
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Google-API-Key": sessionApiKey },
        body: JSON.stringify({ filename: file.name, content_base64: contentBase64 }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setStatus(data.detail || "Google rejected the key. Add a valid key and retry.", "error");
          showKeyPanel();
          break;
        }
        throw new Error(data.detail || `Could not index ${file.name}.`);
      }
      const docs = await allDocuments();
      const existingCount = docs.reduce((total, doc) => total + doc.chunks.length, 0);
      const replacingCount = docs.find((doc) => doc.filename === data.filename)?.chunks.length || 0;
      if (existingCount - replacingCount + data.chunks.length > MAX_LIBRARY_CHUNKS) {
        setStatus(`The private library is limited to ${MAX_LIBRARY_CHUNKS} passages. Remove a document before adding this one.`, "error");
        continue;
      }
      await saveDocument({ filename: data.filename, size: file.size, chunks: data.chunks, addedAt: Date.now() });
      await renderLibrary();
      setStatus(`${data.filename} indexed and saved in this browser's private library.`);
    } catch (error) {
      setStatus(error.message || "Could not index that document.", "error");
    }
  }
});

topic.addEventListener("input", () => {
  document.querySelector("#char-count").textContent = String(topic.value.length);
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    topic.value = button.textContent.trim();
    topic.dispatchEvent(new Event("input"));
    topic.focus();
  });
});
document.querySelector("#new-draft").addEventListener("click", () => {
  topic.value = "";
  topic.dispatchEvent(new Event("input"));
  result.classList.add("hidden");
  topic.focus();
  setStatus("New draft ready. Add an idea to begin.");
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
document.querySelector("#copy-draft").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(draft.markdown || "");
  const button = event.currentTarget;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = "Copy"; }, 1400);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sessionApiKey) {
    setStatus("Connect your Google AI key before generating a draft.", "error");
    showKeyPanel();
    return;
  }
  submit.disabled = true;
  setStatus("Planning, retrieving relevant notes, and writing your draft. This may take a few minutes.");
  result.classList.add("hidden");
  try {
    const docs = await allDocuments();
    const privateChunks = docs.flatMap((doc) => doc.chunks);
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Google-API-Key": sessionApiKey },
      body: JSON.stringify({ topic: topic.value.trim(), private_chunks: privateChunks }),
    });
    const data = await response.json();
    if (response.status === 401 || response.status === 503) {
      setStatus(data.detail || "Add a Google AI API key to continue.", "error");
      showKeyPanel();
      return;
    }
    if (!response.ok) throw new Error(data.detail || "Could not generate a draft.");
    draft = data;
    document.querySelector("#result-title").textContent = data.title;
    const retrieved = data.private_context_count || 0;
    document.querySelector("#result-meta").textContent = `${(data.mode || "closed_book").replaceAll("_", " ")} mode · ${data.evidence?.length || 0} web sources · ${retrieved} private passages`;
    document.querySelector("#markdown").textContent = data.markdown;
    result.classList.remove("hidden");
    setStatus("Your draft is ready. Review it, then copy or download the Markdown.");
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message || "Could not generate a draft.", "error");
  } finally {
    submit.disabled = false;
  }
});

async function init() {
  updateKeyState();
  try {
    db = await openLibrary();
    await renderLibrary();
  } catch {
    setStatus("This browser could not open local storage. Enable IndexedDB to use your private library.", "error");
  }
  if (!sessionApiKey) {
    showKeyPanel();
    setStatus("Connect a Google AI key for this session to write and index documents.");
  }
}
init();
