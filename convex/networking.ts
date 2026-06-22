import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const SETTINGS_KEY = "default";
const EVENT_DATES = ["2026-06-30", "2026-07-01"];
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const MAX_IMPORT_ROWS = 100;
const DEFAULT_AVAILABILITY_WINDOWS = [
  { startMinute: 10 * 60 + 40, endMinute: 12 * 60 + 40, note: "Morning block" },
  { startMinute: 14 * 60, endMinute: 16 * 60, note: "Afternoon block" },
];

const meetingStatusValidator = v.union(
  v.literal("confirmed"),
  v.literal("completed"),
  v.literal("no_show"),
  v.literal("cancelled"),
);

const deskMatchStatusValidator = v.union(
  v.literal("closed"),
  v.literal("cancelled"),
);

type Actor = Doc<"accounts">;
type Settings = Doc<"eventSettings">;

function now() {
  return Date.now();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitList(value: string | undefined) {
  return value?.split(";").map((item) => item.trim()).filter(Boolean) ?? [];
}

function tokenValue() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
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

async function requireActor(ctx: QueryCtx | MutationCtx, sessionToken: string) {
  const session = await ctx.db
    .query("demoSessions")
    .withIndex("by_token", (q) => q.eq("token", sessionToken))
    .unique();
  if (!session || session.expiresAt < now()) {
    throw new Error("Demo session expired. Select an account again.");
  }
  const actor = await ctx.db.get(session.accountId);
  if (!actor || !actor.active) {
    throw new Error("Demo session account is inactive.");
  }
  return actor;
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Error("Admin access required.");
}

function isCompanyOperator(actor: Actor, companyId: Id<"companies">) {
  return (
    actor.role === "admin" ||
    (actor.role === "company" && actor.companyId === companyId)
  );
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

async function hasAvailability(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  date: string,
  startMinute: number,
  slotMinutes: number,
) {
  const windows = await ctx.db
    .query("availability")
    .withIndex("by_companyId_and_date", (q) =>
      q.eq("companyId", companyId).eq("date", date),
    )
    .take(24);
  return windows.some(
    (window) =>
      startMinute >= window.startMinute &&
      startMinute + slotMinutes <= window.endMinute,
  );
}

async function ensureDefaultAvailability(ctx: MutationCtx, companyId: Id<"companies">) {
  const timestamp = now();
  for (const date of EVENT_DATES) {
    const existing = await ctx.db
      .query("availability")
      .withIndex("by_companyId_and_date", (q) =>
        q.eq("companyId", companyId).eq("date", date),
      )
      .take(1);
    if (existing.length > 0) continue;

    for (const availabilityWindow of DEFAULT_AVAILABILITY_WINDOWS) {
      await ctx.db.insert("availability", {
        companyId,
        date,
        ...availabilityWindow,
        updatedAt: timestamp,
      });
    }
  }
}

async function companyMeetingsForDay(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  date: string,
) {
  return await ctx.db
    .query("meetings")
    .withIndex("by_companyId_and_date", (q) =>
      q.eq("companyId", companyId).eq("date", date),
    )
    .take(500);
}

async function attendeeMeetingsForDay(
  ctx: QueryCtx | MutationCtx,
  attendeeAccountId: Id<"accounts">,
  date: string,
) {
  return await ctx.db
    .query("meetings")
    .withIndex("by_attendeeAccountId_and_date", (q) =>
      q.eq("attendeeAccountId", attendeeAccountId).eq("date", date),
    )
    .take(500);
}

function overlaps(
  meeting: Pick<Doc<"meetings">, "_id" | "startMinute" | "endMinute" | "status">,
  startMinute: number,
  slotMinutes: number,
  exceptMeetingId?: Id<"meetings">,
) {
  if (meeting.status === "cancelled") return false;
  if (exceptMeetingId && meeting._id === exceptMeetingId) return false;
  return startMinute < meeting.endMinute && startMinute + slotMinutes > meeting.startMinute;
}

async function hasCompanyMeetingConflict(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  date: string,
  startMinute: number,
  slotMinutes: number,
  exceptMeetingId?: Id<"meetings">,
) {
  const meetings = await companyMeetingsForDay(ctx, companyId, date);
  return meetings.some((meeting) => overlaps(meeting, startMinute, slotMinutes, exceptMeetingId));
}

async function hasAttendeeMeetingConflict(
  ctx: QueryCtx | MutationCtx,
  attendeeAccountId: Id<"accounts">,
  date: string,
  startMinute: number,
  slotMinutes: number,
  exceptMeetingId?: Id<"meetings">,
) {
  const meetings = await attendeeMeetingsForDay(ctx, attendeeAccountId, date);
  return meetings.some((meeting) => overlaps(meeting, startMinute, slotMinutes, exceptMeetingId));
}

async function hasTableConflict(
  ctx: QueryCtx | MutationCtx,
  date: string,
  tableNumber: number,
  startMinute: number,
  slotMinutes: number,
  exceptMeetingId?: Id<"meetings">,
) {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_date_and_tableNumber", (q) =>
      q.eq("date", date).eq("tableNumber", tableNumber),
    )
    .take(500);
  return meetings.some((meeting) => overlaps(meeting, startMinute, slotMinutes, exceptMeetingId));
}

async function companyAcceptedCount(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  date: string,
) {
  const meetings = await companyMeetingsForDay(ctx, companyId, date);
  return meetings.filter((meeting) => meeting.status !== "cancelled").length;
}

async function attendeeRequestsForDay(
  ctx: QueryCtx | MutationCtx,
  attendeeAccountId: Id<"accounts">,
  date: string,
) {
  return await ctx.db
    .query("meetingRequests")
    .withIndex("by_attendeeAccountId_and_date", (q) =>
      q.eq("attendeeAccountId", attendeeAccountId).eq("date", date),
    )
    .take(100);
}

async function activeAttendeeCompanyRequestsForDay(
  ctx: QueryCtx | MutationCtx,
  attendeeAccountId: Id<"accounts">,
  companyId: Id<"companies">,
  date: string,
) {
  const requests = await ctx.db
    .query("meetingRequests")
    .withIndex("by_attendeeAccountId_and_companyId_and_date", (q) =>
      q.eq("attendeeAccountId", attendeeAccountId).eq("companyId", companyId).eq("date", date),
    )
    .take(20);

  return requests.filter(
    (request) => request.status !== "cancelled" && request.status !== "declined",
  );
}

async function assertBookableSlot(
  ctx: QueryCtx | MutationCtx,
  settings: Settings,
  request: Doc<"meetingRequests">,
  startMinute: number,
  exceptMeetingId?: Id<"meetings">,
) {
  assertValidEventDate(request.date);
  assertSlotInDay(settings, startMinute);

  const company = await ctx.db.get(request.companyId);
  if (!company || !company.optedIn) {
    throw new Error("Company is not available for meeting assignment.");
  }

  const available = await hasAvailability(
    ctx,
    request.companyId,
    request.date,
    startMinute,
    settings.slotMinutes,
  );
  if (!available) throw new Error("Selected time is outside company availability.");

  if (
    await hasCompanyMeetingConflict(
      ctx,
      request.companyId,
      request.date,
      startMinute,
      settings.slotMinutes,
      exceptMeetingId,
    )
  ) {
    throw new Error("Company already has a meeting at that time.");
  }

  if (
    await hasAttendeeMeetingConflict(
      ctx,
      request.attendeeAccountId,
      request.date,
      startMinute,
      settings.slotMinutes,
      exceptMeetingId,
    )
  ) {
    throw new Error("Attendee already has a meeting at that time.");
  }
}

async function findActiveTable(
  ctx: QueryCtx | MutationCtx,
  settings: Settings,
  date: string,
  startMinute: number,
) {
  for (let tableNumber = 1; tableNumber <= settings.activeTables; tableNumber += 1) {
    const conflict = await hasTableConflict(
      ctx,
      date,
      tableNumber,
      startMinute,
      settings.slotMinutes,
    );
    if (!conflict) return tableNumber;
  }
  return null;
}

async function createConfirmedMeeting(
  ctx: MutationCtx,
  settings: Settings,
  request: Doc<"meetingRequests">,
  startMinute: number,
  context: string,
) {
  await assertBookableSlot(ctx, settings, request, startMinute);

  const acceptedCount = await companyAcceptedCount(ctx, request.companyId, request.date);
  if (acceptedCount >= settings.companyAcceptCapPerDay) {
    throw new Error("Company daily accepted meeting cap reached.");
  }

  const tableNumber = await findActiveTable(ctx, settings, request.date, startMinute);
  if (tableNumber === null) throw new Error("No active table is available for that slot.");

  return await ctx.db.insert("meetings", {
    requestId: request._id,
    attendeeAccountId: request.attendeeAccountId,
    companyId: request.companyId,
    date: request.date,
    startMinute,
    endMinute: startMinute + settings.slotMinutes,
    tableNumber,
    status: "confirmed",
    context,
    updatedAt: now(),
  });
}

async function clearDemoData(ctx: MutationCtx) {
  for (const table of [
    "meetings",
    "meetingRequests",
    "deskMatchRequests",
    "availability",
    "demoSessions",
    "accounts",
    "companies",
    "eventSettings",
    "importBatches",
  ] as const) {
    let rows = await ctx.db.query(table).take(500);
    while (rows.length > 0) {
      for (const row of rows) await ctx.db.delete(row._id);
      rows = await ctx.db.query(table).take(500);
    }
  }
}

async function insertDemoData(ctx: MutationCtx) {
  const timestamp = now();
  await ctx.db.insert("eventSettings", {
    key: SETTINGS_KEY,
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
    attendeeRequestCapPerDay: 3,
    companyAcceptCapPerDay: 3,
    allowCounters: true,
    sponsorsOnlyDefault: true,
    updatedAt: timestamp,
  });

  const companySeeds = [
    ["Microsoft", "Presenting", "enterprise AI;copilots;platform engineering"],
    ["OpenAI", "Lab", "agents;model evals;developer platforms"],
    ["Google DeepMind", "Lab", "research;AI infrastructure;safety"],
    ["Braintrust", "Platinum", "evals;observability;data quality"],
    ["Browserbase", "Platinum", "web agents;automation;browser infrastructure"],
    ["LangChain", "Gold", "agents;orchestration;LLM apps"],
    ["Datadog", "Gold", "observability;infra;production AI"],
    ["Figma", "Curated company", "design tools;collaboration;AI product"],
  ];

  const companyIds: Record<string, Id<"companies">> = {};
  for (let index = 0; index < companySeeds.length; index += 1) {
    const [name, tier, topics] = companySeeds[index];
    companyIds[name] = await ctx.db.insert("companies", {
      name,
      slug: slugify(name),
      tier,
      description:
        tier === "Curated company"
          ? "Curated non-sponsor candidate for high-value product and technical conversations."
          : `${name} hosts targeted 1:1 meetings for AI engineering teams and buyers.`,
      contactEmail: `${slugify(name)}@aiewf.test`,
      hostNames: [`${name} host`],
      topics: topics.split(";"),
      wantsToMeet: ["technical buyers", "enterprise leaders", "AI engineers"],
      sponsor: tier !== "Curated company",
      optedIn: tier !== "Curated company",
      priority: index + 1,
      notes: tier === "Curated company" ? "Admin approval required." : "",
      updatedAt: timestamp,
    });
  }

  await ctx.db.insert("accounts", {
    email: "admin@aiewf.test",
    displayName: "AIE Room Admin",
    role: "admin",
    title: "Networking room operator",
    active: true,
    updatedAt: timestamp,
  });

  for (const companyName of ["Microsoft", "OpenAI", "Braintrust", "Browserbase"]) {
    await ctx.db.insert("accounts", {
      email: `${slugify(companyName)}@aiewf.test`,
      displayName: `${companyName} host`,
      role: "company",
      title: "Company meeting host",
      companyId: companyIds[companyName],
      active: true,
      updatedAt: timestamp,
    });
  }

  const attendeeSeeds = [
    ["Priya Raman", "priya@leadership.test", "VP AI Platform, Northstar Bank", "Leadership Track"],
    ["Mateo Alvarez", "mateo@quality.test", "Head of Data Quality, RetailGrid", "Data Quality"],
    ["Lena Ortiz", "lena@leadership.test", "Founder, EvalForge", "Leadership Track"],
    ["Kai Tan", "kai@quality.test", "Staff AI Engineer, Portside", "Data Quality"],
  ];
  const attendeeIds: Record<string, Id<"accounts">> = {};
  for (const [displayName, email, title, track] of attendeeSeeds) {
    attendeeIds[displayName] = await ctx.db.insert("accounts", {
      email,
      displayName,
      role: "attendee",
      title,
      track,
      active: true,
      updatedAt: timestamp,
    });
  }

  for (const companyId of Object.values(companyIds)) {
    for (const date of EVENT_DATES) {
      for (const availabilityWindow of DEFAULT_AVAILABILITY_WINDOWS) {
        await ctx.db.insert("availability", {
          companyId,
          date,
          ...availabilityWindow,
          updatedAt: timestamp,
        });
      }
    }
  }

  const acceptedRequestId = await ctx.db.insert("meetingRequests", {
    attendeeAccountId: attendeeIds["Lena Ortiz"],
    companyId: companyIds.Braintrust,
    date: "2026-06-30",
    preferredStartMinute: 10 * 60 + 40,
    alternateStartMinute: 14 * 60,
    reason: "Compare eval workflows for a production agent launch.",
    context:
      "EvalForge is looking for data-quality partners and wants a practical eval stack discussion.",
    status: "accepted",
    origin: "attendee_request",
    createdByAccountId: attendeeIds["Lena Ortiz"],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const meetingId = await ctx.db.insert("meetings", {
    requestId: acceptedRequestId,
    attendeeAccountId: attendeeIds["Lena Ortiz"],
    companyId: companyIds.Braintrust,
    date: "2026-06-30",
    startMinute: 10 * 60 + 40,
    endMinute: 11 * 60,
    tableNumber: 1,
    status: "confirmed",
    context: "Accepted seed meeting",
    updatedAt: timestamp,
  });
  await ctx.db.patch(acceptedRequestId, { meetingId });

  await ctx.db.insert("meetingRequests", {
    attendeeAccountId: attendeeIds["Priya Raman"],
    companyId: companyIds.OpenAI,
    date: "2026-06-30",
    preferredStartMinute: 11 * 60 + 20,
    alternateStartMinute: 14 * 60 + 20,
    reason: "Discuss enterprise agent deployment patterns.",
    context:
      "Northstar Bank is evaluating agent platforms for internal engineering workflows.",
    status: "pending",
    origin: "attendee_request",
    createdByAccountId: attendeeIds["Priya Raman"],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await ctx.db.insert("meetingRequests", {
    attendeeAccountId: attendeeIds["Mateo Alvarez"],
    companyId: companyIds.Microsoft,
    date: "2026-07-01",
    preferredStartMinute: 11 * 60,
    alternateStartMinute: 14 * 60,
    reason: "Data governance and quality review for customer-facing copilots.",
    context:
      "RetailGrid wants to compare enterprise quality gates for AI deployments.",
    status: "countered",
    counterStartMinute: 14 * 60 + 20,
    responseNote: "Morning is full. Afternoon host is available at 2:20 PM.",
    origin: "attendee_request",
    createdByAccountId: attendeeIds["Mateo Alvarez"],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await ctx.db.insert("deskMatchRequests", {
    attendeeAccountId: attendeeIds["Kai Tan"],
    date: "2026-06-30",
    preferredStartMinute: 11 * 60,
    intent: "Find someone working on production observability for agent systems.",
    topics: ["observability", "agents", "production AI"],
    status: "requested",
    note: "Seed concierge request for the desk queue.",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export const ensureDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await getSettings(ctx);
    if (existing) return { seeded: false, reason: "already_seeded" };
    await insertDemoData(ctx);
    return { seeded: true, reason: "created_demo_data" };
  },
});

export const resetDemoData = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
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
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });
    return { reset: true, token };
  },
});

export const listDemoAccounts = query({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").take(100);
    return accounts
      .filter((account) => account.active)
      .map((account) => ({
        _id: account._id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        title: account.title,
        track: account.track ?? null,
        companyId: account.companyId ?? null,
      }));
  },
});

export const startDemoSession = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .unique();
    if (!account || !account.active) throw new Error("Demo account not found.");
    const token = tokenValue();
    await ctx.db.insert("demoSessions", {
      token,
      accountId: account._id,
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });
    return { token, account };
  },
});

