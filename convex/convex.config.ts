import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    APP_BASE_URL: v.string(),
    RESEND_API_KEY: v.string(),
    RESEND_FROM_EMAIL: v.string(),
    ENABLE_DEMO_LOGIN: v.optional(v.string()),
  },
});
