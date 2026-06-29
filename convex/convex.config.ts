import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    APP_BASE_URL: v.string(),
    // Outbound email is relayed through the AI Engineer Cloudflare app
    // (POST /api/email/send), e.g. https://scheduler.aieconf.com/api/email/send,
    // authenticated with the shared EMAIL_RELAY_SECRET.
    EMAIL_RELAY_URL: v.string(),
    EMAIL_RELAY_SECRET: v.string(),
    ENABLE_DEMO_LOGIN: v.optional(v.string()),
  },
});