export const getBootstrap = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    const settings = await getSettings(ctx);
    const allAccounts = await ctx.db.query("accounts").take(100);
    const allCompanies = await ctx.db.query("companies").take(200);

    const companies =
      actor.role === "admin"
        ? allCompanies
        : allCompanies.filter(
            (company) => company.optedIn || company._id === actor.companyId,
          );
    const visibleCompanyIds = new Set(companies.map((company) => company._id));

    const availability =
      actor.role === "admin"
        ? await ctx.db.query("availability").take(500)
        : (await ctx.db.query("availability").take(500)).filter((window) =>
            visibleCompanyIds.has(window.companyId),
          );

    let requests: Array<Doc<"meetingRequests">> = [];
    let meetings: Array<Doc<"meetings">> = [];
    let deskRequests: Array<Doc<"deskMatchRequests">> = [];

    if (actor.role === "admin") {
      requests = await ctx.db.query("meetingRequests").take(300);
      meetings = await ctx.db.query("meetings").take(300);
      deskRequests = await ctx.db.query("deskMatchRequests").take(200);
    } else if (actor.role === "company" && actor.companyId) {
      for (const date of EVENT_DATES) {
        requests.push(
          ...(await ctx.db
            .query("meetingRequests")
            .withIndex("by_companyId_and_date", (q) =>
              q.eq("companyId", actor.companyId as Id<"companies">).eq("date", date),
            )
            .take(100)),
        );
        meetings.push(...(await companyMeetingsForDay(ctx, actor.companyId, date)));
      }
    } else {
      for (const date of EVENT_DATES) {
        requests.push(...(await attendeeRequestsForDay(ctx, actor._id, date)));
        meetings.push(...(await attendeeMeetingsForDay(ctx, actor._id, date)));
      }
      deskRequests = await ctx.db
        .query("deskMatchRequests")
        .withIndex("by_attendeeAccountId", (q) => q.eq("attendeeAccountId", actor._id))
        .take(50);
    }

    const importBatches =
      actor.role === "admin"
        ? await ctx.db
            .query("importBatches")
            .withIndex("by_kind", (q) => q.eq("kind", "companies_csv"))
            .order("desc")
            .take(5)
        : [];
    const companiesById = new Map(allCompanies.map((company) => [company._id, company]));
    const accountsById = new Map(allAccounts.map((account) => [account._id, account]));
    const meetingsById = new Map(meetings.map((meeting) => [meeting._id, meeting]));

    return {
      settings,
      actor,
      accounts: allAccounts
        .filter((account) => account.active)
        .map((account) => ({
          _id: account._id,
          email: account.email,
          displayName: account.displayName,
          role: account.role,
          title: account.title,
          track: account.track ?? null,
          companyId: account.companyId ?? null,
        })),
      companies,
      availability,
      requests: requests.map((request) => ({
        ...request,
        company: companiesById.get(request.companyId) ?? null,
        attendee: accountsById.get(request.attendeeAccountId) ?? null,
        meeting: request.meetingId ? meetingsById.get(request.meetingId) ?? null : null,
      })),
      meetings: meetings.map((meeting) => ({
        ...meeting,
        company: companiesById.get(meeting.companyId) ?? null,
        attendee: accountsById.get(meeting.attendeeAccountId) ?? null,
        request: requests.find((request) => request._id === meeting.requestId) ?? null,
      })),
      deskRequests: deskRequests.map((deskRequest) => ({
        ...deskRequest,
        attendee: accountsById.get(deskRequest.attendeeAccountId) ?? null,
        suggestedCompany: deskRequest.suggestedCompanyId
          ? companiesById.get(deskRequest.suggestedCompanyId) ?? null
          : null,
        meetingRequest: deskRequest.meetingRequestId
          ? requests.find((request) => request._id === deskRequest.meetingRequestId) ?? null
          : null,
      })),
      importBatches,
      slotLabels: settings
        ? Array.from(
            {
              length: Math.floor(
                (settings.dayEndMinute - settings.dayStartMinute) /
                  settings.slotMinutes,
              ),
            },
            (_, index) => {
              const minute = settings.dayStartMinute + index * settings.slotMinutes;
              return { minute, label: minuteLabel(minute) };
            },
          )
        : [],
    };
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
    const [companies, availability, meetings, pendingRequests] = await Promise.all([
      ctx.db
        .query("companies")
        .withIndex("by_optedIn", (q) => q.eq("optedIn", true))
        .take(200),
      ctx.db
        .query("availability")
        .withIndex("by_date", (q) => q.eq("date", args.date))
        .take(500),
      ctx.db
        .query("meetings")
        .withIndex("by_date_and_startMinute", (q) => q.eq("date", args.date))
        .take(500),
      ctx.db
        .query("meetingRequests")
        .withIndex("by_date_and_status", (q) =>
          q.eq("date", args.date).eq("status", "pending"),
        )
        .take(500),
    ]);

    const activeMeetings = meetings.filter((meeting) => meeting.status !== "cancelled");
    const accounts = await Promise.all(
      Array.from(new Set(activeMeetings.map((meeting) => meeting.attendeeAccountId))).map((id) =>
        ctx.db.get(id),
      ),
    );
    const companiesById = new Map(companies.map((company) => [company._id, company]));
    const accountsById = new Map(
      accounts.filter((account): account is Doc<"accounts"> => Boolean(account)).map((account) => [
        account._id,
        account,
      ]),
    );
    const requestCountByCompany = new Map<Id<"companies">, number>();
    for (const request of pendingRequests) {
      requestCountByCompany.set(
        request.companyId,
        (requestCountByCompany.get(request.companyId) ?? 0) + 1,
      );
    }

    const slotMinutes = settings.slotMinutes;
    const slotStarts = Array.from(
      { length: Math.floor((settings.dayEndMinute - settings.dayStartMinute) / slotMinutes) },
      (_, index) => settings.dayStartMinute + index * slotMinutes,
    );

    const opportunities = companies
      .slice()
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .flatMap((company) => {
        const companyWindows = availability.filter((window) => window.companyId === company._id);
        const companyMeetings = activeMeetings.filter(
          (meeting) => meeting.companyId === company._id,
        );
        const openSlot = slotStarts.find((slotStart) => {
          if (slotStart < displayNowMinute) return false;
          const inWindow = companyWindows.some(
            (window) =>
              slotStart >= window.startMinute &&
              slotStart + slotMinutes <= window.endMinute,
          );
          if (!inWindow) return false;
          return !companyMeetings.some((meeting) =>
            overlaps(meeting, slotStart, slotMinutes),
          );
        });

        if (openSlot === undefined) return [];
        return [
          {
            companyId: company._id,
            companyName: company.name,
            tier: company.tier,
            hostNames: company.hostNames.slice(0, 2),
            topics: company.topics.slice(0, 3),
            startMinute: openSlot,
            label: minuteLabel(openSlot),
            pendingRequests: requestCountByCompany.get(company._id) ?? 0,
          },
        ];
      })
      .slice(0, 8);

    const nextMeetings = activeMeetings
      .filter((meeting) => meeting.endMinute > displayNowMinute)
      .sort(
        (a, b) =>
          a.startMinute - b.startMinute ||
          a.tableNumber - b.tableNumber ||
          a.companyId.localeCompare(b.companyId),
      )
      .slice(0, 10)
      .map((meeting) => {
        const company = companiesById.get(meeting.companyId);
        const attendee = accountsById.get(meeting.attendeeAccountId);
        return {
          meetingId: meeting._id,
          tableNumber: meeting.tableNumber,
          startMinute: meeting.startMinute,
          endMinute: meeting.endMinute,
          label: minuteLabel(meeting.startMinute),
          status: meeting.status,
          companyName: company?.name ?? "Company",
          attendeeName: attendee?.displayName ?? "Attendee",
          attendeeTitle: attendee?.title ?? "",
        };
      });

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
      },
      date: args.date,
      nowMinute: displayNowMinute,
      nowLabel: minuteLabel(displayNowMinute),
      counts: {
        live: liveMeetings.length,
        upcoming: nextMeetings.length,
        openCompanies: companies.length,
        pendingRequests: pendingRequests.length,
      },
      nextMeetings,
      opportunities,
    };
  },
});

