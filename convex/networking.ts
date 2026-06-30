import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  env,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildMagicLinkUrl,
  hashLoginToken,
  normalizeLoginEmail,
  safeRedirectPath,
} from "./authHelpers";

const SETTINGS_KEY = "default";
const EVENT_DATES = ["2026-06-30", "2026-07-01"];
const DEMO_SCHEMA_VERSION = 3;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const MAGIC_LINK_TTL_MS = 1000 * 60 * 15;
const MAGIC_LINK_HASH_SALT = "aiewf-networking-magic-link-v1";
const MAX_IMPORT_ROWS = 2000;
const ADMIN_PARTICIPANT_LIMIT = 120;
const ACTIVE_REQUEST_STATUSES = new Set(["pending", "countered", "accepted"]);
const MISSING_VALUES = new Set(["", "n/a", "na", "none", "null"]);
const ADMIN_EMAILS = new Set([
  "phlo@ai.engineer",
  "adlin@ai.engineer",
  "lia@ai.engineer",
  "swyx@ai.engineer",
  "sherry@peek.money",
  "sherry@65labs.org",
  "agrim@65labs.org",
]);

const meetingStatusValidator = v.union(
  v.literal("confirmed"),
  v.literal("completed"),
  v.literal("no_show"),
  v.literal("cancelled"),
);

type Actor = Doc<"accounts">;
type Settings = Doc<"eventSettings">;
type SheetRow = Record<string, string>;
type ParticipantProfileOverride = Doc<"participantProfileOverrides">;

function now() {
  return Date.now();
}

function normalizeEmail(email: string | undefined) {
  return cleanSheetValue(email).toLowerCase();
}

function cleanSheetValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return MISSING_VALUES.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function coalesceSheetValue(...values: Array<string | undefined>) {
  for (const value of values) {
    const cleaned = cleanSheetValue(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function splitList(value: string | undefined) {
  return value?.split(/[;,]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function splitProfileSources(value: string | undefined) {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((line) => {
      const [label = "", url = "", ...noteParts] = line.split("|").map((part) => part.trim());
      return {
        label: label.slice(0, 120),
        url: url.slice(0, 500),
        note: noteParts.join(" | ").slice(0, 500),
      };
    })
    .filter((source) => source.label && source.url);
}

function tokenValue() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function secureTokenValue(bytes = 32) {
  const randomBytes = new Uint8Array(bytes);
  crypto.getRandomValues(randomBytes);
  let binary = "";
  for (const byte of randomBytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function demoLoginEnabled() {
  return env.ENABLE_DEMO_LOGIN === "1" || env.ENABLE_DEMO_LOGIN === "true";
}

function minuteLabel(minute: number) {
  const hour = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

function validatePositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function validateMinuteOfDay(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 24 * 60) {
    throw new Error(`${name} must be an integer minute between 0 and 1440.`);
  }
}

function ticketCategory(ticketType: string) {
  const normalized = ticketType.toLowerCase();
  if (normalized.includes("speaker")) return "speaker" as const;
  if (normalized.includes("sponsor")) return "sponsor" as const;
  if (normalized.includes("leadership")) return "leadership" as const;
  return "other" as const;
}

function normalizeParticipantRow(row: SheetRow) {
  const firstName = coalesceSheetValue(
    row["First Name"],
    row["Holder First Name"],
    row["Buyer First Name"],
  );
  const lastName = coalesceSheetValue(
    row["Last Name"],
    row["Holder Last Name"],
    row["Buyer Last Name"],
  );
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const company = coalesceSheetValue(row.Company, row["Holder Company Name"]);
  const title = coalesceSheetValue(row.Title, row["Holder Job Title"]);
  const ticketType = cleanSheetValue(row["Ticket Type"]);

  return {
    email:
      normalizeEmail(row["Holder Email"]) ||
      normalizeEmail(row.Email) ||
      normalizeEmail(row["Buyer Email"]),
    displayName,
    firstName,
    lastName,
    company,
    title,
    ticketType,
    ticketCategory: ticketCategory(ticketType),
    registrationStatus: cleanSheetValue(row["Registration Status"]),
    profileImageUrl: cleanSheetValue(row["Profile Picture"]),
    city: cleanSheetValue(row["Holder City"]),
    country: cleanSheetValue(row["Holder Country"]),
    companySize: cleanSheetValue(row["Holder Company Size"]),
    profileComplete: Boolean(displayName && company && title),
  };
}

function profileOverrideSummary(override: ParticipantProfileOverride | null | undefined) {
  if (!override) return null;
  return {
    headline: override.headline,
    bioMarkdown: override.bioMarkdown,
    tags: override.tags,
    sources: override.sources,
    participantApproved: override.participantApproved,
    approvedAt: override.approvedAt,
    updatedAt: override.updatedAt,
  };
}

function accountSummary(
  account: Doc<"accounts"> | null,
  override?: ParticipantProfileOverride | null,
) {
  if (!account) return null;
  return {
    _id: account._id,
    email: account.email,
    displayName: account.displayName,
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    title: account.title,
    company: account.company,
    ticketType: account.ticketType,
    ticketCategory: account.ticketCategory,
    registrationStatus: account.registrationStatus,
    profileImageUrl: account.profileImageUrl,
    city: account.city,
    country: account.country,
    companySize: account.companySize,
    networkingIntent: account.networkingIntent,
    topics: account.topics,
    signedUp: account.signedUp,
    directoryOptIn: account.directoryOptIn,
    profileComplete: account.profileComplete,
    hasAvailability: account.hasAvailability ?? false,
    active: account.active,
    profileOverride: profileOverrideSummary(override),
  };
}

async function getProfileOverride(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">) {
  return await ctx.db
    .query("participantProfileOverrides")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .unique();
}

async function getProfileOverrideMap(
  ctx: QueryCtx | MutationCtx,
  accountIds: Array<Id<"accounts">>,
) {
  if (accountIds.length === 0) return new Map<Id<"accounts">, ParticipantProfileOverride>();
  const wanted = new Set(accountIds);
  const rows = await ctx.db.query("participantProfileOverrides").take(1800);
  return new Map(
    rows
      .filter((row) => wanted.has(row.accountId))
      .map((row) => [row.accountId, row] as const),
  );
}

async function upsertProfileOverride(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  fields: {
    headline: string;
    bioMarkdown: string;
    tags: string[];
    sources?: {
      primary: Array<{ label: string; note: string; url: string }>;
      secondary: Array<{ label: string; note: string; url: string }>;
    };
    participantApproved: boolean;
  },
) {
  const timestamp = now();
  const existing = await getProfileOverride(ctx, accountId);
  const patch = {
    accountId,
    headline: fields.headline,
    bioMarkdown: fields.bioMarkdown,
    tags: fields.tags,
    participantApproved: fields.participantApproved,
    updatedAt: timestamp,
  };
  const patchWithSources = fields.sources ? { ...patch, sources: fields.sources } : patch;
  const nextFields = fields.participantApproved
    ? { ...patchWithSources, approvedAt: existing?.approvedAt ?? timestamp }
    : patchWithSources;
  if (existing) {
    await ctx.db.patch(existing._id, nextFields);
  } else {
    await ctx.db.insert("participantProfileOverrides", nextFields);
  }
}

async function getSettings(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("eventSettings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
}

async function requireSettings(ctx: QueryCtx | MutationCtx) {
  const settings = await getSettings(ctx);
  if (!settings) throw new Error("Event settings are not initialized.");
  return settings;
}

async function getActorForSession(ctx: QueryCtx | MutationCtx, sessionToken: string) {
  const session = await ctx.db
    .query("demoSessions")
    .withIndex("by_token", (q) => q.eq("token", sessionToken))
    .unique();
  if (!session || session.expiresAt < now()) return null;
  const actor = await ctx.db.get(session.accountId);
  if (!actor || !actor.active) return null;
  return actor;
}

async function requireActor(ctx: QueryCtx | MutationCtx, sessionToken: string) {
  const actor = await getActorForSession(ctx, sessionToken);
  if (!actor) throw new Error("Session expired. Sign in again.");
  return actor;
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Error("Admin access required.");
}

function requireParticipant(actor: Actor) {
  if (actor.role !== "participant") throw new Error("Participant account required.");
  if (!actor.signedUp || !actor.profileComplete) {
    throw new Error("Confirm your profile before booking meetings.");
  }
}

function assertValidEventDate(date: string) {
  if (!EVENT_DATES.includes(date)) throw new Error("Date is outside the event window.");
}

function assertSlotInDay(settings: Settings, startMinute: number) {
  if (
    !Number.isInteger(startMinute) ||
    startMinute < settings.dayStartMinute ||
    startMinute + settings.slotMinutes > settings.dayEndMinute ||
    (startMinute - settings.dayStartMinute) % settings.slotMinutes !== 0
  ) {
    throw new Error("Time must be an event slot.");
  }
}

function overlaps(
  item: Pick<Doc<"meetingParticipants">, "_id" | "startMinute" | "endMinute" | "status">,
  startMinute: number,
  slotMinutes: number,
  exceptParticipantId?: Id<"meetingParticipants">,
) {
  if (item.status === "cancelled") return false;
  if (exceptParticipantId && item._id === exceptParticipantId) return false;
  return startMinute < item.endMinute && startMinute + slotMinutes > item.startMinute;
}

async function participantAvailable(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  date: string,
  startMinute: number,
) {
  const row = await ctx.db
    .query("participantAvailability")
    .withIndex("by_accountId_and_date_and_startMinute", (q) =>
      q.eq("accountId", accountId).eq("date", date).eq("startMinute", startMinute),
    )
    .unique();
  return Boolean(row?.available);
}

async function participantMeetingConflict(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  date: string,
  startMinute: number,
  slotMinutes: number,
  exceptMeetingId?: Id<"meetings">,
) {
  const rows = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_accountId_and_date", (q) =>
      q.eq("accountId", accountId).eq("date", date),
    )
    .take(100);
  return rows.some(
    (row) =>
      row.meetingId !== exceptMeetingId &&
      overlaps(row, startMinute, slotMinutes),
  );
}

async function slotHasOpenTable(
  ctx: QueryCtx | MutationCtx,
  settings: Settings,
  date: string,
  startMinute: number,
) {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_date_and_startMinute", (q) =>
      q.eq("date", date).eq("startMinute", startMinute),
    )
    .take(100);
  const occupied = new Set(
    meetings
      .filter((meeting) => meeting.status !== "cancelled")
      .map((meeting) => meeting.tableNumber),
  );
  return occupied.size < settings.activeTables + settings.reserveTables;
}

async function hostMeetingAtSlot(
  ctx: QueryCtx | MutationCtx,
  hostAccountId: Id<"accounts">,
  date: string,
  startMinute: number,
) {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_hostAccountId_and_date", (q) =>
      q.eq("hostAccountId", hostAccountId).eq("date", date),
    )
    .take(100);
  return (
    meetings.find(
      (meeting) =>
        meeting.startMinute === startMinute && meeting.status !== "cancelled",
    ) ?? null
  );
}

async function tableConflict(
  ctx: QueryCtx | MutationCtx,
  date: string,
  startMinute: number,
  tableNumber: number,
  exceptMeetingId?: Id<"meetings">,
) {
  const rows = await ctx.db
    .query("meetings")
    .withIndex("by_date_and_startMinute_and_tableNumber", (q) =>
      q.eq("date", date).eq("startMinute", startMinute).eq("tableNumber", tableNumber),
    )
    .take(5);
  return rows.some(
    (meeting) => meeting.status !== "cancelled" && meeting._id !== exceptMeetingId,
  );
}

async function findOpenTable(
  ctx: QueryCtx | MutationCtx,
  settings: Settings,
  date: string,
  startMinute: number,
) {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_date_and_startMinute", (q) =>
      q.eq("date", date).eq("startMinute", startMinute),
    )
    .take(100);
  const occupied = new Set(
    meetings
      .filter((meeting) => meeting.status !== "cancelled")
      .map((meeting) => meeting.tableNumber),
  );
  const maxTable = settings.activeTables + settings.reserveTables;
  for (let table = 1; table <= maxTable; table += 1) {
    if (!occupied.has(table)) return table;
  }
  throw new Error("All tables are booked for this slot.");
}

async function activeOutgoingRequestsForDay(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  date: string,
) {
  const requests = await ctx.db
    .query("meetingRequests")
    .withIndex("by_requesterAccountId_and_date", (q) =>
      q.eq("requesterAccountId", accountId).eq("date", date),
    )
    .take(100);
  return requests.filter((request) => ACTIVE_REQUEST_STATUSES.has(request.status));
}

async function activeOutgoingInterests(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
) {
  const interests = await ctx.db
    .query("meetingInterests")
    .withIndex("by_requesterAccountId", (q) => q.eq("requesterAccountId", accountId))
    .take(100);
  return interests.filter((interest) => ACTIVE_REQUEST_STATUSES.has(interest.status));
}

async function findEarliestMutualSlot(
  ctx: QueryCtx | MutationCtx,
  settings: Settings,
  requesterAccountId: Id<"accounts">,
  targetAccountId: Id<"accounts">,
) {
  for (const date of EVENT_DATES) {
    for (
      let startMinute = settings.dayStartMinute;
      startMinute + settings.slotMinutes <= settings.dayEndMinute;
      startMinute += settings.slotMinutes
    ) {
      const [requesterAvailable, targetAvailable] = await Promise.all([
        participantAvailable(ctx, requesterAccountId, date, startMinute),
        participantAvailable(ctx, targetAccountId, date, startMinute),
      ]);
      if (!requesterAvailable || !targetAvailable) continue;
      if (
        await participantMeetingConflict(
          ctx,
          requesterAccountId,
          date,
          startMinute,
          settings.slotMinutes,
        )
      ) {
        continue;
      }

      const existingMeeting = await hostMeetingAtSlot(ctx, targetAccountId, date, startMinute);
      if (existingMeeting) {
        if (existingMeeting.participantCount < settings.maxMeetingGroupSize) {
          return { date, startMinute };
        }
        continue;
      }
      if (
        await participantMeetingConflict(
          ctx,
          targetAccountId,
          date,
          startMinute,
          settings.slotMinutes,
        )
      ) {
        continue;
      }
      if (await slotHasOpenTable(ctx, settings, date, startMinute)) {
        return { date, startMinute };
      }
    }
  }
  return null;
}

async function clearDemoData(ctx: MutationCtx) {
  for (const table of [
    "meetingParticipants",
    "meetings",
    "meetingInterests",
    "meetingRequests",
    "participantAvailability",
    "magicLoginTokens",
    "demoSessions",
    "importBatches",
    "accounts",
    "eventSettings",
  ] as const) {
    let batch = await ctx.db.query(table).take(200);
    while (batch.length > 0) {
      for (const row of batch) await ctx.db.delete(row._id);
      batch = await ctx.db.query(table).take(200);
    }
  }
}

async function shouldResetDemoData(ctx: MutationCtx, settings: Doc<"eventSettings"> | null) {
  if (!settings) return true;
  const maybeSettings = settings as Partial<Doc<"eventSettings">>;
  if (
    maybeSettings.schemaVersion !== DEMO_SCHEMA_VERSION ||
    maybeSettings.outgoingRequestCapPerDay == null ||
    maybeSettings.maxMeetingGroupSize == null
  ) {
    return true;
  }
  const accounts = await ctx.db.query("accounts").take(100);
  return accounts.some((account) => {
    const role = (account as { role?: string }).role;
    return role !== "admin" && role !== "participant";
  });
}

async function insertAvailabilityForAllSlots(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  settings: Pick<Settings, "dayStartMinute" | "dayEndMinute" | "slotMinutes">,
  unavailableStarts: Set<string> = new Set(),
) {
  for (const date of EVENT_DATES) {
    for (
      let startMinute = settings.dayStartMinute;
      startMinute + settings.slotMinutes <= settings.dayEndMinute;
      startMinute += settings.slotMinutes
    ) {
      const key = `${date}:${startMinute}`;
      await ctx.db.insert("participantAvailability", {
        accountId,
        date,
        startMinute,
        endMinute: startMinute + settings.slotMinutes,
        available: !unavailableStarts.has(key),
        updatedAt: now(),
      });
    }
  }
}

async function accountHasOpenAvailability(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
) {
  for (const date of EVENT_DATES) {
    const slots = await ctx.db
      .query("participantAvailability")
      .withIndex("by_accountId_and_date", (q) =>
        q.eq("accountId", accountId).eq("date", date),
      )
      .take(200);
    if (slots.some((slot) => slot.available)) return true;
  }
  return false;
}

async function recomputeHasAvailability(ctx: MutationCtx, accountId: Id<"accounts">) {
  const hasAvailability = await accountHasOpenAvailability(ctx, accountId);
  await ctx.db.patch(accountId, { hasAvailability, updatedAt: now() });
}

async function insertDemoData(ctx: MutationCtx) {
  const timestamp = now();
  const settingsId = await ctx.db.insert("eventSettings", {
    key: SETTINGS_KEY,
    schemaVersion: DEMO_SCHEMA_VERSION,
    eventName: "AIE World Fair Networking",
    roomName: "Moscone West, Level 3, Room 3001",
    timezone: "America/Los_Angeles",
    startDate: "2026-06-30",
    endDate: "2026-07-01",
    dayStartMinute: 10 * 60 + 40,
    dayEndMinute: 16 * 60,
    slotMinutes: 20,
    activeTables: 25,
    reserveTables: 0,
    outgoingRequestCapPerDay: 3,
    maxMeetingGroupSize: 4,
    allowCounters: true,
    updatedAt: timestamp,
  });
  const settings = (await ctx.db.get(settingsId)) as Settings;

  await ctx.db.insert("accounts", {
    email: "admin@aiewf.test",
    displayName: "AIE Room Admin",
    firstName: "AIE",
    lastName: "Admin",
    role: "admin",
    title: "Networking room operator",
    company: "AI Engineer",
    ticketType: "Staff",
    ticketCategory: "other",
    registrationStatus: "REGISTERED",
    profileImageUrl: "",
    city: "San Francisco",
    country: "US",
    companySize: "",
    networkingIntent: "Operate room scheduling and table assignments.",
    topics: ["operations"],
    signedUp: true,
    directoryOptIn: false,
    profileComplete: true,
    active: true,
    updatedAt: timestamp,
  });

  const participantSeeds = [
    {
      email: "priya@leadership.test",
      displayName: "Priya Raman",
      firstName: "Priya",
      lastName: "Raman",
      title: "VP AI Platform",
      company: "Northstar Bank",
      ticketType: "AI Leadership (All Access)",
      ticketCategory: "leadership" as const,
      city: "San Francisco",
      country: "US",
      networkingIntent: "Meet teams building enterprise agent platforms and eval workflows.",
      topics: ["agents", "enterprise AI", "evals"],
    },
    {
      email: "sherry@peak.test",
      displayName: "Sherry Jiang",
      firstName: "Sherry",
      lastName: "Jiang",
      title: "Founder",
      company: "Peak",
      ticketType: "AI Leadership (All Access)",
      ticketCategory: "leadership" as const,
      city: "San Francisco",
      country: "US",
      networkingIntent: "Looking for consumer AI builders and distribution partners.",
      topics: ["consumer AI", "growth", "founders"],
    },
    {
      email: "kai@speaker.test",
      displayName: "Kai Tan",
      firstName: "Kai",
      lastName: "Tan",
      title: "Staff AI Engineer",
      company: "Portside",
      ticketType: "SPEAKER PASS",
      ticketCategory: "speaker" as const,
      city: "Singapore",
      country: "SG",
      networkingIntent: "Compare production observability and agent reliability patterns.",
      topics: ["observability", "agents", "reliability"],
    },
    {
      email: "lena@evalforge.test",
      displayName: "Lena Ortiz",
      firstName: "Lena",
      lastName: "Ortiz",
      title: "Founder",
      company: "EvalForge",
      ticketType: "Late Bird - AI Leadership (All Access)",
      ticketCategory: "leadership" as const,
      city: "New York",
      country: "US",
      networkingIntent: "Find teams evaluating production agent launches.",
      topics: ["evals", "data quality", "agents"],
    },
    {
      email: "mateo@retailgrid.test",
      displayName: "Mateo Alvarez",
      firstName: "Mateo",
      lastName: "Alvarez",
      title: "Head of Data Quality",
      company: "RetailGrid",
      ticketType: "AI Leadership (All Access)",
      ticketCategory: "leadership" as const,
      city: "Austin",
      country: "US",
      networkingIntent: "Discuss data governance for customer-facing copilots.",
      topics: ["data quality", "governance", "copilots"],
    },
    {
      email: "zoe@missing.test",
      displayName: "Zoe Pennington",
      firstName: "Zoe",
      lastName: "Pennington",
      title: "",
      company: "",
      ticketType: "Sponsor Leadership Ticket",
      ticketCategory: "sponsor" as const,
      city: "",
      country: "",
      networkingIntent: "",
      topics: [],
    },
  ];

  const participantIds: Record<string, Id<"accounts">> = {};
  for (const seed of participantSeeds) {
    const profileComplete = Boolean(seed.displayName && seed.company && seed.title);
    // Demo: this participant is listed in the directory but has not opened any
    // booking times yet, so the UI can show the "not available for booking" state.
    const bookable = profileComplete && seed.email !== "mateo@retailgrid.test";
    const id = await ctx.db.insert("accounts", {
      ...seed,
      role: "participant",
      registrationStatus: "REGISTERED",
      profileImageUrl: "",
      companySize: "",
      signedUp: profileComplete,
      directoryOptIn: profileComplete,
      profileComplete,
      hasAvailability: bookable,
      active: true,
      updatedAt: timestamp,
    });
    participantIds[seed.email] = id;
    if (bookable) await insertAvailabilityForAllSlots(ctx, id, settings);
  }

  const groupRequestId = await ctx.db.insert("meetingRequests", {
    requesterAccountId: participantIds["lena@evalforge.test"],
    targetAccountId: participantIds["sherry@peak.test"],
    date: "2026-06-30",
    preferredStartMinute: 11 * 60,
    reason: "Compare founder notes on consumer AI distribution.",
    context: "Accepted seed request.",
    status: "accepted",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const meetingId = await ctx.db.insert("meetings", {
    hostAccountId: participantIds["sherry@peak.test"],
    date: "2026-06-30",
    startMinute: 11 * 60,
    endMinute: 11 * 60 + settings.slotMinutes,
    tableNumber: 1,
    participantCount: 2,
    status: "confirmed",
    context: "Founder distribution chat.",
    createdFromRequestId: groupRequestId,
    updatedAt: timestamp,
  });
  await ctx.db.insert("meetingParticipants", {
    meetingId,
    accountId: participantIds["sherry@peak.test"],
    date: "2026-06-30",
    startMinute: 11 * 60,
    endMinute: 11 * 60 + settings.slotMinutes,
    role: "host",
    status: "confirmed",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await ctx.db.insert("meetingParticipants", {
    meetingId,
    accountId: participantIds["lena@evalforge.test"],
    date: "2026-06-30",
    startMinute: 11 * 60,
    endMinute: 11 * 60 + settings.slotMinutes,
    role: "requester",
    requestId: groupRequestId,
    status: "confirmed",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await ctx.db.patch(groupRequestId, { meetingId });

  await ctx.db.insert("meetingRequests", {
    requesterAccountId: participantIds["priya@leadership.test"],
    targetAccountId: participantIds["kai@speaker.test"],
    date: "2026-06-30",
    preferredStartMinute: 11 * 60 + 20,
    alternateStartMinute: 14 * 60,
    reason: "Discuss enterprise-grade agent observability.",
    context: "Northstar Bank is evaluating agent reliability tooling.",
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await ctx.db.insert("meetingRequests", {
    requesterAccountId: participantIds["mateo@retailgrid.test"],
    targetAccountId: participantIds["sherry@peak.test"],
    date: "2026-06-30",
    preferredStartMinute: 11 * 60,
    reason: "Join the consumer AI distribution conversation from a retail perspective.",
    context: "Seed one-to-many request for an existing group.",
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function meetingWithParticipants(
  ctx: QueryCtx | MutationCtx,
  meeting: Doc<"meetings">,
) {
  const participantRows = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meetingId", (q) => q.eq("meetingId", meeting._id))
    .take(10);
  const accounts = await Promise.all(participantRows.map((row) => ctx.db.get(row.accountId)));
  const overrides = await getProfileOverrideMap(
    ctx,
    accounts.filter((account): account is Doc<"accounts"> => Boolean(account)).map((account) => account._id),
  );
  const host = await ctx.db.get(meeting.hostAccountId);
  const hostOverride = host ? await getProfileOverride(ctx, host._id) : null;
  return {
    ...meeting,
    participants: participantRows.map((row, index) => ({
      ...row,
      account: accountSummary(accounts[index], overrides.get(row.accountId)),
    })),
    host: accountSummary(host, hostOverride),
  };
}

async function requestWithPeople(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"meetingRequests">,
) {
  const [requester, target, meeting] = await Promise.all([
    ctx.db.get(request.requesterAccountId),
    ctx.db.get(request.targetAccountId),
    request.meetingId ? ctx.db.get(request.meetingId) : Promise.resolve(null),
  ]);
  const overrides = await getProfileOverrideMap(ctx, [
    request.requesterAccountId,
    request.targetAccountId,
  ]);
  return {
    ...request,
    requester: accountSummary(requester, overrides.get(request.requesterAccountId)),
    target: accountSummary(target, overrides.get(request.targetAccountId)),
    meeting: meeting ? await meetingWithParticipants(ctx, meeting) : null,
  };
}

async function interestWithPeople(
  ctx: QueryCtx | MutationCtx,
  interest: Doc<"meetingInterests">,
) {
  const [requester, target, meeting] = await Promise.all([
    ctx.db.get(interest.requesterAccountId),
    ctx.db.get(interest.targetAccountId),
    interest.meetingId ? ctx.db.get(interest.meetingId) : Promise.resolve(null),
  ]);
  const overrides = await getProfileOverrideMap(ctx, [
    interest.requesterAccountId,
    interest.targetAccountId,
  ]);
  return {
    ...interest,
    requester: accountSummary(requester, overrides.get(interest.requesterAccountId)),
    target: accountSummary(target, overrides.get(interest.targetAccountId)),
    meeting: meeting ? await meetingWithParticipants(ctx, meeting) : null,
  };
}

async function createOrJoinMeeting(
  ctx: MutationCtx,
  settings: Settings,
  fields: {
    requesterAccountId: Id<"accounts">;
    targetAccountId: Id<"accounts">;
    date: string;
    startMinute: number;
    context: string;
    requestId?: Id<"meetingRequests">;
  },
) {
  assertSlotInDay(settings, fields.startMinute);

  const [requester, target] = await Promise.all([
    ctx.db.get(fields.requesterAccountId),
    ctx.db.get(fields.targetAccountId),
  ]);
  if (!requester || !requester.active || requester.role !== "participant") {
    throw new Error("Requester is no longer available.");
  }
  if (
    !target ||
    !target.active ||
    target.role !== "participant" ||
    !target.signedUp ||
    !target.directoryOptIn
  ) {
    throw new Error("Target participant is no longer bookable.");
  }
  if (!(await participantAvailable(ctx, target._id, fields.date, fields.startMinute))) {
    throw new Error("Target participant is not available for that slot.");
  }
  if (
    await participantMeetingConflict(
      ctx,
      requester._id,
      fields.date,
      fields.startMinute,
      settings.slotMinutes,
    )
  ) {
    throw new Error("Requester already has a meeting at that time.");
  }

  const existingMeeting = await hostMeetingAtSlot(
    ctx,
    target._id,
    fields.date,
    fields.startMinute,
  );
  let meetingId: Id<"meetings">;
  let participantCount = 0;

  if (existingMeeting) {
    if (existingMeeting.participantCount >= settings.maxMeetingGroupSize) {
      throw new Error("Meeting group is full.");
    }
    meetingId = existingMeeting._id;
    participantCount = existingMeeting.participantCount;
  } else {
    if (
      await participantMeetingConflict(
        ctx,
        target._id,
        fields.date,
        fields.startMinute,
        settings.slotMinutes,
      )
    ) {
      throw new Error("Target participant already has a meeting at that time.");
    }
    const tableNumber = await findOpenTable(ctx, settings, fields.date, fields.startMinute);
    meetingId = await ctx.db.insert("meetings", {
      hostAccountId: target._id,
      date: fields.date,
      startMinute: fields.startMinute,
      endMinute: fields.startMinute + settings.slotMinutes,
      tableNumber,
      participantCount: 1,
      status: "confirmed",
      context: fields.context,
      ...(fields.requestId ? { createdFromRequestId: fields.requestId } : {}),
      updatedAt: now(),
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      accountId: target._id,
      date: fields.date,
      startMinute: fields.startMinute,
      endMinute: fields.startMinute + settings.slotMinutes,
      role: "host",
      status: "confirmed",
      createdAt: now(),
      updatedAt: now(),
    });
    participantCount = 1;
  }

  const existingParticipants = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meetingId", (q) => q.eq("meetingId", meetingId))
    .take(10);
  if (existingParticipants.some((participant) => participant.accountId === requester._id)) {
    throw new Error("Requester is already in this meeting.");
  }
  if (participantCount + 1 > settings.maxMeetingGroupSize) {
    throw new Error("Meeting group is full.");
  }

  await ctx.db.insert("meetingParticipants", {
    meetingId,
    accountId: requester._id,
    date: fields.date,
    startMinute: fields.startMinute,
    endMinute: fields.startMinute + settings.slotMinutes,
    role: "requester",
    ...(fields.requestId ? { requestId: fields.requestId } : {}),
    status: "confirmed",
    createdAt: now(),
    updatedAt: now(),
  });
  await ctx.db.patch(meetingId, {
    participantCount: participantCount + 1,
    updatedAt: now(),
  });
  return meetingId;
}

async function createOrJoinMeetingForRequest(
  ctx: MutationCtx,
  settings: Settings,
  request: Doc<"meetingRequests">,
  startMinute: number,
  responseNote: string,
) {
  const meetingId = await createOrJoinMeeting(ctx, settings, {
    requesterAccountId: request.requesterAccountId,
    targetAccountId: request.targetAccountId,
    date: request.date,
    startMinute,
    context: request.reason,
    requestId: request._id,
  });
  await ctx.db.patch(request._id, {
    status: "accepted",
    meetingId,
    responseNote,
    respondedByAccountId: request.targetAccountId,
    updatedAt: now(),
  });
  return meetingId;
}

async function createOrJoinMeetingForInterest(
  ctx: MutationCtx,
  settings: Settings,
  interest: Doc<"meetingInterests">,
) {
  const match = await findEarliestMutualSlot(
    ctx,
    settings,
    interest.requesterAccountId,
    interest.targetAccountId,
  );
  if (!match) throw new Error("No mutual open slot is available yet.");
  const meetingId = await createOrJoinMeeting(ctx, settings, {
    requesterAccountId: interest.requesterAccountId,
    targetAccountId: interest.targetAccountId,
    date: match.date,
    startMinute: match.startMinute,
    context: interest.reason,
  });
  await ctx.db.patch(interest._id, {
    status: "accepted",
    meetingId,
    responseNote: `Accepted and scheduled for ${match.date} at ${minuteLabel(match.startMinute)}.`,
    respondedByAccountId: interest.targetAccountId,
    updatedAt: now(),
  });
  return meetingId;
}

async function sendMagicLinkEmail({
  displayName,
  email,
  link,
}: {
  displayName: string;
  email: string;
  link: string;
}) {
  const response = await fetch(env.EMAIL_RELAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EMAIL_RELAY_SECRET}`,
      "Content-Type": "application/json",
      "User-Agent": "aiewf-networking/1.0",
    },
    body: JSON.stringify({
      ...(env.EMAIL_RELAY_FROM ? { from: env.EMAIL_RELAY_FROM } : {}),
      to: email,
      subject: "Your AIE World Fair networking login",
      text: [
        `Hi ${displayName},`,
        "",
        "Use this secure link to open the AIE World Fair networking room:",
        link,
        "",
        "This link expires in 15 minutes and can be used once.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not send login email. Email relay returned ${response.status}: ${detail.slice(0, 180)}`);
  }

  const result = (await response.json().catch(() => null)) as { delivered?: boolean; provider?: string } | null;
  if (result?.delivered === false || result?.provider === "none") {
    throw new Error("Could not send login email. Email relay did not deliver the message.");
  }
}

export const getPublicConfig = query({
  args: {},
  handler: async (ctx) => ({
    settings: await getSettings(ctx),
    demoLoginEnabled: demoLoginEnabled(),
  }),
});

export const createMagicLoginToken = internalMutation({
  args: {
    email: v.string(),
    tokenHash: v.string(),
    redirectPath: v.string(),
  },
  handler: async (ctx, args) => {
    const email = normalizeLoginEmail(args.email);
    if (!email) return { shouldSend: false as const };

    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account || !account.active) return { shouldSend: false as const };

    await ctx.db.insert("magicLoginTokens", {
      tokenHash: args.tokenHash,
      accountId: account._id,
      email,
      redirectPath: safeRedirectPath(args.redirectPath),
      createdAt: now(),
      expiresAt: now() + MAGIC_LINK_TTL_MS,
    });

    return {
      shouldSend: true as const,
      email,
      displayName: account.displayName,
      redirectPath: safeRedirectPath(args.redirectPath),
    };
  },
});

export const consumeMagicLoginToken = internalMutation({
  args: {
    tokenHash: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const loginToken = await ctx.db
      .query("magicLoginTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!loginToken || loginToken.usedAt !== undefined || loginToken.expiresAt < now()) {
      throw new Error("Magic link is invalid or expired.");
    }

    const account = await ctx.db.get(loginToken.accountId);
    if (!account || !account.active) throw new Error("Account is no longer active.");

    await ctx.db.patch(loginToken._id, { usedAt: now() });
    await ctx.db.insert("demoSessions", {
      token: args.sessionToken,
      accountId: account._id,
      source: "magic_link",
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });

    return { token: args.sessionToken, account: accountSummary(account) };
  },
});

export const requestMagicLink = action({
  args: {
    email: v.string(),
    redirectPath: v.optional(v.string()),
  },
  handler: async (ctx: ActionCtx, args) => {
    const email = normalizeLoginEmail(args.email);
    if (!email) return { sent: true };

    const token = secureTokenValue();
    const tokenHash = await hashLoginToken(token, MAGIC_LINK_HASH_SALT);
    const redirectPath = safeRedirectPath(args.redirectPath);
    const login: {
      shouldSend: boolean;
      email?: string;
      displayName?: string;
      redirectPath?: string;
    } = await ctx.runMutation(internal.networking.createMagicLoginToken, {
      email,
      tokenHash,
      redirectPath,
    });

    if (!login.shouldSend || !login.email || !login.displayName) return { sent: true };

    const link = buildMagicLinkUrl({
      baseUrl: env.APP_BASE_URL,
      token,
      redirectPath: login.redirectPath,
    });
    await sendMagicLinkEmail({ displayName: login.displayName, email: login.email, link });
    return { sent: true };
  },
});

export const verifyMagicLink = action({
  args: { token: v.string() },
  handler: async (ctx: ActionCtx, args) => {
    const token = args.token.trim();
    if (!token) throw new Error("Magic link is invalid or expired.");
    const tokenHash = await hashLoginToken(token, MAGIC_LINK_HASH_SALT);
    const sessionToken = secureTokenValue();
    const result: { token: string; account: ReturnType<typeof accountSummary> } = await ctx.runMutation(
      internal.networking.consumeMagicLoginToken,
      { tokenHash, sessionToken },
    );
    return result;
  },
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("demoSessions")
      .withIndex("by_token", (q) => q.eq("token", args.sessionToken))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return { loggedOut: true };
  },
});

export const ensureDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    if (!demoLoginEnabled()) return { seeded: false, reason: "demo_disabled" };
    const existing = await getSettings(ctx);
    const needsReset = await shouldResetDemoData(ctx, existing);
    if (!needsReset) return { seeded: false, reason: "already_seeded" };
    if (existing) await clearDemoData(ctx);
    await insertDemoData(ctx);
    return { seeded: true, reason: existing ? "reset_stale_demo_data" : "created_demo_data" };
  },
});

export const resetDemoData = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    if (!demoLoginEnabled()) throw new Error("Demo reset is disabled.");
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    await clearDemoData(ctx);
    await insertDemoData(ctx);
    const admin = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", "admin@aiewf.test"))
      .unique();
    if (!admin) throw new Error("Admin account was not recreated.");
    const token = tokenValue();
    await ctx.db.insert("demoSessions", {
      token,
      accountId: admin._id,
      source: "demo",
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });
    return { token };
  },
});

export const listDemoAccounts = query({
  args: {},
  handler: async (ctx) => {
    if (!demoLoginEnabled()) return [];
    const accounts = await ctx.db.query("accounts").take(200);
    return accounts
      .filter((account) => account.active)
      .map((account) => ({
        _id: account._id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        title: account.title,
        company: account.company,
        signedUp: account.signedUp,
        directoryOptIn: account.directoryOptIn,
      }));
  },
});

export const startDemoSession = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    if (!demoLoginEnabled()) throw new Error("Demo login is disabled.");
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .unique();
    if (!account || !account.active) throw new Error("Demo account not found.");
    const token = tokenValue();
    await ctx.db.insert("demoSessions", {
      token,
      accountId: account._id,
      source: "demo",
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });
    return { token, account };
  },
});

export const getBootstrap = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await getActorForSession(ctx, args.sessionToken);
    if (!actor) return null;
    const settings = await getSettings(ctx);
    if (!settings) return null;

    const visibleParticipants =
      actor.role === "participant"
        ? await ctx.db
            .query("accounts")
            .withIndex("by_signedUp_and_directoryOptIn", (q) =>
              q.eq("signedUp", true).eq("directoryOptIn", true),
            )
            .take(1800)
        : [];

    const myAvailability =
      actor.role === "participant"
        ? (
            await Promise.all(
              EVENT_DATES.map((date) =>
                ctx.db
                  .query("participantAvailability")
                  .withIndex("by_accountId_and_date", (q) =>
                    q.eq("accountId", actor._id).eq("date", date),
                  )
                  .take(100),
              ),
            )
          ).flat()
        : [];

    let requests: Array<Doc<"meetingRequests">> = [];
    let interests: Array<Doc<"meetingInterests">> = [];
    let meetings: Array<Doc<"meetings">> = [];

    if (actor.role === "admin") {
      requests = await ctx.db.query("meetingRequests").take(1000);
      interests = await ctx.db.query("meetingInterests").take(1000);
      meetings = await ctx.db.query("meetings").take(1000);
    } else {
      interests.push(
        ...(await ctx.db
          .query("meetingInterests")
          .withIndex("by_requesterAccountId", (q) =>
            q.eq("requesterAccountId", actor._id),
          )
          .take(100)),
      );
      interests.push(
        ...(await ctx.db
          .query("meetingInterests")
          .withIndex("by_targetAccountId", (q) =>
            q.eq("targetAccountId", actor._id),
          )
          .take(100)),
      );
      for (const date of EVENT_DATES) {
        requests.push(
          ...(await ctx.db
            .query("meetingRequests")
            .withIndex("by_requesterAccountId_and_date", (q) =>
              q.eq("requesterAccountId", actor._id).eq("date", date),
            )
            .take(100)),
        );
        requests.push(
          ...(await ctx.db
            .query("meetingRequests")
            .withIndex("by_targetAccountId_and_date", (q) =>
              q.eq("targetAccountId", actor._id).eq("date", date),
            )
            .take(100)),
        );
        const participantRows = await ctx.db
          .query("meetingParticipants")
          .withIndex("by_accountId_and_date", (q) =>
            q.eq("accountId", actor._id).eq("date", date),
          )
          .take(100);
        for (const row of participantRows) {
          const meeting = await ctx.db.get(row.meetingId);
          if (meeting) meetings.push(meeting);
        }
      }
    }

    const requestIds = new Set<Id<"meetingRequests">>();
    const uniqueRequests = requests.filter((request) => {
      if (requestIds.has(request._id)) return false;
      requestIds.add(request._id);
      return true;
    });
    const interestIds = new Set<Id<"meetingInterests">>();
    const uniqueInterests = interests.filter((interest) => {
      if (interestIds.has(interest._id)) return false;
      interestIds.add(interest._id);
      return true;
    });
    const meetingIds = new Set<Id<"meetings">>();
    const uniqueMeetings = meetings.filter((meeting) => {
      if (meetingIds.has(meeting._id)) return false;
      meetingIds.add(meeting._id);
      return true;
    });

    const importBatches =
      actor.role === "admin"
        ? await ctx.db
            .query("importBatches")
            .withIndex("by_kind", (q) => q.eq("kind", "participants_csv"))
            .order("desc")
            .take(5)
        : [];
    const participantRows = visibleParticipants.filter(
      (account) => account.role === "participant" && account.active,
    );
    const bootstrapOverrides = await getProfileOverrideMap(ctx, [
      actor._id,
      ...participantRows.map((account) => account._id),
    ]);

    return {
      settings,
      actor: accountSummary(actor, bootstrapOverrides.get(actor._id)),
      participants: participantRows.map((account) =>
        accountSummary(account, bootstrapOverrides.get(account._id)),
      ),
      myAvailability,
      requests: await Promise.all(uniqueRequests.map((request) => requestWithPeople(ctx, request))),
      interests: await Promise.all(uniqueInterests.map((interest) => interestWithPeople(ctx, interest))),
      meetings: await Promise.all(uniqueMeetings.map((meeting) => meetingWithParticipants(ctx, meeting))),
      importBatches,
      slotLabels: Array.from(
        {
          length: Math.floor(
            (settings.dayEndMinute - settings.dayStartMinute) / settings.slotMinutes,
          ),
        },
        (_, index) => {
          const minute = settings.dayStartMinute + index * settings.slotMinutes;
          return { minute, label: minuteLabel(minute) };
        },
      ),
    };
  },
});

