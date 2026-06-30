import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const accountRole = v.union(v.literal("admin"), v.literal("participant"));

const ticketCategory = v.union(
  v.literal("leadership"),
  v.literal("speaker"),
  v.literal("sponsor"),
  v.literal("other"),
);

const requestStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("countered"),
  v.literal("cancelled"),
);

const meetingStatus = v.union(
  v.literal("confirmed"),
  v.literal("completed"),
  v.literal("no_show"),
  v.literal("cancelled"),
);

const meetingParticipantRole = v.union(
  v.literal("host"),
  v.literal("requester"),
);

const profileSource = v.object({
  label: v.string(),
  note: v.string(),
  url: v.string(),
});

export default defineSchema({
  eventSettings: defineTable({
    key: v.string(),
    schemaVersion: v.number(),
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
    outgoingRequestCapPerDay: v.number(),
    maxMeetingGroupSize: v.number(),
    allowCounters: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  accounts: defineTable({
    email: v.string(),
    displayName: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    role: accountRole,
    title: v.string(),
    company: v.string(),
    ticketType: v.string(),
    ticketCategory,
    registrationStatus: v.string(),
    profileImageUrl: v.string(),
    city: v.string(),
    country: v.string(),
    companySize: v.string(),
    networkingIntent: v.string(),
    topics: v.array(v.string()),
    signedUp: v.boolean(),
    directoryOptIn: v.boolean(),
    profileComplete: v.boolean(),
    hasAvailability: v.optional(v.boolean()),
    active: v.boolean(),
    rawImportJson: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_signedUp_and_directoryOptIn", ["signedUp", "directoryOptIn"])
    .index("by_ticketCategory", ["ticketCategory"]),

  participantProfileOverrides: defineTable({
    accountId: v.id("accounts"),
    headline: v.string(),
    bioMarkdown: v.string(),
    tags: v.array(v.string()),
    sources: v.optional(v.object({
      primary: v.array(profileSource),
      secondary: v.array(profileSource),
    })),
    participantApproved: v.boolean(),
    approvedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_accountId", ["accountId"]),

  demoSessions: defineTable({
    token: v.string(),
    accountId: v.id("accounts"),
    source: v.optional(v.union(v.literal("magic_link"), v.literal("demo"))),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_accountId", ["accountId"]),

  magicLoginTokens: defineTable({
    tokenHash: v.string(),
    accountId: v.id("accounts"),
    email: v.string(),
    redirectPath: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_accountId", ["accountId"])
    .index("by_email_and_createdAt", ["email", "createdAt"]),

  participantAvailability: defineTable({
    accountId: v.id("accounts"),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    available: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_accountId_and_date", ["accountId", "date"])
    .index("by_accountId_and_date_and_startMinute", [
      "accountId",
      "date",
      "startMinute",
    ])
    .index("by_date_and_startMinute", ["date", "startMinute"]),

  meetingRequests: defineTable({
    requesterAccountId: v.id("accounts"),
    targetAccountId: v.id("accounts"),
    date: v.string(),
    preferredStartMinute: v.number(),
    alternateStartMinute: v.optional(v.number()),
    counterStartMinute: v.optional(v.number()),
    reason: v.string(),
    context: v.string(),
    status: requestStatus,
    responseNote: v.optional(v.string()),
    respondedByAccountId: v.optional(v.id("accounts")),
    meetingId: v.optional(v.id("meetings")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requesterAccountId_and_date", ["requesterAccountId", "date"])
    .index("by_targetAccountId_and_date", ["targetAccountId", "date"])
    .index("by_targetAccountId_and_status", ["targetAccountId", "status"])
    .index("by_date_and_status", ["date", "status"])
    .index("by_meetingId", ["meetingId"]),

  meetingInterests: defineTable({
    requesterAccountId: v.id("accounts"),
    targetAccountId: v.id("accounts"),
    reason: v.string(),
    context: v.string(),
    status: requestStatus,
    responseNote: v.optional(v.string()),
    respondedByAccountId: v.optional(v.id("accounts")),
    meetingId: v.optional(v.id("meetings")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requesterAccountId", ["requesterAccountId"])
    .index("by_targetAccountId", ["targetAccountId"])
    .index("by_targetAccountId_and_status", ["targetAccountId", "status"])
    .index("by_meetingId", ["meetingId"]),

  meetings: defineTable({
    hostAccountId: v.id("accounts"),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    tableNumber: v.number(),
    participantCount: v.number(),
    status: meetingStatus,
    context: v.string(),
    createdFromRequestId: v.optional(v.id("meetingRequests")),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_and_startMinute", ["date", "startMinute"])
    .index("by_date_and_startMinute_and_tableNumber", [
      "date",
      "startMinute",
      "tableNumber",
    ])
    .index("by_hostAccountId_and_date", ["hostAccountId", "date"])
    .index("by_status", ["status"]),

  meetingParticipants: defineTable({
    meetingId: v.id("meetings"),
    accountId: v.id("accounts"),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    role: meetingParticipantRole,
    requestId: v.optional(v.id("meetingRequests")),
    status: meetingStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meetingId", ["meetingId"])
    .index("by_accountId_and_date", ["accountId", "date"])
    .index("by_accountId_and_date_and_startMinute", [
      "accountId",
      "date",
      "startMinute",
    ])
    .index("by_date_and_startMinute", ["date", "startMinute"]),

  meetingMessages: defineTable({
    meetingId: v.id("meetings"),
    senderAccountId: v.id("accounts"),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_meetingId", ["meetingId"]),

  importBatches: defineTable({
    importedByAccountId: v.id("accounts"),
    kind: v.string(),
    rowCount: v.number(),
    inserted: v.number(),
    updated: v.number(),
    duplicateRows: v.number(),
    missingEmailRows: v.number(),
    missingCompanyRows: v.number(),
    missingTitleRows: v.number(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("by_kind", ["kind"]),
});
