export const LOCAL_FIRST = Object.freeze({ enabled: process.env.NODE_ENV !== "production" || process.env.PINAKA_LOCAL_MODE === "1", ownerId: "local-user" });