export const listAdminParticipants = query({
  args: {
    sessionToken: v.string(),
    search: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const search = args.search.trim().toLowerCase();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_role", (q) => q.eq("role", "participant"))
      .take(1800);
    const matches = accounts
      .filter((account) => {
        if (!account.active) return false;
        if (!search) return true;
        return [
          account.displayName,
          account.email,
          account.company,
          account.title,
          account.ticketType,
          account.registrationStatus,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const participants = matches
      .slice(0, ADMIN_PARTICIPANT_LIMIT)
      .map((account) => accountSummary(account));
    return {
      participants,
      limit: ADMIN_PARTICIPANT_LIMIT,
      totalMatches: matches.length,
      hasMore: matches.length > participants.length,
    };
  },
});

export const listDirectoryPreviewParticipants = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_signedUp_and_directoryOptIn", (q) =>
        q.eq("signedUp", true).eq("directoryOptIn", true),
      )
      .take(1800);
    const participants = accounts.filter(
      (account) => account.role === "participant" && account.active,
    );
    const overrides = await getProfileOverrideMap(
      ctx,
      participants.map((account) => account._id),
    );
    return participants.map((account) =>
      accountSummary(account, overrides.get(account._id)),
    );
  },
});

export const getParticipantAvailability = query({
  args: { accountId: v.id("accounts"), date: v.string() },
  handler: async (ctx, args) => {
    assertValidEventDate(args.date);
    const account = await ctx.db.get(args.accountId);
    if (
      !account ||
      !account.active ||
      account.role !== "participant" ||
      !account.signedUp ||
      !account.directoryOptIn
    ) {
      return [];
    }
    const settings = await requireSettings(ctx);
    const availability = await ctx.db
      .query("participantAvailability")
      .withIndex("by_accountId_and_date", (q) =>
        q.eq("accountId", args.accountId).eq("date", args.date),
      )
      .take(100);
    const meeting = await hostMeetingAtSlot(ctx, args.accountId, args.date, settings.dayStartMinute);
    void meeting;
    const hostMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_hostAccountId_and_date", (q) =>
        q.eq("hostAccountId", args.accountId).eq("date", args.date),
      )
      .take(100);
    return availability
      .filter((slot) => slot.available)
      .map((slot) => {
        const group = hostMeetings.find(
          (item) => item.startMinute === slot.startMinute && item.status !== "cancelled",
        );
        return {
          ...slot,
          participantCount: group?.participantCount ?? 1,
          groupOpen: !group || group.participantCount < settings.maxMeetingGroupSize,
        };
      })
      .filter((slot) => slot.groupOpen);
  },
});

