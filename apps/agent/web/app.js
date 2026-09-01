const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const healthBadge = document.querySelector("#healthBadge");
const repositoryInput = document.querySelector("#repository");
const taskInput = document.querySelector("#task");
const planButton = document.querySelector("#planButton");
const formMessage = document.querySelector("#formMessage");
const activityList = document.querySelector("#activityList");
const planResult = document.querySelector("#planResult");
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
  healthBadge.innerHTML = `<i></i><span>${label}</span>`;
}

function addActivity(title, detail, icon = "•") {
  const item = document.createElement("div");
  item.className = "activity-item";
  item.innerHTML = `<div class="activity-icon">${icon}</div><div><strong></strong><span></span></div>`;
  item.querySelector("strong").textContent = title;
  item.querySelector("span").textContent = detail;
  activityList.prepend(item);
  while (activityList.children.length > 5) activityList.lastElementChild.remove();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function renderTools(tools) {
  toolCount.textContent = String(tools.length);
  toolList.replaceChildren();
  if (tools.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.minHeight = "160px";
    empty.innerHTML = `<strong>No tools reported</strong><span>The agent runtime did not return a capability list.</span>`;
    toolList.appendChild(empty);
    return;
  }

  for (const tool of tools) {
    const item = document.createElement("div");
    item.className = "tool-item";
    const name = typeof tool?.name === "string" ? tool.name : "Unknown tool";
    const description = typeof tool?.description === "string" ? tool.description : "No description";
    item.innerHTML = "<strong></strong><span></span>";
    item.querySelector("strong").textContent = name;
    item.querySelector("span").textContent = description;
    toolList.appendChild(item);
  }
}

function renderPlan(plan) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  planCount.textContent = `${stages.length} step${stages.length === 1 ? "" : "s"}`;
  if (stages.length === 0) {
    planResult.className = "empty-state";
    planResult.innerHTML = "<div class=\"empty-icon\">✦</div><strong>No plan returned</strong><span>Pinaka could not create a plan for this request.</span>";
    return;
  }

  const list = document.createElement("div");
  list.className = "plan-list";
  stages.forEach((stage, index) => {
    const row = document.createElement("div");
    row.className = "plan-row";
    const title = typeof stage?.name === "string" ? stage.name : `Step ${index + 1}`;
    const detail = typeof stage?.description === "string" ? stage.description : "Planned execution stage.";
    row.innerHTML = `<div class="plan-num">${index + 1}</div><div><strong></strong><span></span></div>`;
    row.querySelector("strong").textContent = title;
    row.querySelector("span").textContent = detail;
    list.appendChild(row);
  });
  planResult.replaceWith(list);
  list.id = "planResult";
  planResult = list;
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
    empty.innerHTML = "<strong>Backend unavailable</strong><span>Start the Pinaka agent server to connect this workspace.</span>";
    toolList.appendChild(empty);
  }
}

planButton.addEventListener("click", async () => {
  const task = taskInput.value.trim();
  const repository = repositoryInput.value.trim();
  if (!task) {
    formMessage.textContent = "Describe the task first.";
    taskInput.focus();
    return;
  }

  planButton.disabled = true;
  formMessage.textContent = "Creating a safe first-pass plan…";
  addActivity("Planning task", repository ? `Repository: ${repository}` : "No repository URL supplied", "↗");

  try {
    const payload = await api("/v1/agent/plan", {
      method: "POST",
      body: JSON.stringify({ task })
    });
    renderPlan(payload);
    addActivity("Plan ready", "Pinaka created the initial execution stages.", "✓");
    formMessage.textContent = "Plan generated. Full repository execution will be enabled by the agent runtime in the next UI phase.";
  } catch (error) {
    addActivity("Plan failed", error.message, "!");
    formMessage.textContent = error.message;
  } finally {
    planButton.disabled = false;
  }
});

loadStatus();
