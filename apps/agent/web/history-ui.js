const historyHost = document.querySelector("#historyHost");
if (!historyHost) throw new Error("Pinaka history UI requires #historyHost");

const style = document.createElement("style");
style.textContent = `.history-card{margin-top:18px}.history-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}.history-search{width:min(280px,60%);border:1px solid var(--hairline);border-radius:14px;padding:10px 12px;background:var(--card-strong);color:var(--text);font:inherit}.history-list{display:grid;gap:8px}.history-row{width:100%;text-align:left;border:1px solid var(--hairline);border-radius:15px;padding:12px;background:var(--card-strong);color:var(--text);font:inherit;cursor:pointer}.history-row:hover{transform:translateY(-1px)}.history-main{min-width:0}.history-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;color:var(--muted);font-size:11px}.history-pill{padding:4px 7px;border-radius:999px;background:var(--chip);font-size:10px;font-weight:700}.history-empty{padding:20px;text-align:center;color:var(--muted);border:1px dashed var(--hairline);border-radius:15px}.history-detail{margin-top:10px;padding:14px;border:1px solid var(--hairline);border-radius:15px;background:var(--card-strong)}.history-detail pre{max-height:280px;overflow:auto;white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:640px){.history-toolbar{align-items:stretch;flex-direction:column}.history-search{width:100%}}`;
document.head.appendChild(style);

const card = document.createElement("section");
card.className = "card glass history-card";
const heading = document.createElement("div");
heading.className = "card-heading compact";
const left = document.createElement("div");
const kicker = document.createElement("span");
kicker.className = "section-kicker";
kicker.textContent = "HISTORY";
const title = document.createElement("h2");
title.textContent = "Task history";
left.append(kicker, title);
const count = document.createElement("span");
count.className = "mini-badge";
count.textContent = "0 tasks";
heading.append(left, count);
const toolbar = document.createElement("div");
toolbar.className = "history-toolbar";
const subtitle = document.createElement("span");
subtitle.className = "muted";
subtitle.textContent = "Your recent agent work.";
const search = document.createElement("input");
search.className = "history-search";
search.type = "search";
search.placeholder = "Search tasks…";
search.autocomplete = "off";
toolbar.append(subtitle, search);
const list = document.createElement("div");
list.className = "history-list";
card.append(heading, toolbar, list);
historyHost.appendChild(card);

let tasks = [];

function statusLabel(task) {
  if (task?.approval?.status === "pending") return "Awaiting approval";
  if (task?.approval?.status === "approved") return "Approved";
  if (task?.approval?.status === "rejected") return "Rejected";
  if (task?.status === "completed") return "Completed";
  if (task?.status === "needs_attention") return "Needs attention";
  if (task?.status === "failed") return "Failed";
  return task?.status || "Unknown";
}

function detailFor(task) {
  const detail = document.createElement("div");
  detail.className = "history-detail";
  const summary = document.createElement("div");
  summary.className = "history-meta";
  summary.textContent = `${task.repositoryUrl || ""} · ${statusLabel(task)}`;
  const pre = document.createElement("pre");
  const parts = [];
  if (task.result?.verification) parts.push(`Verification: ${task.result.verification.passed === true ? "passed" : "needs attention"}`);
  const review = task.result?.finalReview || task.result?.review;
  if (review) parts.push(`Review: ${review.accepted === true || review.approved === true ? "approved" : "rejected"}`);
  if (task.approval?.branch) parts.push(`Branch: ${task.approval.branch}`);
  if (task.approval?.commit) parts.push(`Commit: ${task.approval.commit}`);
  if (task.approval?.pullRequest?.url) parts.push(`Pull request: ${task.approval.pullRequest.url}`);
  if (task.result?.diff?.text) parts.push(`\n${task.result.diff.text}`);
  pre.textContent = parts.join("\n") || "No retained result details.";
  detail.append(summary, pre);
  return detail;
}

function render() {
  const needle = search.value.trim().toLowerCase();
  const filtered = tasks.filter((task) => `${task.task || ""} ${task.repositoryUrl || ""} ${statusLabel(task)}`.toLowerCase().includes(needle));
  count.textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = needle ? "No matching tasks." : "No task history yet.";
    list.appendChild(empty);
    return;
  }
  for (const task of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "history-row";
    const main = document.createElement("div");
    main.className = "history-main";
    const strong = document.createElement("strong");
    strong.textContent = task.task || "Untitled task";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const pill = document.createElement("span");
    pill.className = "history-pill";
    pill.textContent = statusLabel(task);
    const repo = document.createElement("span");
    repo.textContent = task.repositoryUrl || "";
    const time = document.createElement("span");
    time.textContent = task.updatedAt ? new Date(task.updatedAt).toLocaleString() : "";
    meta.append(pill, repo, time);
    main.append(strong, meta);
    row.appendChild(main);
    row.addEventListener("click", () => {
      const detail = row.nextElementSibling;
      if (detail?.classList.contains("history-detail")) detail.remove();
      else row.insertAdjacentElement("afterend", detailFor(task));
    });
    list.appendChild(row);
  }
}

async function refresh() {
  try {
    const response = await fetch("/v1/agent/tasks", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    render();
  } catch {
    // History is optional; keep the main workspace usable.
  }
}

search.addEventListener("input", render);
refresh();
setInterval(refresh, 5000);