export const getRoomDisplay = query({
  args: {
    date: v.string(),
    nowMinute: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertValidEventDate(args.date);
    const settings = await getSettings(ctx);
    if (!settings) return null;
    const displayNowMinute = Math.min(
      settings.dayEndMinute,
      Math.max(settings.dayStartMinute, args.nowMinute ?? settings.dayStartMinute),
    );
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_date_and_startMinute", (q) => q.eq("date", args.date))
      .take(300);
    const activeMeetings = meetings.filter((meeting) => meeting.status !== "cancelled");
    const nextMeetings = await Promise.all(
      activeMeetings
        .filter((meeting) => meeting.endMinute > displayNowMinute)
        .sort(
          (a, b) =>
            a.startMinute - b.startMinute ||
            a.tableNumber - b.tableNumber ||
            a.hostAccountId.localeCompare(b.hostAccountId),
        )
        .slice(0, 12)
        .map((meeting) => meetingWithParticipants(ctx, meeting)),
    );
    const pendingRequests = await ctx.db
      .query("meetingRequests")
      .withIndex("by_date_and_status", (q) =>
        q.eq("date", args.date).eq("status", "pending"),
      )
      .take(500);
    const liveMeetings = activeMeetings.filter(
      (meeting) =>
        meeting.startMinute <= displayNowMinute && displayNowMinute < meeting.endMinute,
    );
    return {
      settings: {
        eventName: settings.eventName,
        roomName: settings.roomName,
        activeTables: settings.activeTables,
        slotMinutes: settings.slotMinutes,
        maxMeetingGroupSize: settings.maxMeetingGroupSize,
      },
      date: args.date,
      nowMinute: displayNowMinute,
      nowLabel: minuteLabel(displayNowMinute),
      counts: {
        live: liveMeetings.length,
        upcoming: nextMeetings.length,
        pendingRequests: pendingRequests.length,
        openTables: settings.activeTables - liveMeetings.length,
      },
      nextMeetings: nextMeetings.map((meeting) => ({
        meetingId: meeting._id,
        tableNumber: meeting.tableNumber,
        startMinute: meeting.startMinute,
        endMinute: meeting.endMinute,
        label: minuteLabel(meeting.startMinute),
        status: meeting.status,
        participantCount: meeting.participantCount,
        participants: meeting.participants.map((participant) => participant.account),
      })),
    };
  },
});