export const createDeskMatchRequest = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    preferredStartMinute: v.number(),
    intent: v.string(),
    topics: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    if (actor.role !== "attendee") throw new Error("Only attendees can ask the desk for a match.");
    if (args.intent.trim().length < 8) throw new Error("Tell the desk what you want to meet about.");
    assertValidEventDate(args.date);
    assertSlotInDay(settings, args.preferredStartMinute);

    const existing = await ctx.db
      .query("deskMatchRequests")
      .withIndex("by_attendeeAccountId", (q) => q.eq("attendeeAccountId", actor._id))
      .take(50);
    if (
      existing.some(
        (request) =>
          request.date === args.date &&
          (request.status === "requested" || request.status === "matched"),
      )
    ) {
      throw new Error("You already have an open desk match request for this date.");
    }

    return await ctx.db.insert("deskMatchRequests", {
      attendeeAccountId: actor._id,
      date: args.date,
      preferredStartMinute: args.preferredStartMinute,
      intent: args.intent.trim(),
      topics: splitList(args.topics),
      status: "requested",
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

export const assignDeskMatch = mutation({
  args: {
    sessionToken: v.string(),
    deskMatchRequestId: v.id("deskMatchRequests"),
    companyId: v.id("companies"),
    preferredStartMinute: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const deskRequest = await ctx.db.get(args.deskMatchRequestId);
    if (!deskRequest) throw new Error("Desk match request not found.");
    if (deskRequest.status !== "requested") {
      throw new Error("Desk match request is no longer open.");
    }
    assertValidEventDate(deskRequest.date);
    assertSlotInDay(settings, args.preferredStartMinute);

    const attendee = await ctx.db.get(deskRequest.attendeeAccountId);
    if (!attendee || !attendee.active || attendee.role !== "attendee") {
      throw new Error("Attendee account is no longer active.");
    }
    const company = await ctx.db.get(args.companyId);
    if (!company || !company.optedIn) throw new Error("Company is not available for matching.");
    if (
      !(await hasAvailability(
        ctx,
        args.companyId,
        deskRequest.date,
        args.preferredStartMinute,
        settings.slotMinutes,
      ))
    ) {
      throw new Error("Selected time is outside company availability.");
    }
    if (
      await hasCompanyMeetingConflict(
        ctx,
        args.companyId,
        deskRequest.date,
        args.preferredStartMinute,
        settings.slotMinutes,
      )
    ) {
      throw new Error("Company already has a meeting at that time.");
    }
    if (
      await hasAttendeeMeetingConflict(
        ctx,
        deskRequest.attendeeAccountId,
        deskRequest.date,
        args.preferredStartMinute,
        settings.slotMinutes,
      )
    ) {
      throw new Error("Attendee already has a meeting at that time.");
    }
    const existingRequests = await activeAttendeeCompanyRequestsForDay(
      ctx,
      deskRequest.attendeeAccountId,
      args.companyId,
      deskRequest.date,
    );
    if (existingRequests.length > 0) {
      throw new Error("Attendee already has an open request with that company.");
    }

    const meetingRequestId = await ctx.db.insert("meetingRequests", {
      attendeeAccountId: deskRequest.attendeeAccountId,
      companyId: args.companyId,
      date: deskRequest.date,
      preferredStartMinute: args.preferredStartMinute,
      reason: deskRequest.intent,
      context:
        args.note?.trim() ||
        `Desk suggested ${company.name} for ${attendee.displayName}.`,
      status: "pending",
      origin: "desk_queue",
      createdByAccountId: actor._id,
      ...(args.note?.trim() ? { adminNote: args.note.trim() } : {}),
      createdAt: now(),
      updatedAt: now(),
    });

    await ctx.db.patch(deskRequest._id, {
      status: "matched",
      suggestedCompanyId: args.companyId,
      meetingRequestId,
      note: args.note?.trim() || `Suggested ${company.name}.`,
      updatedAt: now(),
    });
    return { matched: true, meetingRequestId };
  },
});

export const updateDeskMatchStatus = mutation({
  args: {
    sessionToken: v.string(),
    deskMatchRequestId: v.id("deskMatchRequests"),
    status: deskMatchStatusValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    const deskRequest = await ctx.db.get(args.deskMatchRequestId);
    if (!deskRequest) throw new Error("Desk match request not found.");
    if (actor.role !== "admin" && deskRequest.attendeeAccountId !== actor._id) {
      throw new Error("Only the requesting attendee or admin can update this request.");
    }
    await ctx.db.patch(deskRequest._id, { status: args.status, updatedAt: now() });
    return { updated: true };
  },
});

export const createRequest = mutation({
  args: {
    sessionToken: v.string(),
    companyId: v.id("companies"),
    date: v.string(),
    preferredStartMinute: v.number(),
    alternateStartMinute: v.optional(v.number()),
    reason: v.string(),
    context: v.string(),
  },
  handler: async (ctx, args) => {
    const settings = await requireSettings(ctx);
    const actor = await requireActor(ctx, args.sessionToken);
    if (actor.role !== "attendee") throw new Error("Only attendee accounts can request meetings.");
    if (args.reason.trim().length < 8) throw new Error("Add a specific meeting reason.");
    assertValidEventDate(args.date);
    assertSlotInDay(settings, args.preferredStartMinute);
    if (args.alternateStartMinute !== undefined) assertSlotInDay(settings, args.alternateStartMinute);

    const company = await ctx.db.get(args.companyId);
    if (!company || !company.optedIn) throw new Error("Company is not available for requests.");

    const requests = await attendeeRequestsForDay(ctx, actor._id, args.date);
    if (
      requests.filter(
        (request) => request.status !== "cancelled" && request.status !== "declined",
      ).length >=
      settings.attendeeRequestCapPerDay
    ) {
      throw new Error("Daily attendee request cap reached.");
    }
    const existingRequests = await activeAttendeeCompanyRequestsForDay(
      ctx,
      actor._id,
      args.companyId,
      args.date,
    );
    if (existingRequests.length > 0) {
      throw new Error("You already have an open request with this company for this date.");
    }
    if (
      !(await hasAvailability(
        ctx,
        args.companyId,
        args.date,
        args.preferredStartMinute,
        settings.slotMinutes,
      ))
    ) {
      throw new Error("Preferred time is outside company availability.");
    }

    return await ctx.db.insert("meetingRequests", {
      attendeeAccountId: actor._id,
      companyId: args.companyId,
      date: args.date,
      preferredStartMinute: args.preferredStartMinute,
      ...(args.alternateStartMinute !== undefined
        ? { alternateStartMinute: args.alternateStartMinute }
        : {}),
      reason: args.reason.trim(),
      context: args.context.trim(),
      status: "pending",
      origin: "attendee_request",
      createdByAccountId: actor._id,
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

export const respondToRequest = mutation({
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
    if (!isCompanyOperator(actor, request.companyId)) throw new Error("Company or admin access required.");
    if (
      request.status === "accepted" ||
      request.status === "cancelled" ||
      request.status === "declined"
    ) {
      throw new Error("Request can no longer be changed.");
    }

    if (args.action === "decline") {
      await ctx.db.patch(request._id, {
        status: "declined",
        responseNote: args.note?.trim() || "Declined by host.",
        respondedByAccountId: actor._id,
        updatedAt: now(),
      });
      return { status: "declined" };
    }

    if (args.action === "counter") {
      if (!settings.allowCounters) throw new Error("Counter-proposals are disabled.");
      if (args.counterStartMinute === undefined) throw new Error("Counter time required.");
      await assertBookableSlot(ctx, settings, request, args.counterStartMinute);
      await ctx.db.patch(request._id, {
        status: "countered",
        counterStartMinute: args.counterStartMinute,
        responseNote: args.note?.trim() || `Countered to ${minuteLabel(args.counterStartMinute)}.`,
        respondedByAccountId: actor._id,
        updatedAt: now(),
      });
      return { status: "countered" };
    }

    let acceptedStartMinute = request.preferredStartMinute;
    if (request.status === "countered") {
      if (request.counterStartMinute === undefined) {
        throw new Error("Request does not have a counter-proposal.");
      }
      acceptedStartMinute = request.counterStartMinute;
    }
    const responseNote = args.note?.trim() || "Accepted by host.";
    const meetingId = await createConfirmedMeeting(
      ctx,
      settings,
      request,
      acceptedStartMinute,
      responseNote,
    );
    await ctx.db.patch(request._id, {
      status: "accepted",
      meetingId,
      responseNote,
      respondedByAccountId: actor._id,
      updatedAt: now(),
    });
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
    if (actor.role !== "attendee" || request.attendeeAccountId !== actor._id) {
      throw new Error("Only the requesting attendee can confirm a counter.");
    }
    if (request.status !== "countered" || request.counterStartMinute === undefined) {
      throw new Error("Request does not have a counter-proposal.");
    }
    const meetingId = await createConfirmedMeeting(
      ctx,
      settings,
      request,
      request.counterStartMinute,
      "Counter accepted by attendee.",
    );
    await ctx.db.patch(request._id, { status: "accepted", meetingId, updatedAt: now() });
    return { status: "accepted", meetingId };
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
    attendeeRequestCapPerDay: v.number(),
    companyAcceptCapPerDay: v.number(),
    allowCounters: v.boolean(),
    sponsorsOnlyDefault: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    const settings = await requireSettings(ctx);
    validateMinuteOfDay("dayStartMinute", args.dayStartMinute);
    validateMinuteOfDay("dayEndMinute", args.dayEndMinute);
    validatePositiveInteger("slotMinutes", args.slotMinutes);
    validatePositiveInteger("activeTables", args.activeTables);
    validatePositiveInteger("reserveTables", args.reserveTables);
    validatePositiveInteger("attendeeRequestCapPerDay", args.attendeeRequestCapPerDay);
    validatePositiveInteger("companyAcceptCapPerDay", args.companyAcceptCapPerDay);
    if (args.dayEndMinute <= args.dayStartMinute) throw new Error("End time must be after start time.");
    if ((args.dayEndMinute - args.dayStartMinute) % args.slotMinutes !== 0) {
      throw new Error("Meeting window must divide evenly into slot length.");
    }
    await ctx.db.patch(settings._id, {
      dayStartMinute: args.dayStartMinute,
      dayEndMinute: args.dayEndMinute,
      slotMinutes: args.slotMinutes,
      activeTables: args.activeTables,
      reserveTables: args.reserveTables,
      attendeeRequestCapPerDay: args.attendeeRequestCapPerDay,
      companyAcceptCapPerDay: args.companyAcceptCapPerDay,
      allowCounters: args.allowCounters,
      sponsorsOnlyDefault: args.sponsorsOnlyDefault,
      updatedAt: now(),
    });
    return { updated: true };
  },
});

export const setCompanyOptIn = mutation({
  args: {
    sessionToken: v.string(),
    companyId: v.id("companies"),
    optedIn: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    await ctx.db.patch(args.companyId, { optedIn: args.optedIn, updatedAt: now() });
    if (args.optedIn) {
      await ensureDefaultAvailability(ctx, args.companyId);
    }
    return { updated: true };
  },
});

export const upsertCompaniesFromRows = mutation({
  args: {
    sessionToken: v.string(),
    rows: v.array(
      v.object({
        name: v.string(),
        tier: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        hostNames: v.optional(v.string()),
        topics: v.optional(v.string()),
        wantsToMeet: v.optional(v.string()),
        sponsor: v.optional(v.boolean()),
        optedIn: v.optional(v.boolean()),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.sessionToken);
    requireAdmin(actor);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import is limited to ${MAX_IMPORT_ROWS} rows per batch.`);
    }
    let inserted = 0;
    let updated = 0;

    for (const row of args.rows) {
      const name = row.name.trim();
      if (!name) continue;
      const slug = slugify(name);
      if (!slug) throw new Error(`Company name "${name}" must include letters or numbers.`);
      const existing = await ctx.db
        .query("companies")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      const fields = {
        name,
        slug,
        tier: row.tier?.trim() || "Imported",
        description: row.description?.trim() || "Imported company awaiting admin enrichment.",
        contactEmail: normalizeEmail(row.contactEmail || `${slug}@aiewf.test`),
        hostNames: splitList(row.hostNames),
        topics: splitList(row.topics),
        wantsToMeet: splitList(row.wantsToMeet),
        sponsor: row.sponsor ?? true,
        optedIn: row.optedIn ?? false,
        priority: existing?.priority ?? 50,
        notes: existing?.notes ?? "Imported from admin CSV paste.",
        updatedAt: now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        if (fields.optedIn) {
          await ensureDefaultAvailability(ctx, existing._id);
        }
        updated += 1;
      } else {
        const companyId = await ctx.db.insert("companies", fields);
        if (fields.optedIn) {
          await ensureDefaultAvailability(ctx, companyId);
        }
        inserted += 1;
      }
    }

    await ctx.db.insert("importBatches", {
      importedByAccountId: actor._id,
      kind: "companies_csv",
      rowCount: args.rows.length,
      summary: `${inserted} inserted, ${updated} updated`,
      createdAt: now(),
    });
    return { inserted, updated };
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
    const settings = await requireSettings(ctx);
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    if (!isCompanyOperator(actor, meeting.companyId)) throw new Error("Company or admin access required.");

    if (meeting.status === "cancelled" && args.status !== "cancelled") {
      requireAdmin(actor);
      if (args.status !== "confirmed") {
        throw new Error("Cancelled meetings can only be restored to confirmed.");
      }
      const request = await ctx.db.get(meeting.requestId);
      if (!request) throw new Error("Linked request not found.");
      await assertBookableSlot(ctx, settings, request, meeting.startMinute, meeting._id);
      if (
        await hasTableConflict(
          ctx,
          meeting.date,
          meeting.tableNumber,
          meeting.startMinute,
          settings.slotMinutes,
          meeting._id,
        )
      ) {
        throw new Error("Table is already occupied at that time.");
      }
      await ctx.db.patch(request._id, { status: "accepted", meetingId: meeting._id, updatedAt: now() });
    }

    await ctx.db.patch(args.meetingId, { status: args.status, updatedAt: now() });
    if (args.status === "cancelled") {
      await ctx.db.patch(meeting.requestId, { status: "cancelled", updatedAt: now() });
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
    const request = await ctx.db.get(meeting.requestId);
    if (!request) throw new Error("Linked request not found.");
    const maxTable = settings.activeTables + settings.reserveTables;
    if (
      !Number.isInteger(args.tableNumber) ||
      args.tableNumber < 1 ||
      args.tableNumber > maxTable
    ) {
      throw new Error("Table is outside configured inventory.");
    }
    assertSlotInDay(settings, args.startMinute);
    await assertBookableSlot(ctx, settings, request, args.startMinute, meeting._id);
    if (
      await hasTableConflict(
        ctx,
        meeting.date,
        args.tableNumber,
        args.startMinute,
        settings.slotMinutes,
        meeting._id,
      )
    ) {
      throw new Error("Table is already occupied at that time.");
    }
    await ctx.db.patch(args.meetingId, {
      startMinute: args.startMinute,
      endMinute: args.startMinute + settings.slotMinutes,
      tableNumber: args.tableNumber,
      updatedAt: now(),
    });
    return { updated: true };
  },
});
