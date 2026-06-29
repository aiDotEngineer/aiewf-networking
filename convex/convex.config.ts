import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    APP_BASE_URL: v.string(),
    EMAIL_RELAY_URL: v.string(),
    EMAIL_RELAY_SECRET: v.string(),
    EMAIL_RELAY_FROM: v.optional(v.string()),
    ENABLE_DEMO_LOGIN: v.optional(v.string()),
  },
});