export const updateMyProfile = mutation({
  args: {
    sessionToken: v.string(),
    displayName: v.string(),
    title: v.string(),
    company: v.string(),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    networkingIntent: v.string(),
    topics: v.string(),
    directoryOptIn: v.boolean(),
    profileHeadline: v.optional(v.string()),
    profileBioMarkdown: v.optional(v.string()),
    profileTags: v.optional(v.string()),
    profilePrimarySources: v.optional(v.string()),
    profileSecondarySources: v.optional(v.string()),
    participantApproved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    if (actor.role !== "participant") throw new Error("Participant account required.");
    const displayName = args.displayName.trim();
    const title = args.title.trim();
    const company = args.company.trim();
    if (!displayName || !title || !company) {
      throw new Error("Name, title, and company are required.");
    }
    const accountTopics = splitList(args.topics);
    await ctx.db.patch(actor._id, {
      displayName,
      title,
      company,
      city: args.city?.trim() ?? actor.city,
      country: args.country?.trim() ?? actor.country,
      networkingIntent: args.networkingIntent.trim(),
      topics: accountTopics,
      signedUp: true,
      directoryOptIn: args.directoryOptIn,
      profileComplete: true,
      updatedAt: now(),
    });
    if (
      args.profileHeadline !== undefined ||
      args.profileBioMarkdown !== undefined ||
      args.profileTags !== undefined ||
      args.profilePrimarySources !== undefined ||
      args.profileSecondarySources !== undefined ||
      args.participantApproved !== undefined
    ) {
      const profileTags = args.profileTags === undefined ? accountTopics : splitList(args.profileTags);
      const sources =
        args.profilePrimarySources !== undefined || args.profileSecondarySources !== undefined
          ? {
              primary: splitProfileSources(args.profilePrimarySources),
              secondary: splitProfileSources(args.profileSecondarySources),
            }
          : undefined;
      await upsertProfileOverride(ctx, actor._id, {
        headline: args.profileHeadline?.trim() ?? "",
        bioMarkdown: args.profileBioMarkdown?.trim() ?? "",
        tags: profileTags.length ? profileTags : accountTopics,
        sources,
        participantApproved: args.participantApproved ?? false,
      });
    }
    return { updated: true };
  },
});

