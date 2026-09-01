const MAX_TASK_LENGTH = 10_000;

const STAGES = Object.freeze([
  "inspect_repository",
  "understand_task",
  "plan_changes",
  "implement",
  "verify",
  "review"
]);

export function normalizeTask(input) {
  if (typeof input !== "string") {
    throw new TypeError("task must be a string");
  }

  const task = input.trim();
  if (!task) {
    throw new Error("task cannot be empty");
  }
  if (task.length > MAX_TASK_LENGTH) {
    throw new Error(`task exceeds ${MAX_TASK_LENGTH} characters`);
  }

  return task;
}

export function createPlan(task) {
  const normalizedTask = normalizeTask(task);

  return {
    task: normalizedTask,
    stages: STAGES.map((name, index) => ({
      id: index + 1,
      name,
      status: "pending"
    })),
    rules: [
      "Inspect before modifying.",
      "Prefer the smallest safe change.",
      "Never claim verification passed unless it actually ran.",
      "Do not modify unrelated files."
    ]
  };
}

export function getHealth() {
  return {
    service: "pinaka-agent",
    status: "ok",
    version: "0.1.0"
  };
}
