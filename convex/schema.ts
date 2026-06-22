import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const accountRole = v.union(
  v.literal("admin"),
  v.literal("company"),
  v.literal("attendee"),
);

const requestStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("countered"),
  v.literal("cancelled"),
);

const requestOrigin = v.union(
  v.literal("attendee_request"),
  v.literal("desk_queue"),
  v.literal("admin_match"),
);

const meetingStatus = v.union(
  v.literal("confirmed"),
  v.literal("completed"),
  v.literal("no_show"),
  v.literal("cancelled"),
);

const deskMatchStatus = v.union(
  v.literal("requested"),
  v.literal("matched"),
  v.literal("closed"),
  v.literal("cancelled"),
);

export default defineSchema({
  eventSettings: defineTable({
    key: v.string(),
    eventName: v.string(),
    roomName: v.string(),
    timezone: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    dayStartMinute: v.number(),
    dayEndMinute: v.number(),
    slotMinutes: v.number(),
    activeTables: v.number(),
    reserveTables: v.number(),
    attendeeRequestCapPerDay: v.number(),
    companyAcceptCapPerDay: v.number(),
    allowCounters: v.boolean(),
    sponsorsOnlyDefault: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  companies: defineTable({
    name: v.string(),
    slug: v.string(),
    tier: v.string(),
    description: v.string(),
    contactEmail: v.string(),
    hostNames: v.array(v.string()),
    topics: v.array(v.string()),
    wantsToMeet: v.array(v.string()),
    sponsor: v.boolean(),
    optedIn: v.boolean(),
    priority: v.number(),
    notes: v.string(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_optedIn", ["optedIn"])
    .index("by_sponsor_and_optedIn", ["sponsor", "optedIn"]),

  accounts: defineTable({
    email: v.string(),
    displayName: v.string(),
    role: accountRole,
    title: v.string(),
    companyId: v.optional(v.id("companies")),
    track: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_companyId", ["companyId"]),

  demoSessions: defineTable({
    token: v.string(),
    accountId: v.id("accounts"),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_accountId", ["accountId"]),

  availability: defineTable({
    companyId: v.id("companies"),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    note: v.string(),
    updatedAt: v.number(),
  })
    .index("by_companyId_and_date", ["companyId", "date"])
    .index("by_date", ["date"]),

  meetingRequests: defineTable({
    attendeeAccountId: v.id("accounts"),
    companyId: v.id("companies"),
    date: v.string(),
    preferredStartMinute: v.number(),
    alternateStartMinute: v.optional(v.number()),
    reason: v.string(),
    context: v.string(),
    status: requestStatus,
    counterStartMinute: v.optional(v.number()),
    responseNote: v.optional(v.string()),
    respondedByAccountId: v.optional(v.id("accounts")),
    meetingId: v.optional(v.id("meetings")),
    origin: v.optional(requestOrigin),
    createdByAccountId: v.optional(v.id("accounts")),
    adminNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_attendeeAccountId_and_date", ["attendeeAccountId", "date"])
    .index("by_attendeeAccountId_and_companyId_and_date", [
      "attendeeAccountId",
      "companyId",
      "date",
    ])
    .index("by_companyId_and_status", ["companyId", "status"])
    .index("by_companyId_and_date", ["companyId", "date"])
    .index("by_status", ["status"])
    .index("by_date_and_status", ["date", "status"]),

  meetings: defineTable({
    requestId: v.id("meetingRequests"),
    attendeeAccountId: v.id("accounts"),
    companyId: v.id("companies"),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    tableNumber: v.number(),
    status: meetingStatus,
    context: v.string(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_and_startMinute", ["date", "startMinute"])
    .index("by_date_and_tableNumber", ["date", "tableNumber"])
    .index("by_companyId_and_date", ["companyId", "date"])
    .index("by_companyId_and_date_and_startMinute", [
      "companyId",
      "date",
      "startMinute",
    ])
    .index("by_attendeeAccountId_and_date", ["attendeeAccountId", "date"])
    .index("by_attendeeAccountId_and_date_and_startMinute", [
      "attendeeAccountId",
      "date",
      "startMinute",
    ])
    .index("by_status", ["status"]),

  deskMatchRequests: defineTable({
    attendeeAccountId: v.id("accounts"),
    date: v.string(),
    preferredStartMinute: v.number(),
    intent: v.string(),
    topics: v.array(v.string()),
    status: deskMatchStatus,
    suggestedCompanyId: v.optional(v.id("companies")),
    meetingRequestId: v.optional(v.id("meetingRequests")),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_attendeeAccountId", ["attendeeAccountId"])
    .index("by_date_and_status", ["date", "status"]),

  importBatches: defineTable({
    importedByAccountId: v.id("accounts"),
    kind: v.string(),
    rowCount: v.number(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("by_kind", ["kind"]),
});