export const setMyAvailability = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    startMinute: v.number(),
    available: v.boolean(),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    if (actor.role !== "participant") throw new Error("Participant account required.");
    assertValidEventDate(args.date);
    assertSlotInDay(settings, args.startMinute);
    if (
      !args.available &&
      (await participantMeetingConflict(
        ctx,
        actor._id,
        args.date,
        args.startMinute,
        settings.slotMinutes,
      ))
    ) {
      throw new Error("Cancel or move the confirmed meeting before removing availability.");
    }
    const existing = await ctx.db
      .query("participantAvailability")
      .withIndex("by_accountId_and_date_and_startMinute", (q) =>
        q.eq("accountId", actor._id).eq("date", args.date).eq("startMinute", args.startMinute),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { available: args.available, updatedAt: now() });
    } else {
      await ctx.db.insert("participantAvailability", {
        accountId: actor._id,
        date: args.date,
        startMinute: args.startMinute,
        endMinute: args.startMinute + settings.slotMinutes,
        available: args.available,
        updatedAt: now(),
      });
    }
    await recomputeHasAvailability(ctx, actor._id);
    return { updated: true };
  },
});

export const setMyDayAvailability = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    available: v.boolean(),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    if (actor.role !== "participant") throw new Error("Participant account required.");
    assertValidEventDate(args.date);

    if (!args.available) {
      const conflicts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_accountId_and_date", (q) =>
          q.eq("accountId", actor._id).eq("date", args.date),
        )
        .take(100);
      if (conflicts.some((item) => item.status !== "cancelled")) {
        throw new Error("Cancel or move confirmed meetings before hiding the whole day.");
      }
    }

    for (
      let startMinute = settings.dayStartMinute;
      startMinute + settings.slotMinutes <= settings.dayEndMinute;
      startMinute += settings.slotMinutes
    ) {
      const existing = await ctx.db
        .query("participantAvailability")
        .withIndex("by_accountId_and_date_and_startMinute", (q) =>
          q.eq("accountId", actor._id).eq("date", args.date).eq("startMinute", startMinute),
        )
        .unique();
      const fields = {
        accountId: actor._id,
        date: args.date,
        startMinute,
        endMinute: startMinute + settings.slotMinutes,
        available: args.available,
        updatedAt: now(),
      };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert("participantAvailability", fields);
    }
    await recomputeHasAvailability(ctx, actor._id);
    return { updated: true };
  },
});

