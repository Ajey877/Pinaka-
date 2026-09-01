const TERMINAL = new Set(["completed", "needs_attention", "failed", "approved", "rejected"]);

export function canRequestApproval(job) {
  return job?.status === "completed" && job?.result?.status === "accepted";
}

export function canDecideApproval(job, approval) {
  if (!canRequestApproval(job)) return false;
  return approval === "approve" || approval === "reject";
}

export function nextApprovalStatus(approval) {
  if (approval === "approve") return "approved";
  if (approval === "reject") return "rejected";
  throw new Error("approval must be approve or reject");
}

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}
