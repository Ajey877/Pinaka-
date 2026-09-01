const diffViewer = document.querySelector("#diffViewer");
if (!diffViewer) throw new Error("Pinaka approval UI requires the diff viewer");

const card = document.createElement("section");
card.className = "card glass approval-card";
const heading = document.createElement("div");
heading.className = "card-heading compact";
const left = document.createElement("div");
const kicker = document.createElement("span");
kicker.className = "section-kicker";
kicker.textContent = "APPROVAL";
const title = document.createElement("h2");
title.textContent = "Your decision";
left.append(kicker, title);
const state = document.createElement("span");
state.className = "mini-badge";
state.textContent = "Waiting";
heading.append(left, state);
const summary = document.createElement("p");
summary.className = "approval-summary";
const actions = document.createElement("div");
actions.className = "approval-actions";
const reject = document.createElement("button");
reject.className = "secondary-button";
reject.type = "button";
reject.textContent = "Reject & discard";
const approve = document.createElement("button");
approve.className = "primary-button";
approve.type = "button";
approve.textContent = "Approve & commit";
actions.append(reject, approve);
card.append(heading, summary, actions);
diffViewer.parentElement.parentElement.appendChild(card);

const style = document.createElement("style");
style.textContent = `.approval-card{margin-top:18px}.approval-summary{margin:0;color:var(--muted);font-size:12px;line-height:1.5}.approval-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.secondary-button{border:1px solid var(--hairline);border-radius:15px;padding:12px 15px;background:var(--card-strong);color:var(--text);font-weight:700}.approval-card .primary-button,.approval-card .secondary-button{min-width:150px}@media(max-width:640px){.approval-actions{flex-direction:column}.approval-card .primary-button,.approval-card .secondary-button{width:100%}}`;
document.head.appendChild(style);
card.hidden = true;

function show(job) {
  const approval = job?.approval;
  card.hidden = false;
  const pending = approval?.status === "pending";
  approve.disabled = !pending;
  reject.disabled = !pending;
  if (pending) {
    state.textContent = "Awaiting approval";
    summary.textContent = "Pinaka finished the verified change. Review the diff above before approving.";
  } else if (approval?.status === "approved") {
    state.textContent = "Approved";
    summary.textContent = approval.commit ? `Committed on ${approval.branch} · ${approval.commit.slice(0, 12)}. Nothing was pushed automatically.` : "Changes approved. Nothing was pushed automatically.";
  } else if (approval?.status === "rejected") {
    state.textContent = "Rejected";
    summary.textContent = "The proposed change was rejected. No changes were published.";
  } else {
    state.textContent = "No action";
    summary.textContent = "Approval is available only after a completed, accepted review.";
  }
}

async function getTasks() {
  const response = await fetch("/v1/agent/tasks", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Unable to load tasks");
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function decide(decision, taskId) {
  approve.disabled = true;
  reject.disabled = true;
  state.textContent = decision === "approve" ? "Committing…" : "Rejecting…";
  const response = await fetch(`/v1/agent/tasks/${encodeURIComponent(taskId)}/approval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Approval decision failed");
  show(payload);
}

async function refresh() {
  try {
    const tasks = await getTasks();
    const candidate = [...tasks].reverse().find((job) => job?.approval?.status === "pending" || ["approved", "rejected"].includes(job?.approval?.status));
    if (candidate) show(candidate);
  } catch {
    // Main application remains usable if the approval panel cannot refresh.
  }
}

async function handle(decision) {
  try {
    const tasks = await getTasks();
    const pending = [...tasks].reverse().find((job) => job?.approval?.status === "pending");
    if (!pending) throw new Error("No task is waiting for approval");
    await decide(decision, pending.id);
  } catch (error) {
    state.textContent = "Error";
    summary.textContent = error.message;
    approve.disabled = false;
    reject.disabled = false;
  }
}

approve.addEventListener("click", () => handle("approve"));
reject.addEventListener("click", () => handle("reject"));
refresh();
setInterval(refresh, 2_000);