export const createPeerRequest = mutation({
  args: {
    sessionToken: v.string(),
    targetAccountId: v.id("accounts"),
    date: v.string(),
    preferredStartMinute: v.number(),
    alternateStartMinute: v.optional(v.number()),
    reason: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    requireParticipant(actor);
    if (actor._id === args.targetAccountId) throw new Error("You cannot request yourself.");
    if (args.reason.trim().length < 8) throw new Error("Add a specific meeting reason.");
    assertValidEventDate(args.date);
    assertSlotInDay(settings, args.preferredStartMinute);
    if (args.alternateStartMinute !== undefined) assertSlotInDay(settings, args.alternateStartMinute);
    const target = await ctx.db.get(args.targetAccountId);
    if (
      !target ||
      !target.active ||
      target.role !== "participant" ||
      !target.signedUp ||
      !target.directoryOptIn
    ) {
      throw new Error("Participant is not available for requests.");
    }
    if (!(await participantAvailable(ctx, target._id, args.date, args.preferredStartMinute))) {
      throw new Error("Preferred time is not available for that participant.");
    }
    if (
      args.alternateStartMinute !== undefined &&
      !(await participantAvailable(ctx, target._id, args.date, args.alternateStartMinute))
    ) {
      throw new Error("Alternate time is not available for that participant.");
    }
    const activeRequests = await activeOutgoingRequestsForDay(ctx, actor._id, args.date);
    if (activeRequests.length >= settings.outgoingRequestCapPerDay) {
      throw new Error("Daily outgoing request cap reached.");
    }
    if (
      activeRequests.some((request) => request.targetAccountId === target._id)
    ) {
      throw new Error("You already have an active request with this participant for this date.");
    }
    if (
      await participantMeetingConflict(
        ctx,
        actor._id,
        args.date,
        args.preferredStartMinute,
        settings.slotMinutes,
      )
    ) {
      throw new Error("You already have a meeting at that time.");
    }
    return await ctx.db.insert("meetingRequests", {
      requesterAccountId: actor._id,
      targetAccountId: target._id,
      date: args.date,
      preferredStartMinute: args.preferredStartMinute,
      ...(args.alternateStartMinute !== undefined
        ? { alternateStartMinute: args.alternateStartMinute }
        : {}),
      reason: args.reason.trim(),
      context: args.context?.trim() ?? `${actor.title}, ${actor.company}`,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

export const createMeetingInterest = mutation({
  args: {
    sessionToken: v.string(),
    targetAccountId: v.id("accounts"),
    reason: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireParticipant(actor);
    if (actor._id === args.targetAccountId) throw new Error("You cannot request yourself.");
    if (args.reason.trim().length < 8) throw new Error("Add a specific meeting reason.");
    const target = await ctx.db.get(args.targetAccountId);
    if (
      !target ||
      !target.active ||
      target.role !== "participant" ||
      !target.signedUp ||
      !target.directoryOptIn
    ) {
      throw new Error("Participant is not available for requests.");
    }
    const activeInterests = await activeOutgoingInterests(ctx, actor._id);
    if (activeInterests.some((interest) => interest.targetAccountId === target._id)) {
      throw new Error("You already have active interest with this participant.");
    }
    return await ctx.db.insert("meetingInterests", {
      requesterAccountId: actor._id,
      targetAccountId: target._id,
      reason: args.reason.trim(),
      context: args.context?.trim() ?? `${actor.title}, ${actor.company}`,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

export const respondToPeerRequest = mutation({
  args: {
    sessionToken: v.string(),
    requestId: v.id("meetingRequests"),
    action: v.union(v.literal("accept"), v.literal("decline"), v.literal("counter")),
    counterStartMinute: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    if (actor.role !== "admin" && request.targetAccountId !== actor._id) {
      throw new Error("Only the requested participant can respond.");
    }
    if (request.status === "accepted" || request.status === "cancelled" || request.status === "declined") {
      throw new Error("Request can no longer be changed.");
    }
    if (args.action === "decline") {
      await ctx.db.patch(request._id, {
        status: "declined",
        responseNote: args.note?.trim() || "Declined.",
        respondedByAccountId: actor._id,
        updatedAt: now(),
      });
      return { status: "declined" };
    }
    if (args.action === "counter") {
      if (!settings.allowCounters) throw new Error("Counter-proposals are disabled.");
      if (args.counterStartMinute === undefined) throw new Error("Counter time required.");
      assertSlotInDay(settings, args.counterStartMinute);
      if (!(await participantAvailable(ctx, request.targetAccountId, request.date, args.counterStartMinute))) {
        throw new Error("Counter time is not available.");
      }
      await ctx.db.patch(request._id, {
        status: "countered",
        counterStartMinute: args.counterStartMinute,
        responseNote: args.note?.trim() || `Countered to ${minuteLabel(args.counterStartMinute)}.`,
        respondedByAccountId: actor._id,
        updatedAt: now(),
      });
      return { status: "countered" };
    }
    const meetingId = await createOrJoinMeetingForRequest(
      ctx,
      settings,
      request,
      request.preferredStartMinute,
      args.note?.trim() || "Accepted.",
    );
    return { status: "accepted", meetingId };
  },
});

export const respondToMeetingInterest = mutation({
  args: {
    sessionToken: v.string(),
    interestId: v.id("meetingInterests"),
    action: v.union(v.literal("accept"), v.literal("decline")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    const interest = await ctx.db.get(args.interestId);
    if (!interest) throw new Error("Interest not found.");
    if (actor.role !== "admin" && interest.targetAccountId !== actor._id) {
      throw new Error("Only the requested participant can respond.");
    }
    if (interest.status === "accepted" || interest.status === "cancelled" || interest.status === "declined") {
      throw new Error("Interest can no longer be changed.");
    }
    if (args.action === "decline") {
      await ctx.db.patch(interest._id, {
        status: "declined",
        responseNote: args.note?.trim() || "Declined.",
        respondedByAccountId: actor._id,
        updatedAt: now(),
      });
      return { status: "declined" };
    }
    const meetingId = await createOrJoinMeetingForInterest(ctx, settings, interest);
    if (args.note?.trim()) {
      await ctx.db.patch(interest._id, { responseNote: args.note.trim(), updatedAt: now() });
    }
    return { status: "accepted", meetingId };
  },
});

export const confirmCounter = mutation({
  args: { sessionToken: v.string(), requestId: v.id("meetingRequests") },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    if (request.requesterAccountId !== actor._id) {
      throw new Error("Only the requester can confirm a counter.");
    }
    if (request.status !== "countered" || request.counterStartMinute === undefined) {
      throw new Error("Request does not have a counter-proposal.");
    }
    const meetingId = await createOrJoinMeetingForRequest(
      ctx,
      settings,
      request,
      request.counterStartMinute,
      "Counter accepted.",
    );
    return { status: "accepted", meetingId };
  },
});

export const cancelRequest = mutation({
  args: { sessionToken: v.string(), requestId: v.id("meetingRequests") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    if (actor.role !== "admin" && request.requesterAccountId !== actor._id) {
      throw new Error("Only the requester can cancel this request.");
    }
    if (request.meetingId) {
      const participants = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", request.meetingId as Id<"meetings">))
        .take(10);
      const requesterParticipant = participants.find(
        (participant) => participant.requestId === request._id,
      );
      if (requesterParticipant) {
        await ctx.db.patch(requesterParticipant._id, { status: "cancelled", updatedAt: now() });
        const meeting = await ctx.db.get(request.meetingId);
        if (meeting) {
          const nextCount = Math.max(1, meeting.participantCount - 1);
          await ctx.db.patch(meeting._id, {
            participantCount: nextCount,
            status: nextCount <= 1 ? "cancelled" : meeting.status,
            updatedAt: now(),
          });
        }
      }
    }
    await ctx.db.patch(request._id, { status: "cancelled", updatedAt: now() });
    return { cancelled: true };
  },
});

export const cancelMeetingInterest = mutation({
  args: { sessionToken: v.string(), interestId: v.id("meetingInterests") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    const interest = await ctx.db.get(args.interestId);
    if (!interest) throw new Error("Interest not found.");
    if (actor.role !== "admin" && interest.requesterAccountId !== actor._id) {
      throw new Error("Only the requester can cancel this interest.");
    }
    if (interest.meetingId) {
      const participants = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", interest.meetingId as Id<"meetings">))
        .take(10);
      const requesterParticipant = participants.find(
        (participant) => participant.accountId === interest.requesterAccountId,
      );
      if (requesterParticipant) {
        await ctx.db.patch(requesterParticipant._id, { status: "cancelled", updatedAt: now() });
        const meeting = await ctx.db.get(interest.meetingId);
        if (meeting) {
          const nextCount = Math.max(1, meeting.participantCount - 1);
          await ctx.db.patch(meeting._id, {
            participantCount: nextCount,
            status: nextCount <= 1 ? "cancelled" : meeting.status,
            updatedAt: now(),
          });
        }
      }
    }
    await ctx.db.patch(interest._id, { status: "cancelled", updatedAt: now() });
    return { cancelled: true };
  },
});

export const updateSettings = mutation({
  args: {
    sessionToken: v.string(),
    dayStartMinute: v.number(),
    dayEndMinute: v.number(),
    slotMinutes: v.number(),
    activeTables: v.number(),
    reserveTables: v.number(),
    outgoingRequestCapPerDay: v.number(),
    maxMeetingGroupSize: v.number(),
    allowCounters: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const settings = await requireSettings(ctx);
    validateMinuteOfDay("dayStartMinute", args.dayStartMinute);
    validateMinuteOfDay("dayEndMinute", args.dayEndMinute);
    validatePositiveInteger("slotMinutes", args.slotMinutes);
    validatePositiveInteger("activeTables", args.activeTables);
    validatePositiveInteger("outgoingRequestCapPerDay", args.outgoingRequestCapPerDay);
    validatePositiveInteger("maxMeetingGroupSize", args.maxMeetingGroupSize);
    if (!Number.isInteger(args.reserveTables) || args.reserveTables < 0) {
      throw new Error("reserveTables must be zero or a positive integer.");
    }
    if (args.maxMeetingGroupSize > 4) throw new Error("Group size cannot exceed 4.");
    if (args.dayEndMinute <= args.dayStartMinute) throw new Error("End time must be after start time.");
    if ((args.dayEndMinute - args.dayStartMinute) % args.slotMinutes !== 0) {
      throw new Error("Meeting window must divide evenly into slot length.");
    }
    await ctx.db.patch(settings._id, {
      schemaVersion: DEMO_SCHEMA_VERSION,
      dayStartMinute: args.dayStartMinute,
      dayEndMinute: args.dayEndMinute,
      slotMinutes: args.slotMinutes,
      activeTables: args.activeTables,
      reserveTables: args.reserveTables,
      outgoingRequestCapPerDay: args.outgoingRequestCapPerDay,
      maxMeetingGroupSize: args.maxMeetingGroupSize,
      allowCounters: args.allowCounters,
      updatedAt: now(),
    });
    return { updated: true };
  },
});

export const setParticipantOptIn = mutation({
  args: {
    sessionToken: v.string(),
    accountId: v.id("accounts"),
    directoryOptIn: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    await ctx.db.patch(args.accountId, { directoryOptIn: args.directoryOptIn, updatedAt: now() });
    return { updated: true };
  },
});

export const backfillParticipantDirectoryOptIn = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const participants = await ctx.db
      .query("accounts")
      .withIndex("by_role", (q) => q.eq("role", "participant"))
      .take(1800);
    let updated = 0;
    const timestamp = now();
    for (const participant of participants) {
      if (!participant.active) continue;
      const profileComplete = Boolean(
        participant.displayName.trim() && participant.title.trim() && participant.company.trim(),
      );
      if (!profileComplete) continue;
      if (participant.signedUp && participant.directoryOptIn && participant.profileComplete) continue;
      await ctx.db.patch(participant._id, {
        signedUp: true,
        directoryOptIn: true,
        profileComplete: true,
        updatedAt: timestamp,
      });
      updated += 1;
    }
    return { updated };
  },
});

export const addMissingParticipants = internalMutation({
  args: {
    rows: v.array(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        email: v.string(),
        registrationStatus: v.string(),
        ticketCategory: v.union(
          v.literal("leadership"),
          v.literal("speaker"),
          v.literal("sponsor"),
          v.literal("other"),
        ),
      }),
    ),
    directoryVisible: v.boolean(),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    let inserted = 0;
    let skipped = 0;
    const insertedEmails: string[] = [];
    for (const row of args.rows) {
      const email = row.email.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        skipped += 1;
        continue;
      }
      const existing = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existing) {
        skipped += 1;
        continue;
      }
      const firstName = row.firstName.trim();
      const lastName = row.lastName.trim();
      const displayName = `${firstName} ${lastName}`.trim() || email;
      const accountId = await ctx.db.insert("accounts", {
        email,
        displayName,
        firstName,
        lastName,
        role: "participant",
        title: "",
        company: "",
        ticketType: "",
        ticketCategory: row.ticketCategory,
        registrationStatus: row.registrationStatus,
        profileImageUrl: "",
        city: "",
        country: "",
        companySize: "",
        networkingIntent: "",
        topics: [],
        signedUp: args.directoryVisible,
        directoryOptIn: args.directoryVisible,
        profileComplete: false,
        active: true,
        updatedAt: now(),
      });
      await insertAvailabilityForAllSlots(ctx, accountId, settings);
      await recomputeHasAvailability(ctx, accountId);
      inserted += 1;
      insertedEmails.push(email);
    }
    return { inserted, skipped, insertedEmails };
  },
});

export const backfillHasAvailability = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const participants = await ctx.db
      .query("accounts")
      .withIndex("by_role", (q) => q.eq("role", "participant"))
      .take(1800);
    let updated = 0;
    for (const participant of participants) {
      const hasAvailability = await accountHasOpenAvailability(ctx, participant._id);
      if (participant.hasAvailability === hasAvailability) continue;
      await ctx.db.patch(participant._id, { hasAvailability, updatedAt: now() });
      updated += 1;
    }
    return { updated };
  },
});

