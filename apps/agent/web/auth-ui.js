const authArea = document.querySelector("#authArea");
if (!authArea) throw new Error("Pinaka auth UI requires #authArea");

const style = document.createElement("style");
style.textContent = `.auth-area{display:flex;align-items:center;gap:8px}.github-button,.auth-user,.auth-logout,.local-mode{border:1px solid var(--hairline);border-radius:14px;background:var(--card-strong);color:var(--text);font:inherit;font-weight:700}.github-button{padding:9px 13px;text-decoration:none}.auth-user{display:flex;align-items:center;gap:8px;padding:5px 9px}.auth-user img{width:24px;height:24px;border-radius:50%;object-fit:cover}.auth-user span{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.auth-logout{padding:8px 10px;cursor:pointer}.local-mode{padding:9px 12px}.github-button:hover,.auth-logout:hover{transform:translateY(-1px)}@media(max-width:640px){.auth-user span{display:none}.github-button{padding:8px 10px}.auth-logout{padding:8px}.local-mode{padding:8px 10px}}`;
document.head.appendChild(style);

function showSignedOut() {
  authArea.replaceChildren();
  const link = document.createElement("a");
  link.className = "github-button";
  link.href = "/auth/github";
  link.textContent = "Sign in with GitHub";
  authArea.appendChild(link);
}

function showLocalMode() {
  authArea.replaceChildren();
  const badge = document.createElement("span");
  badge.className = "local-mode";
  badge.textContent = "Local mode";
  authArea.appendChild(badge);
}

function showSignedIn(user) {
  authArea.replaceChildren();
  const userBadge = document.createElement("div");
  userBadge.className = "auth-user";
  if (typeof user?.avatarUrl === "string" && user.avatarUrl) {
    const image = document.createElement("img");
    image.src = user.avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    userBadge.appendChild(image);
  }
  const name = document.createElement("span");
  name.textContent = user?.name || user?.login || "GitHub user";
  userBadge.appendChild(name);
  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "auth-logout";
  logout.textContent = "Sign out";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await fetch("/v1/auth/logout", { method: "POST" });
      showSignedOut();
    } finally {
      logout.disabled = false;
    }
  });
  authArea.append(userBadge, logout);
}

async function loadAuth() {
  try {
    const response = await fetch("/v1/auth/me", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (data.localMode === true && data.authenticated === false) showLocalMode();
    else if (response.ok && data.authenticated === true) showSignedIn(data.user);
    else if (data.localMode === true) showLocalMode();
    else showSignedOut();
  } catch {
    showSignedOut();
  }
}

loadAuth();
