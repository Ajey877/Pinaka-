const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const healthBadge = document.querySelector("#healthBadge");
const repositoryInput = document.querySelector("#repository");
const taskInput = document.querySelector("#task");
const planButton = document.querySelector("#planButton");
const formMessage = document.querySelector("#formMessage");
const activityList = document.querySelector("#activityList");
let planResult = document.querySelector("#planResult");
const planCount = document.querySelector("#planCount");
const toolCount = document.querySelector("#toolCount");
const toolList = document.querySelector("#toolList");

const savedTheme = localStorage.getItem("pinaka-theme");
if (savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) {
  root.classList.add("dark");
}

function updateThemeButton() {
  themeToggle.textContent = root.classList.contains("dark") ? "☾" : "☼";
}
updateThemeButton();

themeToggle.addEventListener("click", () => {
  root.classList.toggle("dark");
  localStorage.setItem("pinaka-theme", root.classList.contains("dark") ? "dark" : "light");
  updateThemeButton();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((item) => item.classList.remove("active"));
    chip.classList.add("active");
  });
});

function setHealth(ok, label) {
  healthBadge.className = `status-pill ${ok ? "status-ok" : "status-bad"}`;
  healthBadge.replaceChildren();
  const dot = document.createElement("i");
  const text = document.createElement("span");
  text.textContent = label;
  healthBadge.append(dot, text);
}

function addActivity(title, detail, icon = "•") {
  const item = document.createElement("div");
  item.className = "activity-item";
  const iconNode = document.createElement("div");
  iconNode.className = "activity-icon";
  iconNode.textContent = icon;
  const body = document.createElement("div");
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = title;
  span.textContent = detail;
  body.append(strong, span);
  item.append(iconNode, body);
  activityList.prepend(item);
  while (activityList.children.length > 16) activityList.lastElementChild.remove();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.code = data.code || null;
    throw error;
  }
  return data;
}

function renderTools(tools) {
  toolCount.textContent = String(tools.length);
  toolList.replaceChildren();
  if (tools.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.minHeight = "160px";
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = "No tools reported";
    span.textContent = "The agent runtime did not return a capability list.";
    empty.append(strong, span);
    toolList.appendChild(empty);
    return;
  }

  for (const tool of tools) {
    const item = document.createElement("div");
    item.className = "tool-item";
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = typeof tool?.name === "string" ? tool.name : "Unknown tool";
    span.textContent = typeof tool?.description === "string" ? tool.description : "No description";
    item.append(strong, span);
    toolList.appendChild(item);
  }
}

function renderPlan(plan) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  planCount.textContent = `${stages.length} step${stages.length === 1 ? "" : "s"}`;
  if (stages.length === 0) {
    planResult.className = "empty-state";
    planResult.replaceChildren();
    const icon = document.createElement("div");
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    icon.className = "empty-icon";
    icon.textContent = "✦";
    strong.textContent = "No plan returned";
    span.textContent = "Pinaka could not create a plan for this request.";
    planResult.append(icon, strong, span);
    return;
  }

  const list = document.createElement("div");
  list.className = "plan-list";
  list.id = "planResult";
  stages.forEach((stage, index) => {
    const row = document.createElement("div");
    row.className = "plan-row";
    const number = document.createElement("div");
    const body = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    number.className = "plan-num";
    number.textContent = String(index + 1);
    title.textContent = typeof stage?.name === "string" ? stage.name : `Step ${index + 1}`;
    detail.textContent = typeof stage?.description === "string" ? stage.description : "Planned execution stage.";
    body.append(title, detail);
    row.append(number, body);
    list.appendChild(row);
  });
  planResult.replaceWith(list);
  planResult = list;
}

function renderTaskResult(job) {
  const result = job?.result;
  if (!result) return;

  const verification = result.verification;
  if (verification) {
    const passed = verification.passed === true;
    addActivity(
      passed ? "Verification passed" : "Verification needs attention",
      `${verification.checksRun || 0}/${verification.checksPlanned || 0} checks completed`,
      passed ? "✓" : "!"
    );
  }

  const review = result.finalReview || result.review;
  if (review?.accepted !== undefined || review?.approved !== undefined) {
    const accepted = review.accepted === true || review.approved === true;
    addActivity(
      accepted ? "Final review approved" : "Final review rejected",
      review.verdict?.summary || review.summary || "Review completed",
      accepted ? "✓" : "!"
    );
  }
}

function applyTaskEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = typeof event.type === "string" ? event.type : "task.stage";
  const data = event.data && typeof event.data === "object" ? event.data : {};

  if (type === "tool.start") {
    const tool = typeof data.tool === "string" ? data.tool : "tool";
    addActivity(`Running ${tool}`, "Agent requested a capability.", "↗");
    return event.status;
  }
  if (type === "tool.finish") {
    const tool = typeof data.tool === "string" ? data.tool : "tool";
    const ok = data.ok === true;
    const duration = Number.isFinite(data.durationMs) ? ` · ${data.durationMs} ms` : "";
    addActivity(
      ok ? `Finished ${tool}` : `Failed ${tool}`,
      ok ? `Completed successfully${duration}` : `${data.errorCode || "Execution failed"}${duration}`,
      ok ? "✓" : "!"
    );
    return event.status;
  }
  if (type === "verification.complete") {
    const passed = data.passed === true;
    addActivity(
      passed ? "Verification passed" : "Verification failed",
      `${data.checksRun || 0}/${data.checksPlanned || 0} checks`,
      passed ? "✓" : "!"
    );
    return event.status;
  }
  if (type === "repair.start") {
    addActivity("Repair started", `Attempt ${data.attempt || "?"}`, "↻");
    return event.status;
  }
  if (type === "repair.complete") {
    addActivity("Repair complete", `Attempt ${data.attempt || "?"} · ${data.toolCalls || 0} tool calls`, "✓");
    return event.status;
  }
  if (type === "review.start") {
    addActivity("Final review", "Independent review is evaluating the change.", "⌁");
    return event.status;
  }
  if (type === "review.complete") {
    const accepted = data.accepted === true;
    addActivity(
      accepted ? "Review approved" : "Review rejected",
      `${data.findings || 0} findings · ${data.blockers || 0} blockers`,
      accepted ? "✓" : "!"
    );
    return event.status;
  }

  const stage = typeof event.stage === "string" ? event.stage : "agent";
  const message = typeof event.message === "string" ? event.message : "Working…";
  const icon = ["completed"].includes(event.status) ? "✓" : ["needs_attention", "failed"].includes(event.status) ? "!" : "•";
  addActivity(stage.replaceAll("_", " "), message, icon);
  if (event.status === "completed") formMessage.textContent = "Task completed and verified.";
  if (event.status === "needs_attention") formMessage.textContent = message;
  if (event.status === "failed") formMessage.textContent = message;
  return event.status;
}

async function pollTask(taskId) {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let lastStage = "";

  while (Date.now() - started < timeoutMs) {
    const job = await api(`/v1/agent/tasks/${encodeURIComponent(taskId)}`);
    if (job.stage !== lastStage) {
      lastStage = job.stage;
      applyTaskEvent({ stage: job.stage, message: job.message, status: job.status });
    }

    if (["completed", "needs_attention", "failed"].includes(job.status)) {
      renderTaskResult(job);
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Task polling timed out. Check the task status from the API.");
}

function streamTask(taskId) {
  if (typeof EventSource !== "function") return pollTask(taskId);

  return new Promise((resolve, reject) => {
    const source = new EventSource(`/v1/agent/tasks/${encodeURIComponent(taskId)}/events`);
    let settled = false;

    const finish = async (status) => {
      if (settled) return;
      settled = true;
      source.close();
      try {
        const job = await api(`/v1/agent/tasks/${encodeURIComponent(taskId)}`);
        renderTaskResult(job);
        resolve(job);
      } catch (error) {
        reject(error);
      }
    };

    source.addEventListener("task", (message) => {
      try {
        const event = JSON.parse(message.data);
        const status = applyTaskEvent(event);
        if (["completed", "needs_attention", "failed"].includes(status)) finish(status);
      } catch (error) {
        settled = true;
        source.close();
        reject(error);
      }
    });

    source.onerror = async () => {
      if (settled) return;
      source.close();
      try {
        const job = await api(`/v1/agent/tasks/${encodeURIComponent(taskId)}`);
        if (["completed", "needs_attention", "failed"].includes(job.status)) {
          settled = true;
          renderTaskResult(job);
          resolve(job);
          return;
        }
      } catch {
        // Polling below remains the authoritative fallback.
      }
      pollTask(taskId).then(resolve, reject);
    };
  });
}

async function loadStatus() {
  try {
    const [health, tools] = await Promise.all([api("/health"), api("/v1/tools")]);
    setHealth(health?.status === "ok", health?.status === "ok" ? "Connected" : "Unavailable");
    renderTools(Array.isArray(tools?.tools) ? tools.tools : []);
  } catch (error) {
    setHealth(false, "Offline");
    formMessage.textContent = error.message;
    toolList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.minHeight = "160px";
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = "Backend unavailable";
    span.textContent = "Start the Pinaka agent server to connect this workspace.";
    empty.append(strong, span);
    toolList.appendChild(empty);
  }
}

planButton.addEventListener("click", async () => {
  const task = taskInput.value.trim();
  const repository = repositoryInput.value.trim();
  if (!repository) {
    formMessage.textContent = "Add a GitHub repository URL first.";
    repositoryInput.focus();
    return;
  }
  if (!task) {
    formMessage.textContent = "Describe the task first.";
    taskInput.focus();
    return;
  }

  planButton.disabled = true;
  formMessage.textContent = "Preparing Pinaka…";
  addActivity("Starting task", repository, "↗");

  try {
    const plan = await api("/v1/agent/plan", {
      method: "POST",
      body: JSON.stringify({ task })
    });
    renderPlan(plan);
    addActivity("Plan ready", "Pinaka created the safe first-pass plan.", "✓");

    const job = await api("/v1/agent/run", {
      method: "POST",
      body: JSON.stringify({ repositoryUrl: repository, task })
    });
    addActivity("Agent started", `Task ${job.id} is running in an isolated workspace.`, "●");
    formMessage.textContent = "Pinaka is working live…";
    await streamTask(job.id);
  } catch (error) {
    addActivity("Run failed", error.message, "!");
    formMessage.textContent = error.message;
  } finally {
    planButton.disabled = false;
  }
});

loadStatus();
