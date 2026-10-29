const form = document.querySelector("#form");
const topic = document.querySelector("#topic");
const submit = document.querySelector("#submit");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
let draft = {};

document.querySelector("#year").textContent = new Date().getFullYear();
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.className = "status";
  status.textContent = "Planning, researching, and writing your first draft… This can take a few minutes.";
  result.classList.add("hidden");
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.value.trim() }),
    });
    const data = await response.json();
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
