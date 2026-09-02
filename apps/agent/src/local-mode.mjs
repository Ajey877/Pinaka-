export const LOCAL_USER_ID = "local-user";

export function isLocalMode(env = process.env) {
  return env.PINAKA_LOCAL_MODE === "1" || env.NODE_ENV !== "production";
}

export function localSession() {
  return {
    id: LOCAL_USER_ID,
    user: {
      id: LOCAL_USER_ID,
      login: "local",
      name: "Local workspace",
      avatarUrl: null
    },
    githubToken: "",
    csrfToken: null,
    local: true
  };
}