export const upsertParticipantsFromRows = mutation({
  args: {
    sessionToken: v.string(),
    rows: v.array(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import is limited to ${MAX_IMPORT_ROWS} rows per batch.`);
    }
    const seenEmails = new Set<string>();
    let inserted = 0;
    let updated = 0;
    let duplicateRows = 0;
    let missingEmailRows = 0;
    let missingCompanyRows = 0;
    let missingTitleRows = 0;

    for (const row of args.rows) {
      const normalized = normalizeParticipantRow(row);
      if (!normalized.email) {
        missingEmailRows += 1;
        continue;
      }
      if (seenEmails.has(normalized.email)) {
        duplicateRows += 1;
        continue;
      }
      seenEmails.add(normalized.email);
      if (!normalized.company) missingCompanyRows += 1;
      if (!normalized.title) missingTitleRows += 1;
      const existing = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", normalized.email))
        .unique();
      const isAdminAccount = ADMIN_EMAILS.has(normalized.email) || existing?.role === "admin";
      const importedProfileComplete = normalized.profileComplete;
      const importedParticipantVisible = !isAdminAccount && importedProfileComplete;
      const preserved = existing?.signedUp
        ? {
            displayName: existing.displayName,
            title: existing.title,
            company: existing.company,
            networkingIntent: existing.networkingIntent,
            topics: existing.topics,
            signedUp: existing.signedUp,
            directoryOptIn: existing.directoryOptIn,
            profileComplete: existing.profileComplete,
          }
        : {
            displayName: normalized.displayName,
            title: normalized.title,
            company: normalized.company,
            networkingIntent: "",
            topics: [],
            signedUp: importedParticipantVisible,
            directoryOptIn: importedParticipantVisible,
            profileComplete: importedProfileComplete,
          };
      const role = isAdminAccount ? ("admin" as const) : ("participant" as const);
      const fields = {
        email: normalized.email,
        displayName: preserved.displayName || normalized.email,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        role,
        title: preserved.title,
        company: preserved.company,
        ticketType: normalized.ticketType,
        ticketCategory: normalized.ticketCategory,
        registrationStatus: normalized.registrationStatus,
        profileImageUrl: normalized.profileImageUrl,
        city: normalized.city,
        country: normalized.country,
        companySize: normalized.companySize,
        networkingIntent: preserved.networkingIntent,
        topics: preserved.topics,
        signedUp: preserved.signedUp,
        directoryOptIn: preserved.directoryOptIn,
        profileComplete: preserved.profileComplete,
        active: true,
        rawImportJson: JSON.stringify(row),
        updatedAt: now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        updated += 1;
      } else {
        const accountId = await ctx.db.insert("accounts", fields);
        const settings = await requireSettings(ctx);
        await insertAvailabilityForAllSlots(ctx, accountId, settings);
        await recomputeHasAvailability(ctx, accountId);
        inserted += 1;
      }
    }

    const summary = `${inserted} inserted, ${updated} updated, ${duplicateRows} duplicate rows skipped`;
    await ctx.db.insert("importBatches", {
      importedByAccountId: actor._id,
      kind: "participants_csv",
      rowCount: args.rows.length,
      inserted,
      updated,
      duplicateRows,
      missingEmailRows,
      missingCompanyRows,
      missingTitleRows,
      summary,
      createdAt: now(),
    });
    return {
      inserted,
      updated,
      duplicateRows,
      missingEmailRows,
      missingCompanyRows,
      missingTitleRows,
    };
  },
});

export const updateMeetingStatus = mutation({
  args: {
    sessionToken: v.string(),
    meetingId: v.id("meetings"),
    status: meetingStatusValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .take(10);
    if (
      actor.role !== "admin" &&
      !participants.some((participant) => participant.accountId === actor._id)
    ) {
      throw new Error("Only meeting participants can update this meeting.");
    }
    await ctx.db.patch(args.meetingId, { status: args.status, updatedAt: now() });
    for (const participant of participants) {
      await ctx.db.patch(participant._id, { status: args.status, updatedAt: now() });
    }
    if (args.status === "cancelled") {
      const requests = await ctx.db
        .query("meetingRequests")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
        .take(10);
      for (const request of requests) {
        await ctx.db.patch(request._id, { status: "cancelled", updatedAt: now() });
      }
      const interests = await ctx.db
        .query("meetingInterests")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
        .take(10);
      for (const interest of interests) {
        await ctx.db.patch(interest._id, { status: "cancelled", updatedAt: now() });
      }
    }
    return { updated: true };
  },
});

export const moveMeeting = mutation({
  args: {
    sessionToken: v.string(),
    meetingId: v.id("meetings"),
    startMinute: v.number(),
    tableNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const settings = await requireSettings(ctx);
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    const maxTable = settings.activeTables + settings.reserveTables;
    if (
      !Number.isInteger(args.tableNumber) ||
      args.tableNumber < 1 ||
      args.tableNumber > maxTable
    ) {
      throw new Error("Table is outside configured inventory.");
    }
    assertSlotInDay(settings, args.startMinute);
    if (
      await tableConflict(
        ctx,
        meeting.date,
        args.startMinute,
        args.tableNumber,
        meeting._id,
      )
    ) {
      throw new Error("Table is already occupied at that time.");
    }
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", meeting._id))
      .take(10);
    for (const participant of participants) {
      if (
        await participantMeetingConflict(
          ctx,
          participant.accountId,
          meeting.date,
          args.startMinute,
          settings.slotMinutes,
          meeting._id,
        )
      ) {
        throw new Error("A participant already has a meeting at that time.");
      }
    }
    await ctx.db.patch(args.meetingId, {
      startMinute: args.startMinute,
      endMinute: args.startMinute + settings.slotMinutes,
      tableNumber: args.tableNumber,
      updatedAt: now(),
    });
    for (const participant of participants) {
      await ctx.db.patch(participant._id, {
        startMinute: args.startMinute,
        endMinute: args.startMinute + settings.slotMinutes,
        updatedAt: now(),
      });
    }
    return { updated: true };
  },
});

const MAX_MESSAGE_LENGTH = 2000;

async function requireMeetingMember(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
  meetingId: Id<"meetings">,
) {
  const actor = await requireActor(ctx, sessionToken);
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Meeting not found.");
  const participants = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meetingId", (q) => q.eq("meetingId", meetingId))
    .take(10);
  const isMember = participants.some(
    (participant) => participant.accountId === actor._id,
  );
  if (actor.role !== "admin" && !isMember) {
    throw new Error("Only meeting participants can use this chat.");
  }
  return { actor, meeting };
}

export const listMeetingMessages = query({
  args: { sessionToken: v.string(), meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const { actor } = await requireMeetingMember(
      ctx,
      args.sessionToken,
      args.meetingId,
    );
    const messages = await ctx.db
      .query("meetingMessages")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .order("asc")
      .take(200);
    const overrides = await getProfileOverrideMap(
      ctx,
      messages.map((message) => message.senderAccountId),
    );
    const senders = await Promise.all(
      messages.map((message) => ctx.db.get(message.senderAccountId)),
    );
    return messages.map((message, index) => ({
      _id: message._id,
      body: message.body,
      createdAt: message.createdAt,
      isMine: message.senderAccountId === actor._id,
      sender: accountSummary(senders[index], overrides.get(message.senderAccountId)),
    }));
  },
});

export const sendMeetingMessage = mutation({
  args: {
    sessionToken: v.string(),
    meetingId: v.id("meetings"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, meeting } = await requireMeetingMember(
      ctx,
      args.sessionToken,
      args.meetingId,
    );
    if (meeting.status === "cancelled") {
      throw new Error("This meeting has been cancelled.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Message is too long.");
    }
    const messageId = await ctx.db.insert("meetingMessages", {
      meetingId: args.meetingId,
      senderAccountId: actor._id,
      body,
      createdAt: now(),
    });
    return { messageId };
  },
});
