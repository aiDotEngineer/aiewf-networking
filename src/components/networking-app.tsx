"use client";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { participantProfilesByLookupKey } from "@/lib/participant-profile-data";
import {
  mergeParticipantProfile,
  profileLookupKey,
  profileSearchText,
  sourceCount,
  type DisplayParticipantProfile,
  type ParticipantProfileOverride,
  type ProfileSource,
} from "@/lib/participant-profiles";
import { speakerScheduleMap, type SpeakerScheduleInfo } from "@/lib/worldsfair-speaker-schedule";
import { speakerTrackMap } from "@/lib/worldsfair-speaker-tracks";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  CalendarDays,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Database,
  Download,
  Gauge,
  Import,
  Lightbulb,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Menu,
  Monitor,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Table2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { FormEvent, ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

type Account = {
  _id: Id<"accounts">;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  role: "admin" | "participant";
  title: string;
  company: string;
  ticketType: string;
  ticketCategory: "leadership" | "speaker" | "sponsor" | "other";
  registrationStatus: string;
  profileImageUrl: string;
  city: string;
  country: string;
  companySize: string;
  networkingIntent: string;
  topics: string[];
  signedUp: boolean;
  directoryOptIn: boolean;
  profileComplete: boolean;
  hasAvailability: boolean;
  active: boolean;
  profileOverride: ParticipantProfileOverride | null;
};
type DemoAccount = Pick<Account, "_id" | "email" | "displayName" | "role" | "title" | "company" | "signedUp" | "directoryOptIn">;
type Settings = Doc<"eventSettings">;
type AvailabilitySlot = Doc<"participantAvailability"> & {
  participantCount?: number;
  groupOpen?: boolean;
};
type MeetingParticipant = Doc<"meetingParticipants"> & { account: Account | null };
type Meeting = Doc<"meetings"> & {
  host: Account | null;
  participants: MeetingParticipant[];
};
type MeetingRequest = Doc<"meetingRequests"> & {
  requester: Account | null;
  target: Account | null;
  meeting: Meeting | null;
};
type MeetingInterest = Doc<"meetingInterests"> & {
  requester: Account | null;
  target: Account | null;
  meeting: Meeting | null;
};
type ImportBatch = Doc<"importBatches">;
type Bootstrap = {
  settings: Settings;
  actor: Account;
  participants: Array<Account | null>;
  myAvailability: AvailabilitySlot[];
  requests: MeetingRequest[];
  interests: MeetingInterest[];
  meetings: Meeting[];
  importBatches: ImportBatch[];
  slotLabels: Array<{ minute: number; label: string }>;
};
type AdminParticipantsResult = {
  participants: Array<Account | null>;
  limit: number;
  totalMatches: number;
  hasMore: boolean;
};
type DirectoryPreviewParticipantsResult = Array<Account | null>;
type PublicConfig = {
  settings: Settings | null;
  demoLoginEnabled: boolean;
};
type RoomDisplayData = {
  settings: {
    eventName: string;
    roomName: string;
    activeTables: number;
    slotMinutes: number;
    maxMeetingGroupSize: number;
  };
  date: string;
  nowMinute: number;
  nowLabel: string;
  counts: {
    live: number;
    upcoming: number;
    pendingRequests: number;
    openTables: number;
  };
  nextMeetings: Array<{
    meetingId: Id<"meetings">;
    tableNumber: number;
    startMinute: number;
    endMinute: number;
    label: string;
    status: string;
    participantCount: number;
    participants: Array<Account | null>;
  }>;
};
type View = "directory" | "profile" | "requests" | "schedule" | "admin" | "display";
type RunAction = (task: () => Promise<unknown>, success: string) => Promise<boolean>;
type RequestMode = "slot" | "interest";
type DirectorySort = "recommended" | "company" | "name";
type DirectoryViewMode = "company" | "people";
type ProfileFilter = "all" | "researched" | "pending";
type MatchSignal = {
  reasons: string[];
  score: number;
};
type DirectoryItem = {
  match: MatchSignal;
  participant: Account;
  profile: DisplayParticipantProfile | null;
  rank: number;
  searchText: string;
  tracks: TrackSignal[];
};
type ActionReadiness = {
  detail: string;
  ready: boolean;
  title: string;
};
type TrackSignal = {
  keyword: string;
  name: string;
};
type CompanyGroup = {
  company: string;
  description: string;
  items: DirectoryItem[];
  sourceTotal: number;
  tracks: string[];
};

const sessionStorageKey = "aiewf-networking-session";

const dateLabels: Record<string, string> = {
  "2026-06-30": "Tue Jun 30",
  "2026-07-01": "Wed Jul 1",
};

const statusStyles: Record<string, string> = {
  pending: "border-yellow-300/30 bg-yellow-300/10 text-yellow-100",
  countered: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  accepted: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  confirmed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  completed: "border-white/15 bg-white/10 text-white/75",
  declined: "border-white/10 bg-white/5 text-white/55",
  cancelled: "border-red-300/30 bg-red-300/10 text-red-100",
  no_show: "border-red-300/30 bg-red-300/10 text-red-100",
  speaker: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  leadership: "border-[#f8e18e]/35 bg-[#f8e18e]/10 text-[#f8e18e]",
  sponsor: "border-violet-300/30 bg-violet-300/10 text-violet-100",
  other: "border-white/10 bg-white/5 text-white/55",
  opted_in: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  hidden: "border-white/10 bg-white/5 text-white/55",
};

const participantCsvHeaders = new Set([
  "Profile Picture",
  "First Name",
  "Last Name",
  "Email",
  "Registration Status",
  "Ticket Type",
  "Company",
  "Title",
  "Holder Text Block 2",
  "Holder Company Size",
  "Holder Job Title",
  "Holder State",
  "Holder Company Name",
  "Holder Country",
  "Holder City",
  "Buyer Email",
  "Holder Email",
  "Buyer Last Name",
  "Holder Last Name",
  "Buyer First Name",
  "Holder First Name",
  "UTM Referrer",
  "UTM Campaign",
  "UTM Medium",
  "UTM Source",
]);

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function minuteLabel(minute: number) {
  const hour = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

function eventDateEntries(settings: Settings) {
  return [settings.startDate, settings.endDate]
    .filter((date, index, dates) => dates.indexOf(date) === index)
    .map((date) => [date, dateLabels[date] ?? date] as const);
}

function editedAtLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}

function sourceLines(sources: ProfileSource[]) {
  return sources.map((source) => [source.label, source.url, source.note].join(" | ")).join("\n");
}

function userFacingError(error: unknown) {
  if (!(error instanceof Error)) return "Action failed.";
  const raw = error.message.trim();
  const convexMessage = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n| at | Called by client|$)/);
  return (convexMessage?.[1] ?? raw).trim();
}

function activeOutgoingStatus(status: MeetingRequest["status"]) {
  return status === "pending" || status === "countered" || status === "accepted";
}

function csvDownload(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsvTable(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseParticipantCsv(text: string): { rows: Array<Record<string, string>>; error: string | null } {
  const table = parseCsvTable(text);
  if (table.length < 2) return { rows: [], error: "CSV needs a header row and at least one participant row." };
  const headers = table[0].map((header) => header.trim());
  const missingRequired = ["Email", "Holder Email", "Ticket Type"].every((header) => !headers.includes(header));
  if (missingRequired) return { rows: [], error: "CSV must include Email or Holder Email plus ticket data." };
  const unknownHeader = headers.find((header) => header && !participantCsvHeaders.has(header));
  if (unknownHeader) return { rows: [], error: `Unknown CSV column: ${unknownHeader}.` };
  return {
    rows: table.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ),
    error: null,
  };
}

function visibleAccounts(accounts: Array<Account | null> | undefined) {
  return (accounts ?? []).filter((account): account is Account => Boolean(account));
}

function participantProfileFor(account: Account): DisplayParticipantProfile | null {
  const profile = participantProfilesByLookupKey.get(profileLookupKey(account.email));
  return profile ? mergeParticipantProfile(profile, account.profileOverride) : null;
}

function profileBadgeLabel(profile: DisplayParticipantProfile | null) {
  if (!profile) return null;
  if (profile.displayParticipantApproved) return "participant approved";
  return profile.override ? "participant edited" : "AI researched";
}

const genericMatchWords = new Set([
  "ai",
  "and",
  "the",
  "for",
  "with",
  "engineer",
  "engineering",
  "founder",
  "head",
  "lead",
  "senior",
  "director",
  "manager",
  "platform",
  "product",
  "software",
]);

const lowValueDiscoveryTags = new Set([
  "astro",
  "dev",
  "developer",
  "developers",
  "development",
  "devrel",
  "developer relations",
  "developer experience",
  "web",
  "web development",
]);

const trackCatalog: Array<{ keywords: string[]; name: string }> = [
  { name: "Software Factories", keywords: ["software factory", "software factories", "coding agent", "codegen", "ai coding", "sdlc", "developer platform", "dev tools", "github", "warp", "factory"] },
  { name: "Claws & Personal Agents", keywords: ["personal agent", "assistant", "agentic assistant", "claws"] },
  { name: "Vision & OCR", keywords: ["vision", "ocr", "document ai", "image understanding", "multimodal", "computer vision"] },
  { name: "Search & Retrieval", keywords: ["search", "retrieval", "rag", "vector", "embedding", "semantic search", "rerank"] },
  { name: "Security", keywords: ["security", "secure", "compliance", "risk", "governance", "privacy", "trust", "safety"] },
  { name: "Voice & Realtime AI", keywords: ["voice", "realtime", "real-time", "speech", "audio", "conversation ai"] },
  { name: "LLM Recsys", keywords: ["recommendation", "recsys", "personalization", "ranking"] },
  { name: "Forward Deployed Engineering", keywords: ["forward deployed", "fde", "field engineering", "solutions engineering", "customer engineering"] },
  { name: "Data Quality", keywords: ["data quality", "data engineering", "data platform", "etl", "observability", "data governance"] },
  { name: "AI-Native Enterprises", keywords: ["enterprise ai", "ai transformation", "enterprise", "workflow automation", "business process"] },
  { name: "AI Architects", keywords: ["architecture", "architect", "workflow", "tokenmaxxing", "ai factory", "ai factories"] },
  { name: "Sandbox & Platform Engineering", keywords: ["sandbox", "platform engineering", "infrastructure", "cloud", "kubernetes", "runtime"] },
  { name: "Robotics & World Models", keywords: ["robotics", "robot", "world model", "simulation", "autonomous"] },
  { name: "Memory & Continual Learning", keywords: ["memory", "continual learning", "long-term memory", "knowledge graph"] },
  { name: "Evals", keywords: ["eval", "evals", "evaluation", "benchmark", "testing", "quality", "tracing", "trace"] },
  { name: "Design Engineering", keywords: ["design engineering", "ux", "product design", "design system", "prototype"] },
  { name: "Computer Use", keywords: ["computer use", "browser automation", "desktop automation", "operator", "ui automation"] },
  { name: "Context Engineering", keywords: ["context engineering", "prompt", "prompting", "context window", "agent context"] },
  { name: "Posttraining & Midtraining", keywords: ["posttraining", "post-training", "midtraining", "mid-training", "fine-tuning", "rlhf", "pre-training", "training"] },
  { name: "Generative Media", keywords: ["generative media", "video", "image generation", "media generation", "creative ai"] },
  { name: "Agentic Commerce", keywords: ["commerce", "shopping", "payments", "agentic commerce", "marketplace"] },
  { name: "AI in Finance", keywords: ["finance", "insurance", "bank", "trading", "fintech", "risk model"] },
  { name: "Local AI", keywords: ["local ai", "edge ai", "on-device", "offline", "ollama", "llama.cpp"] },
  { name: "Graphs", keywords: ["graph", "graphs", "knowledge graph", "neo4j"] },
  { name: "AI in GTM", keywords: ["gtm", "sales", "marketing", "growth", "customer success", "revenue"] },
  { name: "AI in Healthcare", keywords: ["healthcare", "clinical", "medical", "pharma", "biotech", "patient"] },
  { name: "Agentic Engineering", keywords: ["agentic engineering", "agent", "agents", "multi-agent", "agent orchestration", "workflow agent"] },
  { name: "Inference", keywords: ["inference", "serving", "gpu", "latency", "throughput", "model serving"] },
  { name: "Autoresearch", keywords: ["research agent", "autoresearch", "scientific discovery", "research automation"] },
  { name: "Harness Engineering", keywords: ["harness", "agent harness", "workflow harness", "orchestration"] },
  { name: "CTO Circle", keywords: ["cto", "vp engineering", "engineering leadership", "technical leadership"] },
];

const allTrackNames = [
  ...trackCatalog.map((track) => track.name),
  ...Object.values(speakerTrackMap).flat(),
].filter((track, index, tracks) => tracks.indexOf(track) === index).sort((a, b) => a.localeCompare(b));

const strategicCompanies = new Set([
  "adobe",
  "amazon",
  "aws",
  "apple",
  "capital one",
  "coreweave",
  "google",
  "google deepmind",
  "ibm",
  "jpmorgan chase",
  "meta",
  "microsoft",
  "nvidia",
  "openai",
  "oracle",
  "salesforce",
  "stripe",
]);

const aiNativeCompanies = new Set([
  "anthropic",
  "anysphere",
  "arcee ai",
  "cartesia ai",
  "cognition",
  "cursor",
  "decagon",
  "exa",
  "factory",
  "firecrawl",
  "harvey",
  "hugging face",
  "langchain",
  "mistral ai",
  "perplexity",
  "replit",
  "runway",
  "together ai",
  "vercel",
  "warp",
  "weights & biases",
]);

const vendorCompanyHints = [
  "agency",
  "consulting",
  "consultant",
  "services",
  "solutions",
  "systems integrator",
];

function matchTokens(...values: Array<string | string[] | undefined>) {
  return new Set(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !genericMatchWords.has(token) && !lowValueDiscoveryTags.has(token)),
  );
}

function normalizeDiscoveryText(...values: Array<string | string[] | undefined | null>) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value ?? ""]))
    .join(" ")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPersonKey(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackSignals(...values: Array<string | string[] | undefined | null>): TrackSignal[] {
  const text = ` ${normalizeDiscoveryText(...values)} `;
  const matches: TrackSignal[] = [];
  for (const track of trackCatalog) {
    const keyword = track.keywords.find((candidate) => text.includes(` ${candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
    if (keyword) matches.push({ keyword, name: track.name });
  }
  return matches;
}

function participantTracks(participant: Account, profile: DisplayParticipantProfile | null) {
  const officialSpeakerTracks = speakerTrackMap[normalizedPersonKey(participant.displayName)] ?? [];
  const inferredTracks = trackSignals(
    participant.title,
    participant.company,
    participant.networkingIntent,
    participant.topics,
    profile?.displayHeadline,
    profile?.displayBioMarkdown,
    profile?.displayTags,
    profile?.sources.primary.map((source) => `${source.label} ${source.note}`),
    profile?.sources.secondary.map((source) => `${source.label} ${source.note}`),
  );
  return [
    ...officialSpeakerTracks.map((name) => ({ keyword: "speaker schedule", name })),
    ...inferredTracks.filter((track) => !officialSpeakerTracks.includes(track.name)),
  ];
}

function participantSpeakerSchedule(participant: Account) {
  return speakerScheduleMap[normalizedPersonKey(participant.displayName)] ?? null;
}

function speakerScheduleLabel(schedule: SpeakerScheduleInfo) {
  const labels = schedule.dateLabels.filter(Boolean);
  if (labels.length === 0) return "speaking day TBD";
  if (labels.length === 1) return `speaks ${labels[0]}`;
  return `speaks ${labels.join(", ")}`;
}

function hasLowValueDiscoveryFocus(participant: Account, profile: DisplayParticipantProfile | null) {
  const text = normalizeDiscoveryText(
    participant.title,
    participant.networkingIntent,
    participant.topics,
    profile?.displayHeadline,
    profile?.displayTags,
  );
  return [
    "developer relations",
    "developer experience",
    "web development",
    "devrel",
    "astro",
  ].some((term) => text.includes(term));
}

function companyKey(company: string) {
  return normalizeDiscoveryText(company);
}

function privateDirectoryRank(
  participant: Account,
  profile: DisplayParticipantProfile | null,
  match: MatchSignal,
) {
  const company = companyKey(participant.company || profile?.company || "");
  const title = normalizeDiscoveryText(participant.title || profile?.title || "");
  const companyText = normalizeDiscoveryText(participant.company || profile?.company || "");
  let rank = match.score;

  if (/\b(ceo|chief executive|founder|cofounder|co founder|founding partner|managing partner)\b/.test(title)) rank += 24;
  if (/\b(cto|cio|ciso|chief technology|chief product|vp|vice president|head of|general manager)\b/.test(title)) rank += 14;
  if (/\b(principal|distinguished|staff|architect|director)\b/.test(title)) rank += 7;
  if (participant.ticketCategory === "speaker") rank += 8;
  if (participant.ticketCategory === "leadership") rank += 5;
  if (strategicCompanies.has(company)) rank += 18;
  if (aiNativeCompanies.has(company)) rank += 16;
  if (profile && sourceCount(profile) >= 5) rank += 5;
  if (profile?.confidence === "high") rank += 3;
  if (vendorCompanyHints.some((hint) => companyText.includes(hint))) rank -= 8;
  if (hasLowValueDiscoveryFocus(participant, profile)) rank -= 12;

  return rank;
}

function participantMatch(
  actor: Account,
  participant: Account,
  actorProfile: DisplayParticipantProfile | null,
  participantProfile: DisplayParticipantProfile | null,
): MatchSignal {
  const actorTokens = matchTokens(
    actor.title,
    actor.company,
    actor.networkingIntent,
    actor.topics,
    actorProfile?.displayHeadline,
    actorProfile?.displayTags,
  );
  const participantTokens = matchTokens(
    participant.title,
    participant.company,
    participant.networkingIntent,
    participant.topics,
    participantProfile?.displayHeadline,
    participantProfile?.displayBioMarkdown,
    participantProfile?.displayTags,
  );
  const overlaps = [...actorTokens].filter((token) => participantTokens.has(token)).slice(0, 4);
  const actorTrackNames = new Set(trackSignals(
    actor.title,
    actor.company,
    actor.networkingIntent,
    actor.topics,
    actorProfile?.displayHeadline,
    actorProfile?.displayBioMarkdown,
    actorProfile?.displayTags,
  ).map((track) => track.name));
  const participantTrackNames = participantTracks(participant, participantProfile).map((track) => track.name);
  const trackOverlaps = actorTrackNames.size
    ? participantTrackNames.filter((track) => actorTrackNames.has(track)).slice(0, 3)
    : participantTrackNames.slice(0, 2);
  const reasons: string[] = [];
  let score = 0;
  if (trackOverlaps.length) {
    score += trackOverlaps.length * 12;
    reasons.push(`tracks: ${trackOverlaps.join(", ")}`);
  }
  if (overlaps.length) {
    score += overlaps.length * 3;
    reasons.push(`shared: ${overlaps.join(", ")}`);
  }
  if (participantProfile) {
    const sources = sourceCount(participantProfile);
    score += Math.min(sources, 8);
    if (participantProfile.confidence === "high") score += 4;
  }
  if (participant.ticketCategory === "speaker") {
    score += 3;
    reasons.push("speaker");
  } else if (participant.ticketCategory === "leadership") {
    score += 1;
  }
  if (hasLowValueDiscoveryFocus(participant, participantProfile)) {
    score = Math.max(0, score - 16);
  }
  return { score, reasons: reasons.slice(0, 3) };
}

function meetingReasonSuggestions(
  actor: Account,
  participant: Account,
  actorProfile: DisplayParticipantProfile | null,
  participantProfile: DisplayParticipantProfile | null,
) {
  const actorTokens = matchTokens(actor.networkingIntent, actor.topics, actorProfile?.displayTags);
  const participantTokens = matchTokens(
    participant.networkingIntent,
    participant.topics,
    participantProfile?.displayHeadline,
    participantProfile?.displayTags,
  );
  const shared = [...actorTokens].filter((token) => participantTokens.has(token)).slice(0, 2);
  const topic = shared[0] ?? participantProfile?.displayTags[0] ?? participant.topics[0] ?? "AI work";
  return [
    `Would like to compare notes on ${topic}.`,
    `Your work at ${participant.company || "your company"} looks relevant to what I am building.`,
    `Interested in a quick intro around ${participantProfile?.displayHeadline || participant.title || "your current work"}.`,
  ];
}

function conversationStarters(
  actor: Account,
  participant: Account,
  actorProfile: DisplayParticipantProfile | null,
  participantProfile: DisplayParticipantProfile | null,
) {
  const suggestions = meetingReasonSuggestions(actor, participant, actorProfile, participantProfile);
  return [
    suggestions[0],
    suggestions[1],
    participantProfile?.displayTags[0]
      ? `Compare notes on ${participantProfile.displayTags.slice(0, 2).join(" and ")}.`
      : suggestions[2],
  ].filter((item, index, items) => item && items.indexOf(item) === index).slice(0, 3);
}

function actionReadiness({
  atCap,
  availableSlotCount,
  openTarget,
  reason,
  requestMode,
}: {
  atCap: boolean;
  availableSlotCount: number;
  openTarget: boolean;
  reason: string;
  requestMode: RequestMode;
}): ActionReadiness {
  if (openTarget) {
    return {
      detail: "You already have an open meeting request with this participant.",
      ready: false,
      title: "Already queued",
    };
  }
  if (reason.trim().length < 8) {
    return {
      detail: "Use a suggested note or write one specific sentence before sending.",
      ready: false,
      title: "Needs a reason",
    };
  }
  if (requestMode === "slot" && atCap) {
    return {
      detail: "Timed request cap reached for this day. Send a request for any open time instead.",
      ready: false,
      title: "Request any time",
    };
  }
  if (requestMode === "slot" && availableSlotCount === 0) {
    return {
      detail: "They have no open slots on this day. Send a request for any open time and the app can schedule later.",
      ready: false,
      title: "No open slot",
    };
  }
  return {
    detail: requestMode === "interest" ? "Meeting request is ready to send." : "Timed request is ready to send.",
    ready: true,
    title: "Ready",
  };
}

export function NetworkingApp() {
  const publicConfig = useQuery(api.networking.getPublicConfig, {}) as PublicConfig | undefined;
  const demoLoginEnabled = publicConfig?.demoLoginEnabled ?? false;
  const accounts = useQuery(api.networking.listDemoAccounts, demoLoginEnabled ? {} : "skip") as DemoAccount[] | undefined;
  const ensureDemoData = useMutation(api.networking.ensureDemoData);
  const startDemoSession = useMutation(api.networking.startDemoSession);
  const logoutSession = useMutation(api.networking.logout);
  const requestMagicLink = useAction(api.networking.requestMagicLink);
  const verifyMagicLink = useAction(api.networking.verifyMagicLink);
  const seedStartedRef = useRef(false);
  const sessionRequestRef = useRef(0);
  const tokenVerificationStartedRef = useRef(false);
  const actionLockRef = useRef(false);
  const [initialAuthToken] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URL(window.location.href).searchParams.get("authToken");
  });
  const [sessionToken, setSessionTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(sessionStorageKey);
  });
  const [actorEmail, setActorEmail] = useState("priya@leadership.test");
  const data = useQuery(
    api.networking.getBootstrap,
    sessionToken ? { sessionToken } : "skip",
  ) as Bootstrap | null | undefined;
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window === "undefined") return "directory";
    return new URLSearchParams(window.location.search).get("surface") === "display"
      ? "display"
      : "directory";
  });
  const [adminParticipantPreview, setAdminParticipantPreview] = useState(false);
  const [profileModalDismissed, setProfileModalDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => initialAuthToken ? "Verifying login link..." : null);
  const [actionPending, setActionPending] = useState(false);
  const [sessionPending, setSessionPending] = useState(Boolean(initialAuthToken));

  const setSessionToken = useCallback((token: string | null) => {
    setSessionTokenState(token);
    if (typeof window === "undefined") return;
    if (token) window.localStorage.setItem(sessionStorageKey, token);
    else window.localStorage.removeItem(sessionStorageKey);
  }, []);

  useEffect(() => {
    if (!demoLoginEnabled || accounts === undefined || accounts.length > 0 || seedStartedRef.current) return;
    seedStartedRef.current = true;
    void ensureDemoData({}).catch((error) => setNotice(userFacingError(error)));
  }, [accounts, demoLoginEnabled, ensureDemoData]);

  useEffect(() => {
    if (!initialAuthToken || typeof window === "undefined" || tokenVerificationStartedRef.current) return;
    const url = new URL(window.location.href);
    tokenVerificationStartedRef.current = true;
    void verifyMagicLink({ token: initialAuthToken })
      .then((result) => {
        setSessionToken(result.token);
        url.searchParams.delete("authToken");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        setNotice("Signed in.");
      })
      .catch((error) => {
        setSessionToken(null);
        setNotice(userFacingError(error));
      })
      .finally(() => setSessionPending(false));
  }, [initialAuthToken, setSessionToken, verifyMagicLink]);

  useEffect(() => {
    if (sessionToken && data === null) {
      queueMicrotask(() => {
        setSessionToken(null);
        setNotice("Session expired. Send yourself a new login link.");
      });
    }
  }, [data, sessionToken, setSessionToken]);

  const startSession = useCallback((email: string) => {
    if (!demoLoginEnabled) return;
    const requestId = sessionRequestRef.current + 1;
    sessionRequestRef.current = requestId;
    setActorEmail(email);
    setSessionToken(null);
    setNotice(null);
    setSessionPending(true);
    void startDemoSession({ email })
      .then((result) => {
        if (sessionRequestRef.current !== requestId) return;
        setSessionToken(result.token);
      })
      .catch((error) => {
        if (sessionRequestRef.current !== requestId) return;
        setNotice(userFacingError(error));
      })
      .finally(() => {
        if (sessionRequestRef.current === requestId) setSessionPending(false);
      });
  }, [demoLoginEnabled, setSessionToken, startDemoSession]);

  const requestLoginLink = useCallback((email: string) => {
    setSessionPending(true);
    setNotice(null);
    void requestMagicLink({ email, redirectPath: "/?surface=directory" })
      .then(() => setNotice("Check your email for a login link."))
      .catch((error) => setNotice(userFacingError(error)))
      .finally(() => setSessionPending(false));
  }, [requestMagicLink]);

  const signOut = useCallback(() => {
    const token = sessionToken;
    setSessionToken(null);
    setNotice("Signed out.");
    if (token) void logoutSession({ sessionToken: token }).catch(() => null);
  }, [logoutSession, sessionToken, setSessionToken]);

  const setAdminViewMode = useCallback((enabled: boolean) => {
    setAdminParticipantPreview(enabled);
    if (enabled) {
      setActiveView((view) => (view === "admin" ? "directory" : view));
    }
  }, []);

  const settings = data?.settings ?? publicConfig?.settings ?? null;
  const displayDate = settings?.startDate ?? "2026-06-30";
  const displayNowMinute = settings
    ? settings.dayStartMinute + Math.max(0, settings.slotMinutes)
    : undefined;
  const roomDisplay = useQuery(
    api.networking.getRoomDisplay,
    settings && activeView === "display"
      ? { date: displayDate, nowMinute: displayNowMinute }
      : "skip",
  ) as RoomDisplayData | null | undefined;
  const adminViewingAsParticipant = data?.actor.role === "admin" && adminParticipantPreview;
  const adminPreviewParticipants = useQuery(
    api.networking.listDirectoryPreviewParticipants,
    adminViewingAsParticipant && sessionToken ? { sessionToken } : "skip",
  ) as DirectoryPreviewParticipantsResult | undefined;

  const runAction: RunAction = async (task, success) => {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    setActionPending(true);
    setNotice(null);
    try {
      await task();
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(userFacingError(error));
      return false;
    } finally {
      actionLockRef.current = false;
      setActionPending(false);
    }
  };

  if (activeView === "display") {
    return <RoomDisplayView roomDisplay={roomDisplay} onExit={() => setActiveView("directory")} />;
  }

  if (!publicConfig) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Loader2 className="animate-spin text-[#f8e18e]" />
          <h1 className="text-2xl font-semibold">Preparing networking room</h1>
          <p className="text-sm leading-6 text-white/60">Loading event settings.</p>
        </div>
      </main>
    );
  }

  if (!sessionToken || data === null) {
    return (
      <LoginView
        accounts={accounts ?? []}
        demoLoginEnabled={demoLoginEnabled}
        isPending={sessionPending}
        notice={notice}
        onDemoLogin={startSession}
        onDismissNotice={() => setNotice(null)}
        onRequestLink={requestLoginLink}
        settings={settings}
      />
    );
  }

  if (!data?.settings) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Loader2 className="animate-spin text-[#f8e18e]" />
          <h1 className="text-2xl font-semibold">Opening your session</h1>
          <p className="text-sm leading-6 text-white/60">{notice || "Checking your secure session."}</p>
        </div>
      </main>
    );
  }

  const actor = data.actor;
  const displayActor: Account = adminViewingAsParticipant
    ? { ...actor, role: "participant" as const }
    : actor;
  const participants = adminViewingAsParticipant
    ? visibleAccounts(adminPreviewParticipants)
    : visibleAccounts(data.participants);
  const stats = dashboardStats(data, participants);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <TopStrip settings={data.settings} />
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
        <Header
          actor={actor}
          actorEmail={actorEmail}
          adminViewingAsParticipant={adminViewingAsParticipant}
          demoAccounts={accounts ?? []}
          demoLoginEnabled={demoLoginEnabled}
          isPending={sessionPending}
          onActorChange={startSession}
          onAdminViewModeChange={setAdminViewMode}
          onLogout={signOut}
        />
        {notice && (
          <div className="flex items-center justify-between border border-[#f8e18e]/30 bg-[#f8e18e]/10 px-3 py-2 text-sm text-[#f8e18e]">
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {displayActor.role === "participant" && !bookingReadiness(displayActor).complete && (
          <ProfileCompletionBanner
            actor={displayActor}
            onGoToProfile={() => setActiveView("profile")}
            highlighted={activeView !== "profile"}
          />
        )}
        {displayActor.role === "participant" &&
          !bookingReadiness(displayActor).complete &&
          !profileModalDismissed &&
          activeView !== "profile" && (
            <ProfileCompletionModal
              actor={displayActor}
              onClose={() => setProfileModalDismissed(true)}
              onGoToProfile={() => {
                setProfileModalDismissed(true);
                setActiveView("profile");
              }}
            />
          )}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Navigation
            actor={actor}
            activeView={activeView}
            adminViewingAsParticipant={adminViewingAsParticipant}
            onAdminViewModeChange={setAdminViewMode}
            onChange={setActiveView}
          />
          <section className="min-w-0">
            <MetricStrip settings={data.settings} stats={stats} />
            {activeView === "directory" && (
              <DirectoryView
                actionPending={actionPending}
                actor={displayActor}
                participants={participants}
                previewMode={adminViewingAsParticipant}
                interests={data.interests}
                onGoToProfile={() => setActiveView("profile")}
                onGoToRequests={() => setActiveView("requests")}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
              />
            )}
            {activeView === "profile" && (
              <ProfileView
                key={`${displayActor._id}:${displayActor.role}`}
                actionPending={actionPending}
                actor={displayActor}
                availability={data.myAvailability}
                previewMode={adminViewingAsParticipant}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {activeView === "requests" && (
              <RequestsView
                actionPending={actionPending}
                actor={displayActor}
                previewMode={adminViewingAsParticipant}
                interests={data.interests}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {activeView === "schedule" && (
              <ScheduleView
                actionPending={actionPending}
                actor={displayActor}
                meetings={data.meetings}
                previewMode={adminViewingAsParticipant}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {activeView === "admin" && (
              <AdminView
                actionPending={actionPending}
                actor={actor}
                importBatches={data.importBatches}
                interests={data.interests}
                meetings={data.meetings}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                setSessionToken={setSessionToken}
                settings={data.settings}
                demoLoginEnabled={demoLoginEnabled}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function dashboardStats(data: Bootstrap, participants = visibleAccounts(data.participants)) {
  const slotsPerDay = Math.floor(
    (data.settings.dayEndMinute - data.settings.dayStartMinute) / data.settings.slotMinutes,
  );
  return {
    visibleParticipants: participants.filter((participant) => participant.directoryOptIn).length,
    pending: data.requests.filter((request) => request.status === "pending").length,
    confirmed: data.meetings.filter((meeting) => meeting.status !== "cancelled").length,
    capacity: data.settings.activeTables * slotsPerDay * eventDateEntries(data.settings).length,
  };
}

function TopStrip({ settings }: { settings: Settings }) {
  return (
    <div className="border-b border-white/10 bg-[#f8e18e] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-black sm:px-5">
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-2">
        <span>AIE World Fair Networking</span>
        <span className="font-mono normal-case tracking-normal">
          Room 3001 · {settings.activeTables} tables · {settings.slotMinutes}m slots · groups up to {settings.maxMeetingGroupSize}
        </span>
      </div>
    </div>
  );
}

function LoginView({
  accounts,
  demoLoginEnabled,
  isPending,
  notice,
  onDemoLogin,
  onDismissNotice,
  onRequestLink,
  settings,
}: {
  accounts: DemoAccount[];
  demoLoginEnabled: boolean;
  isPending: boolean;
  notice: string | null;
  onDemoLogin: (email: string) => void;
  onDismissNotice: () => void;
  onRequestLink: (email: string) => void;
  settings: Settings | null;
}) {
  const [email, setEmail] = useState("");
  const [demoEmail, setDemoEmail] = useState(accounts[0]?.email ?? "");
  const effectiveDemoEmail = demoEmail || accounts[0]?.email || "";

  function submit(event: FormEvent) {
    event.preventDefault();
    onRequestLink(email);
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      {settings && <TopStrip settings={settings} />}
      <div className="mx-auto grid min-h-[calc(100vh-40px)] w-full max-w-[1120px] place-items-center px-4 py-8">
        <section className="grid w-full max-w-xl gap-4 border border-white/10 bg-[#101010] p-5">
          <div>
            <div className="font-mono text-xs text-[#f8e18e]">https://network.aieconf.com/</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Networking Room</h1>
            <p className="mt-2 text-sm leading-6 text-white/55">
              Sign in with the email on your AIE World Fair registration.
            </p>
          </div>

          {notice && (
            <div className="flex items-center justify-between border border-[#f8e18e]/30 bg-[#f8e18e]/10 px-3 py-2 text-sm text-[#f8e18e]">
              <span>{notice}</span>
              <button aria-label="Dismiss notice" onClick={onDismissNotice} type="button">
                <X size={16} />
              </button>
            </div>
          )}

          <form onSubmit={submit} className="grid gap-3">
            <Field label="Email">
              <input
                autoComplete="email"
                className="input"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
                type="email"
                value={email}
              />
            </Field>
            <button className="button-primary" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              Send login link
            </button>
          </form>

          {demoLoginEnabled && (
            <div className="grid gap-3 border-t border-white/10 pt-4">
              <Field label="Demo account">
                <select
                  className="input"
                  disabled={!accounts.length || isPending}
                  onChange={(event) => setDemoEmail(event.target.value)}
                  value={effectiveDemoEmail}
                >
                  {accounts.map((account) => (
                    <option key={account._id} value={account.email}>
                      {account.displayName} · {account.role} · {account.email}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="button-quiet"
                disabled={!effectiveDemoEmail || isPending}
                onClick={() => onDemoLogin(effectiveDemoEmail)}
                type="button"
              >
                <LockKeyhole size={15} /> Open demo session
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Header({
  actor,
  actorEmail,
  adminViewingAsParticipant,
  demoAccounts,
  demoLoginEnabled,
  isPending,
  onActorChange,
  onAdminViewModeChange,
  onLogout,
}: {
  actor: Account;
  actorEmail: string;
  adminViewingAsParticipant: boolean;
  demoAccounts: DemoAccount[];
  demoLoginEnabled: boolean;
  isPending: boolean;
  onActorChange: (email: string) => void;
  onAdminViewModeChange: (enabled: boolean) => void;
  onLogout: () => void;
}) {
  return (
    <header className="grid gap-3 border border-white/10 bg-[#101010] p-3 sm:grid-cols-[1fr_auto] sm:p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
          <span className="font-mono text-[#f8e18e]">https://network.aieconf.com/</span>
          <span className="hidden sm:inline">·</span>
          <span>Peer booking room</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Networking Room
          </h1>
          <RolePill actor={actor} adminViewingAsParticipant={adminViewingAsParticipant} />
        </div>
      </div>
      <div className="grid min-w-0 gap-2 sm:min-w-[340px]">
        <div className="flex min-w-0 items-center justify-between gap-3 border border-white/10 bg-black/30 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{actor.displayName}</div>
            <div className="truncate text-xs text-white/45">{actor.email}</div>
          </div>
          <button className="button-quiet h-9 px-2 text-xs" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
        {actor.role === "admin" && (
          <button
            className={cn(
              "button-quiet h-10 w-full justify-center text-xs",
              adminViewingAsParticipant && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]",
            )}
            onClick={() => onAdminViewModeChange(!adminViewingAsParticipant)}
            type="button"
          >
            {adminViewingAsParticipant ? <Settings2 size={15} /> : <UserCheck size={15} />}
            {adminViewingAsParticipant ? "Return to admin view" : "View as participant"}
          </button>
        )}
        {demoLoginEnabled && (
          <label className="grid min-w-0 gap-1 text-xs text-white/55">
            Demo account
            <select
              value={actorEmail}
              onChange={(event) => onActorChange(event.target.value)}
              className="h-10 w-full min-w-0 max-w-full border border-white/15 bg-black px-3 text-sm font-medium text-white outline-none transition focus:border-[#f8e18e]"
            >
              {demoAccounts.map((account) => (
                <option key={account._id} value={account.email}>
                  {account.displayName} · {account.role} · {account.email}
                </option>
              ))}
            </select>
            {isPending && <span className="text-[#f8e18e]">Syncing session...</span>}
          </label>
        )}
      </div>
    </header>
  );
}

function RolePill({
  actor,
  adminViewingAsParticipant = false,
}: {
  actor: Account;
  adminViewingAsParticipant?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
      <LockKeyhole size={12} />
      {actor.role}
      {adminViewingAsParticipant ? " · viewing participant" : ""}
      {actor.role === "participant" ? ` · ${actor.directoryOptIn ? "opted in" : "hidden"}` : ""}
    </span>
  );
}

function Navigation({
  activeView,
  adminViewingAsParticipant,
  actor,
  onAdminViewModeChange,
  onChange,
}: {
  activeView: View;
  adminViewingAsParticipant: boolean;
  actor: Account;
  onAdminViewModeChange: (enabled: boolean) => void;
  onChange: (view: View) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const allItems: Array<{ id: View; label: string; icon: ReactNode }> = [
    { id: "directory", label: "Directory", icon: <Search size={16} /> },
    { id: "profile", label: "Profile", icon: <UserCheck size={16} /> },
    { id: "requests", label: "Requests", icon: <ListChecks size={16} /> },
    { id: "schedule", label: "Schedule", icon: <CalendarDays size={16} /> },
    { id: "display", label: "Room display", icon: <Monitor size={16} /> },
    { id: "admin", label: "Admin", icon: <Settings2 size={16} /> },
  ];
  const items = allItems.filter((item) => {
    if (item.id === "admin" || item.id === "display") {
      return actor.role === "admin" && !adminViewingAsParticipant;
    }
    return true;
  });
  const activeItem = items.find((item) => item.id === activeView) ?? items[0];

  return (
    <aside className="min-w-0 border border-white/10 bg-[#101010] p-2 lg:sticky lg:top-4 lg:h-[calc(100vh-92px)]">
      <button
        type="button"
        aria-controls="primary-navigation"
        aria-expanded={mobileOpen}
        aria-label={`${mobileOpen ? "Close" : "Open"} navigation menu. Current view: ${activeItem?.label ?? "Navigation"}.`}
        onClick={() => setMobileOpen((open) => !open)}
        className="flex h-11 w-full min-w-0 items-center justify-between gap-3 border border-white/10 bg-black/30 px-3 text-left text-sm font-semibold text-white transition hover:border-[#f8e18e]/45 lg:hidden"
      >
        <span className="flex min-w-0 items-center gap-2">
          {mobileOpen ? <X className="shrink-0" size={17} /> : <Menu className="shrink-0" size={17} />}
          <span>Menu</span>
        </span>
        <span className="truncate text-xs font-medium uppercase tracking-[0.12em] text-[#f8e18e]">
          Current: {activeItem?.label ?? "Navigation"}
        </span>
      </button>
      <nav
        id="primary-navigation"
        aria-label="Primary"
        className={cn(
          "w-full min-w-0 gap-2 lg:flex lg:flex-col",
          mobileOpen ? "mt-2 grid" : "hidden lg:flex",
        )}
      >
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onChange(item.id);
              setMobileOpen(false);
            }}
            className={cn(
              "flex h-11 w-full min-w-0 items-center justify-between gap-3 border px-3 text-left text-sm font-medium transition",
              activeView === item.id
                ? "border-[#f8e18e]/70 bg-[#f8e18e]/15 text-[#f8e18e]"
                : "border-transparent text-white/60 hover:border-white/10 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </span>
            <ChevronRight className="hidden lg:block" size={14} />
          </button>
        ))}
      </nav>
      {actor.role === "admin" && (
        <button
          className={cn(
            "mt-2 hidden h-10 w-full items-center justify-center gap-2 border px-3 text-xs font-semibold uppercase tracking-[0.12em] transition lg:flex",
            adminViewingAsParticipant
              ? "border-[#f8e18e]/60 bg-[#f8e18e]/12 text-[#f8e18e]"
              : "border-white/10 bg-black/25 text-white/55 hover:border-[#f8e18e]/45 hover:text-white",
          )}
          onClick={() => onAdminViewModeChange(!adminViewingAsParticipant)}
          type="button"
        >
          {adminViewingAsParticipant ? <Settings2 size={14} /> : <UserCheck size={14} />}
          {adminViewingAsParticipant ? "Admin view" : "Participant view"}
        </button>
      )}
      <div className="mt-4 hidden border-t border-white/10 pt-4 text-xs leading-5 text-white/45 lg:block">
        Opt-in participants request a meeting time or send a request for any open time to each other. Accepted groups take one table, up to four people.
      </div>
    </aside>
  );
}

function MetricStrip({
  settings,
  stats,
}: {
  settings: Settings;
  stats: { visibleParticipants: number; pending: number; confirmed: number; capacity: number };
}) {
  const metrics = [
    { label: "Visible people", value: stats.visibleParticipants, icon: <Users size={16} /> },
    { label: "Pending", value: stats.pending, icon: <ListChecks size={16} /> },
    { label: "Confirmed", value: stats.confirmed, icon: <Check size={16} /> },
    { label: "Table slots", value: stats.capacity, icon: <Gauge size={16} /> },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="border border-white/10 bg-[#101010] p-3">
          <div className="flex items-center justify-between text-white/45">
            {metric.icon}
            <span className="font-mono text-[11px]">{settings.slotMinutes}m</span>
          </div>
          <div className="mt-3 text-2xl font-semibold">{metric.value}</div>
          <div className="mt-1 text-xs text-white/50">{metric.label}</div>
        </div>
      ))}
    </div>
  );
}

function DirectoryView({
  actionPending,
  actor,
  interests,
  onGoToProfile,
  onGoToRequests,
  participants,
  previewMode,
  requests,
  runAction,
  sessionToken,
  settings,
}: {
  actionPending: boolean;
  actor: Account;
  interests: MeetingInterest[];
  onGoToProfile: () => void;
  onGoToRequests: () => void;
  participants: Account[];
  previewMode?: boolean;
  requests: MeetingRequest[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
}) {
  const createMeetingInterest = useMutation(api.networking.createMeetingInterest);
  const createPeerRequest = useMutation(api.networking.createPeerRequest);
  const [query, setQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  const [sortMode, setSortMode] = useState<DirectorySort>("recommended");
  const [viewMode, setViewMode] = useState<DirectoryViewMode>("people");
  const [trackFilter, setTrackFilter] = useState("all");
  const [date, setDate] = useState(settings.startDate);
  const [requestMode, setRequestMode] = useState<RequestMode>("slot");
  const [selectedId, setSelectedId] = useState<Id<"accounts"> | null>(null);
  const [hoveredId, setHoveredId] = useState<Id<"accounts"> | null>(null);
  const [shortlistIds, setShortlistIds] = useState<Array<Id<"accounts">>>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [, startDirectoryTransition] = useTransition();
  const [lastAction, setLastAction] = useState<{ mode: RequestMode; name: string } | null>(null);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [detailsParticipant, setDetailsParticipant] = useState<Account | null>(null);
  const [page, setPage] = useState(0);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const activeOutgoingForDay = useMemo(
    () => requests.filter(
      (request) =>
        request.requesterAccountId === actor._id &&
        request.date === date &&
        activeOutgoingStatus(request.status),
    ),
    [actor._id, date, requests],
  );
  const activeOutgoingInterests = useMemo(
    () => interests.filter(
      (interest) =>
        interest.requesterAccountId === actor._id &&
        activeOutgoingStatus(interest.status),
    ),
    [actor._id, interests],
  );
  const atCap = activeOutgoingForDay.length >= settings.outgoingRequestCapPerDay;
  const openTargetIds = useMemo(
    () => new Set([
      ...activeOutgoingForDay.map((request) => request.targetAccountId),
      ...activeOutgoingInterests.map((interest) => interest.targetAccountId),
    ]),
    [activeOutgoingForDay, activeOutgoingInterests],
  );
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const actorProfile = useMemo(() => participantProfileFor(actor), [actor]);
  const directoryItems = useMemo(() => participants
    .filter((participant) => participant.role === "participant" && participant._id !== actor._id)
    .filter((participant) => participant.signedUp && participant.directoryOptIn)
    .map((participant) => {
      const profile = participantProfileFor(participant);
      const tracks = participantTracks(participant, profile);
      const match = participantMatch(actor, participant, actorProfile, profile);
      return {
        match,
        participant,
        profile,
        rank: privateDirectoryRank(participant, profile, match),
        searchText: [
          participant.displayName,
          participant.company,
          participant.title,
          participant.networkingIntent,
          participant.topics.join(" "),
          tracks.map((track) => track.name).join(" "),
          participant.city,
          participant.country,
          profile ? profileSearchText(profile) : "",
        ].join(" ").toLowerCase(),
        tracks,
      };
    }), [actor, actorProfile, participants]);
  const filtered: DirectoryItem[] = useMemo(
    () => directoryItems
      .filter((item) => ticketFilter === "all" || item.participant.ticketCategory === ticketFilter)
      .filter((item) => {
        if (profileFilter === "researched") return Boolean(item.profile);
        if (profileFilter === "pending") return !item.profile;
        return true;
      })
      .filter((item) => trackFilter === "all" || item.tracks.some((track) => track.name === trackFilter))
      .filter((item) => !normalizedQuery || item.searchText.includes(normalizedQuery))
      .sort((a, b) => {
        if (sortMode === "recommended") {
          return b.rank - a.rank || a.participant.displayName.localeCompare(b.participant.displayName);
        }
        if (sortMode === "name") return a.participant.displayName.localeCompare(b.participant.displayName);
        return a.participant.company.localeCompare(b.participant.company) || a.participant.displayName.localeCompare(b.participant.displayName);
      }),
    [directoryItems, normalizedQuery, profileFilter, sortMode, ticketFilter, trackFilter],
  );
  const selectedItem =
    filtered.find((item) => item.participant._id === selectedId) ??
    filtered.find((item) => item.participant._id !== actor._id) ??
    null;
  const selected = selectedItem?.participant ?? null;
  const availability = useQuery(
    api.networking.getParticipantAvailability,
    selected ? { accountId: selected._id, date } : "skip",
  ) as AvailabilitySlot[] | undefined;
  useQuery(
    api.networking.getParticipantAvailability,
    hoveredId && hoveredId !== selected?._id ? { accountId: hoveredId, date } : "skip",
  ) as AvailabilitySlot[] | undefined;
  const availableSlots = (availability ?? []).filter((slot) => slot.available && slot.groupOpen !== false);
  const fallbackSlot: number | "" = availableSlots.length > 0 ? availableSlots[0].startMinute : "";
  const effectiveSelectedSlot: number | "" =
    selectedSlot !== "" && availableSlots.some((slot) => slot.startMinute === selectedSlot)
      ? selectedSlot
      : fallbackSlot;
  const quickSlots = availableSlots.slice(0, 6);
  const selectedProfile = selectedItem?.profile ?? null;
  const selectedMatch = selectedItem?.match ?? null;
  const selectedOpenTarget = Boolean(selected && openTargetIds.has(selected._id));
  const reasonSuggestions = selected
    ? meetingReasonSuggestions(actor, selected, actorProfile, selectedProfile)
    : [];
  const starterSuggestions = selected
    ? conversationStarters(actor, selected, actorProfile, selectedProfile)
    : [];
  const readiness = actionReadiness({
    atCap,
    availableSlotCount: availableSlots.length,
    openTarget: selectedOpenTarget,
    reason,
    requestMode,
  });
  const starterPicks = useMemo(() => filtered
    .filter((item) => item.profile && !openTargetIds.has(item.participant._id))
    .filter((item) => normalizedQuery || !hasLowValueDiscoveryFocus(item.participant, item.profile))
    .sort((a, b) => {
      const sourceDelta = (b.profile ? sourceCount(b.profile) : 0) - (a.profile ? sourceCount(a.profile) : 0);
      return b.rank - a.rank || sourceDelta || a.participant.displayName.localeCompare(b.participant.displayName);
    })
    .slice(0, 5), [filtered, normalizedQuery, openTargetIds]);
  const shortlist = useMemo(() => shortlistIds
    .map((id) => filtered.find((item) => item.participant._id === id))
    .filter((item): item is DirectoryItem => Boolean(item))
    .slice(0, 4), [filtered, shortlistIds]);
  const companyGroups = useMemo(
    () => viewMode === "company" ? companyDirectoryGroups(filtered) : [],
    [filtered, viewMode],
  );
  const pageSize = viewMode === "company" ? 12 : 25;
  const totalResults = viewMode === "company" ? companyGroups.length : filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalResults / pageSize));
  const filterKey = `${viewMode}|${normalizedQuery}|${profileFilter}|${sortMode}|${ticketFilter}|${trackFilter}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let activePage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(0);
    activePage = 0;
  }
  const currentPage = Math.min(activePage, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalResults);
  const pagedCompanyGroups = useMemo(
    () => companyGroups.slice(pageStart, pageEnd),
    [companyGroups, pageEnd, pageStart],
  );
  const pagedItems = useMemo(
    () => filtered.slice(pageStart, pageEnd),
    [filtered, pageEnd, pageStart],
  );

  function goToPage(next: number) {
    setPage(next);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const engagementStats = useMemo(() => ({
    researched: filtered.filter((item) => item.profile).length,
    pending: filtered.filter((item) => !item.profile).length,
    greatLeads: filtered.filter((item) => item.rank >= 18 || (item.profile && sourceCount(item.profile) >= 3)).length,
    openActions: activeOutgoingForDay.length + activeOutgoingInterests.length,
  }), [activeOutgoingForDay.length, activeOutgoingInterests.length, filtered]);

  function resetFilters() {
    setQuery("");
    setTicketFilter("all");
    setProfileFilter("all");
    setSortMode("recommended");
    setTrackFilter("all");
  }

  function jumpToCompany(company: string) {
    const id = companyAnchorId(company);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function warmParticipant(participant: Account) {
    if (participant._id === hoveredId) return;
    startDirectoryTransition(() => setHoveredId(participant._id));
  }

  function selectParticipant(participant: Account, options?: { primeInterest?: boolean; primeReason?: boolean }) {
    const profile = participantProfileFor(participant);
    setSelectedId(participant._id);
    startDirectoryTransition(() => {
      setHoveredId(participant._id);
      setSelectedSlot("");
      if (options?.primeInterest) {
        setRequestMode("interest");
      }
      if (options?.primeInterest || options?.primeReason) {
        setReason((current) =>
          current.trim() ? current : meetingReasonSuggestions(actor, participant, actorProfile, profile)[0],
        );
      }
    });
  }

  function openDetails(participant: Account) {
    selectParticipant(participant, { primeReason: true });
    setDetailsParticipant(participant);
  }

  function quickRegisterInterest(participant: Account) {
    const profile = participantProfileFor(participant);
    const suggestions = meetingReasonSuggestions(actor, participant, actorProfile, profile);
    const quickReason = reason.trim() || suggestions[0] || `Interested in ${participant.displayName}'s work.`;
    selectParticipant(participant, { primeInterest: true });
    setReason(quickReason);
    if (!bookingReadiness(actor).complete) {
      setShowProfilePrompt(true);
      return;
    }
    if (actionPending || previewMode || openTargetIds.has(participant._id)) return;
    void runAction(
      () =>
        createMeetingInterest({
          sessionToken,
          targetAccountId: participant._id,
          reason: quickReason,
          context: `${actor.title}, ${actor.company}`,
        }),
      `Meeting request sent to ${participant.displayName}.`,
    ).then((completed) => {
      if (completed) {
        setLastAction({ mode: "interest", name: participant.displayName });
        setReason("");
      }
    });
  }

  function toggleShortlist(participant: Account) {
    setShortlistIds((ids) =>
      ids.includes(participant._id)
        ? ids.filter((id) => id !== participant._id)
        : [participant._id, ...ids].slice(0, 4),
    );
    selectParticipant(participant, { primeReason: true });
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (previewMode || !selected || openTargetIds.has(selected._id)) return;
    if (!bookingReadiness(actor).complete) {
      setShowProfilePrompt(true);
      return;
    }
    if (requestMode === "slot" && (effectiveSelectedSlot === "" || atCap)) return;
    void runAction(
      () => {
        if (requestMode === "interest") {
          return createMeetingInterest({
            sessionToken,
            targetAccountId: selected._id,
            reason,
            context: `${actor.title}, ${actor.company}`,
          });
        }
        if (effectiveSelectedSlot === "") {
          throw new Error("Choose an available slot.");
        }
        return createPeerRequest({
          sessionToken,
          targetAccountId: selected._id,
          date,
          preferredStartMinute: effectiveSelectedSlot,
          reason,
          context: `${actor.title}, ${actor.company}`,
        });
      },
      `Meeting request sent to ${selected.displayName}.`,
    ).then((completed) => {
      if (completed) {
        setLastAction({ mode: requestMode, name: selected.displayName });
        setReason("");
      }
    });
  }

  if (actor.role !== "participant") {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <Users className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Participant account required</h2>
        <p className="mt-2 text-sm leading-6 text-white/55">
          Sign in as a participant to browse the networking directory.
        </p>
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0 border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Search size={17} />} title="Participant directory" detail={`${filtered.length} visible`} />
        {previewMode && (
          <div className="border-b border-[#f8e18e]/25 bg-[#f8e18e]/10 px-4 py-3 text-sm leading-6 text-[#f8e18e]">
            Viewing the participant directory as an admin. Meeting actions are disabled in preview mode.
          </div>
        )}
        {lastAction && (
          <RequestSuccessModal
            action={lastAction}
            onClose={() => setLastAction(null)}
            onGoToRequests={() => {
              setLastAction(null);
              onGoToRequests();
            }}
          />
        )}
        {showProfilePrompt && (
          <ProfileCompletionModal
            actor={actor}
            onClose={() => setShowProfilePrompt(false)}
            onGoToProfile={() => {
              setShowProfilePrompt(false);
              onGoToProfile();
            }}
          />
        )}
        {detailsParticipant && (
          <ParticipantDetailsModal
            participant={detailsParticipant}
            bookable={detailsParticipant.hasAvailability}
            disabled={actionPending || Boolean(previewMode)}
            requestOpen={openTargetIds.has(detailsParticipant._id)}
            shortlisted={shortlistIds.includes(detailsParticipant._id)}
            onClose={() => setDetailsParticipant(null)}
            onShortlist={() => toggleShortlist(detailsParticipant)}
            onRequest={() => {
              const target = detailsParticipant;
              setDetailsParticipant(null);
              quickRegisterInterest(target);
            }}
          />
        )}
        <div className="flex border-b border-white/10 px-4 py-2 sm:justify-end">
          <div className="inline-grid w-full max-w-xs grid-cols-2 border border-white/10 bg-black/30 p-0.5 sm:w-auto">
            {([
              ["company", "Companies", "Browse organizations and what they do"],
              ["people", "People", "Browse individual attendees"],
            ] as const).map(([mode, label, description]) => (
              <button
                aria-pressed={viewMode === mode}
                className={cn(
                  "flex min-h-8 items-center justify-center px-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] transition sm:min-w-28",
                  viewMode === mode
                    ? "bg-[#f8e18e] text-black"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                )}
                key={mode}
                onClick={() => setViewMode(mode)}
                title={description}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 border-b border-white/10 p-4">
          <Field label="Search">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company, track, name, product..."
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Field label="Track">
              <select className="input" value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}>
                <option value="all">All tracks</option>
                {allTrackNames.map((track) => (
                  <option key={track} value={track}>{track}</option>
                ))}
              </select>
            </Field>
            <Field label="Ticket">
              <select className="input" value={ticketFilter} onChange={(event) => setTicketFilter(event.target.value)}>
                <option value="all">All tickets</option>
                <option value="leadership">Leadership</option>
                <option value="speaker">Speaker</option>
                <option value="sponsor">Sponsor</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Profile">
              <select className="input" value={profileFilter} onChange={(event) => setProfileFilter(event.target.value as ProfileFilter)}>
                <option value="all">All profiles</option>
                <option value="researched">Researched</option>
                <option value="pending">Needs research</option>
              </select>
            </Field>
            <Field label="Sort">
              <select className="input" value={sortMode} onChange={(event) => setSortMode(event.target.value as DirectorySort)}>
                <option value="recommended">Recommended</option>
                <option value="company">Company</option>
                <option value="name">Name</option>
              </select>
            </Field>
            <Field label="Date">
              <select className="input" value={date} onChange={(event) => setDate(event.target.value)}>
                {eventDateEntries(settings).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <div className="grid gap-3 border-b border-white/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
          <div className="text-xs leading-5 text-white/42">
            Tracks come from the World Fair speaker schedule when available.
          </div>
          {viewMode === "company" ? (
            <Field label="Jump to company">
              <select
                className="input"
                onChange={(event) => {
                  if (event.target.value) jumpToCompany(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="">Select company...</option>
                {companyGroups.map((group) => (
                  <option key={group.company} value={group.company}>{group.company}</option>
                ))}
              </select>
            </Field>
          ) : <div />}
          {(query || trackFilter !== "all" || ticketFilter !== "all" || profileFilter !== "all" || sortMode !== "recommended") && (
            <button className="button-quiet h-8 min-h-8 px-2 text-xs" onClick={resetFilters} type="button">
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
        <DiscoverySummary
          stats={engagementStats}
          onShowPending={() => {
            setProfileFilter("pending");
            setSortMode("name");
          }}
          onShowRecommended={() => {
            setProfileFilter("all");
            setSortMode("recommended");
            setQuery("");
          }}
          onReviewActions={onGoToRequests}
        />
        {starterPicks.length > 0 && (
          <StarterPicks
            picks={starterPicks}
            selectedId={selected?._id ?? null}
            onSelect={(participant) => selectParticipant(participant, { primeInterest: true })}
            onWarm={warmParticipant}
          />
        )}
        {shortlist.length > 0 && (
          <ShortlistTray
            items={shortlist}
            onClear={() => setShortlistIds([])}
            onSelect={(participant) => selectParticipant(participant, { primeReason: true })}
            onWarm={warmParticipant}
            selectedId={selected?._id ?? null}
          />
        )}
        <div ref={resultsTopRef} className="flex scroll-mt-4 items-center justify-between gap-2 border-b border-white/10 bg-[#0b0b0b] px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {totalResults === 0
              ? viewMode === "company" ? "0 companies" : "0 people"
              : `${pageStart + 1}–${pageEnd} of ${totalResults} ${viewMode === "company" ? "companies" : "people"}`}
          </div>
          <div className="text-[11px] text-white/35">
            Sorted by {sortMode === "recommended" ? "recommended order" : sortMode}
          </div>
        </div>
        <div className="grid gap-1.5 p-2">
          {filtered.length === 0 && (
            <div className="border border-white/10 bg-black/25 p-6">
              <EmptyState title="No matching participants" detail="Try a broader company, name, or topic search." />
              <div className="mt-4 flex justify-center">
                <button className="button-quiet" onClick={resetFilters} type="button">
                  <RotateCcw size={15} /> Show recommended people
                </button>
              </div>
            </div>
          )}
          {viewMode === "company" ? (
            pagedCompanyGroups.map((group) => (
              <CompanyGroupCard
                key={group.company}
                activeTargetIds={openTargetIds}
                disabled={actionPending || Boolean(previewMode)}
                group={group}
                onQuickInterest={quickRegisterInterest}
                onSelect={(participant) => selectParticipant(participant, { primeReason: true })}
                onShowDetails={openDetails}
                onShortlist={toggleShortlist}
                onWarm={warmParticipant}
                selectedId={selected?._id ?? null}
                shortlistIds={shortlistIds}
              />
            ))
          ) : (
            <ParticipantResultsList
              activeTargetIds={openTargetIds}
              disabled={actionPending || Boolean(previewMode)}
              items={pagedItems}
              onQuickInterest={quickRegisterInterest}
              onSelect={(participant) => selectParticipant(participant, { primeReason: true })}
              onShowDetails={openDetails}
              onShortlist={toggleShortlist}
              onWarm={warmParticipant}
              selectedId={selected?._id ?? null}
              shortlistIds={shortlistIds}
            />
          )}
        </div>
        <PaginationControls onChange={goToPage} page={currentPage} pageCount={pageCount} />
      </section>

      <form onSubmit={submitRequest} className="border border-white/10 bg-[#101010] p-4 xl:sticky xl:top-4 xl:self-start">
        {!actor.profileComplete || !actor.directoryOptIn ? (
          <div className="border border-yellow-300/20 bg-yellow-300/10 p-3 text-sm leading-6 text-yellow-100">
            Confirm your profile and opt into the directory before sending requests.
          </div>
        ) : selected ? (
          <div className="grid gap-3">
            <ParticipantDetailPanel participant={selected} />
            <MeetingDecisionPanel
              match={selectedMatch}
              participant={selected}
              profile={selectedProfile}
              readiness={readiness}
              reasonSuggestions={reasonSuggestions}
              starterSuggestions={starterSuggestions}
              onRegisterInterest={() => {
                setRequestMode("interest");
                setReason((current) => current.trim() || reasonSuggestions[0] || "");
              }}
              onUseReason={(suggestion) => setReason(suggestion)}
            />
            <div className="border-t border-white/10 pt-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
                <Send size={16} /> Send a meeting request
              </div>
              <div className="mt-1 text-xs text-white/45">
                {activeOutgoingForDay.length}/{settings.outgoingRequestCapPerDay} timed requests for {dateLabels[date]}
                {activeOutgoingInterests.length ? ` · ${activeOutgoingInterests.length} open interests` : ""}.
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="border border-white/10 bg-black/25 p-2 text-xs leading-5 text-white/55">
                  <span className="font-semibold text-white/75">{availableSlots.length}</span> open slots on {dateLabels[date]}.
                </div>
                <div className="border border-white/10 bg-black/25 p-2 text-xs leading-5 text-white/55">
                  {effectiveSelectedSlot === ""
                    ? "No specific time selected."
                    : `Fastest open time: ${minuteLabel(effectiveSelectedSlot)}.`}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={cn("button-quiet justify-center", requestMode === "slot" && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]")}
                onClick={() => setRequestMode("slot")}
                type="button"
              >
                <Clock3 size={15} /> Choose time
              </button>
              <button
                className={cn("button-quiet justify-center", requestMode === "interest" && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]")}
                onClick={() => setRequestMode("interest")}
                type="button"
              >
                <UserCheck size={15} /> Any open time
              </button>
            </div>
            {requestMode === "slot" ? (
              <Field label="Available slot">
                <select
                  className="input"
                  disabled={!availableSlots.length}
                  value={effectiveSelectedSlot}
                  onChange={(event) => setSelectedSlot(Number(event.target.value))}
                >
                  {availableSlots.length ? (
                    availableSlots.map((slot) => (
                      <option key={slot._id} value={slot.startMinute}>
                        {minuteLabel(slot.startMinute)}
                        {slot.participantCount && slot.participantCount > 1
                          ? ` · group ${slot.participantCount}/${settings.maxMeetingGroupSize}`
                          : ""}
                      </option>
                    ))
                  ) : (
                    <option value="">No open slots</option>
                  )}
                </select>
                {quickSlots.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {quickSlots.map((slot) => (
                      <button
                        className={cn(
                          "button-quiet px-2 py-1 text-xs",
                          effectiveSelectedSlot === slot.startMinute && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]",
                        )}
                        key={slot._id}
                        onClick={() => setSelectedSlot(slot.startMinute)}
                        type="button"
                      >
                        {minuteLabel(slot.startMinute)}
                        {slot.participantCount && slot.participantCount > 1 ? ` · ${slot.participantCount}/${settings.maxMeetingGroupSize}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            ) : (
              <div className="border border-white/10 bg-black/25 p-3 text-sm leading-6 text-white/55">
                Send your meeting request without choosing a time. If they accept, the app schedules the earliest event slot where both of you are available.
              </div>
            )}
            <div className="grid gap-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-white/45">Quick reason</div>
              <div className="flex flex-wrap gap-2">
                {reasonSuggestions.map((suggestion) => (
                  <button
                    className="button-quiet px-2 py-1 text-xs"
                    key={suggestion}
                    onClick={() => setReason(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Why meet?">
              <textarea
                className="input min-h-28 resize-none"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Specific reason, context, or topic for the conversation."
                required
              />
            </Field>
            <button
              className="button-primary"
              disabled={
                actionPending ||
                previewMode ||
                (requestMode === "slot" && (atCap || !availableSlots.length)) ||
                reason.trim().length < 8 ||
                selectedOpenTarget
              }
              type="submit"
            >
              <Send size={16} /> Send request
            </button>
            {previewMode && <p className="text-xs leading-5 text-white/45">Switch to an actual participant session to request meetings.</p>}
            {requestMode === "slot" && atCap && <p className="text-xs leading-5 text-white/45">Request cap reached for this day.</p>}
          </div>
        ) : (
          <EmptyState title="Select a participant" detail="Choose someone from the directory to see open times." />
        )}
      </form>
    </div>
  );
}

function MeetingDecisionPanel({
  match,
  onRegisterInterest,
  onUseReason,
  participant,
  profile,
  readiness,
  reasonSuggestions,
  starterSuggestions,
}: {
  match: MatchSignal | null;
  onRegisterInterest: () => void;
  onUseReason: (suggestion: string) => void;
  participant: Account;
  profile: DisplayParticipantProfile | null;
  readiness: ActionReadiness;
  reasonSuggestions: string[];
  starterSuggestions: string[];
}) {
  const tags = (profile?.displayTags.length ? profile.displayTags : participant.topics).slice(0, 5);
  const primaryReason =
    match?.reasons[0] ??
    participant.networkingIntent ??
    participant.title;
  return (
    <section className="border border-[#f8e18e]/20 bg-[#f8e18e]/[0.055] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
            <Lightbulb size={15} /> Why this could be worth 20 minutes
          </div>
          <p className="mt-1 text-sm leading-6 text-white/62">
            {primaryReason || "Enough row data to send a specific intro."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {profile && <Badge>{profile.confidence} confidence</Badge>}
        {match?.reasons.slice(0, 2).map((reason) => <Badge key={reason}>{reason}</Badge>)}
      </div>
      {tags.length > 0 && <CompactTagRow items={tags} />}
      <div className={cn(
        "mt-3 border p-2 text-xs leading-5",
        readiness.ready
          ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
          : "border-yellow-300/20 bg-yellow-300/10 text-yellow-100",
      )}>
        <span className="font-semibold">{readiness.title}.</span> {readiness.detail}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          className="button-quiet justify-center"
          onClick={() => onUseReason(reasonSuggestions[0] ?? `Interested in ${participant.displayName}'s work at ${participant.company}.`)}
          type="button"
        >
          <MessageSquareText size={15} /> Use suggested note
        </button>
        <button className="button-quiet justify-center" onClick={onRegisterInterest} type="button">
          <UserCheck size={15} /> Request any open time
        </button>
      </div>
      {starterSuggestions.length > 0 && (
        <div className="mt-3 border-t border-[#f8e18e]/15 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f8e18e]/70">Conversation starters</div>
          <div className="mt-2 grid gap-1.5">
            {starterSuggestions.map((starter) => (
              <button
                className="border border-white/10 bg-black/25 px-2 py-1.5 text-left text-xs leading-5 text-white/58 transition hover:border-[#f8e18e]/40 hover:text-white"
                key={starter}
                onClick={() => onUseReason(starter)}
                type="button"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function bookingReadiness(actor: Account) {
  const missing: Array<{ key: string; label: string }> = [];
  if (!actor.profileComplete) {
    missing.push({ key: "profile", label: "Confirm your name, company, and title" });
  }
  if (!actor.hasAvailability) {
    missing.push({ key: "schedule", label: "Set your availability so people can book time with you" });
  }
  if (!actor.directoryOptIn) {
    missing.push({ key: "directory", label: "Show yourself in the booking directory" });
  }
  return { complete: missing.length === 0, missing };
}

function ProfileCompletionBanner({
  actor,
  onGoToProfile,
  highlighted,
}: {
  actor: Account;
  onGoToProfile: () => void;
  highlighted: boolean;
}) {
  const { missing } = bookingReadiness(actor);
  return (
    <div
      className={cn(
        "grid gap-3 border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
        highlighted
          ? "border-[#f8e18e]/45 bg-[#f8e18e]/15"
          : "border-[#f8e18e]/25 bg-[#f8e18e]/10",
      )}
    >
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
          <AlertCircle size={15} /> Complete your profile so people can book you
        </div>
        <div className="mt-1 text-xs leading-5 text-[#f8e18e]/80">
          {missing.map((item) => item.label).join(" · ")}
        </div>
      </div>
      <button className="button-primary h-9 min-h-9 px-3 text-xs" onClick={onGoToProfile} type="button">
        <UserCheck size={14} /> Complete profile
      </button>
    </div>
  );
}

function ProfileCompletionModal({
  actor,
  onClose,
  onGoToProfile,
}: {
  actor: Account;
  onClose: () => void;
  onGoToProfile: () => void;
}) {
  const { missing } = bookingReadiness(actor);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md border border-[#f8e18e]/35 bg-[#0c0c0c] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-[#f8e18e]">
            <AlertCircle size={18} /> Finish setting up your profile
          </div>
          <button aria-label="Dismiss" className="text-white/45 hover:text-white" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/70">
          Your profile isn&apos;t ready yet. People can only request meetings with you once
          you&apos;ve completed these steps — especially adding your availability:
        </p>
        <ul className="mt-3 grid gap-2">
          {missing.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm leading-6 text-white/80">
              <Circle size={8} className="mt-2 shrink-0 text-[#f8e18e]" /> {item.label}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="button-quiet h-9 min-h-9 px-3 text-sm" onClick={onClose} type="button">
            Later
          </button>
          <button className="button-primary h-9 min-h-9 px-3 text-sm" onClick={onGoToProfile} type="button">
            <UserCheck size={15} /> Complete profile now
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestSuccessModal({
  action,
  onClose,
  onGoToRequests,
}: {
  action: { mode: RequestMode; name: string };
  onClose: () => void;
  onGoToRequests: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md border border-emerald-300/35 bg-[#0c0c0c] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-emerald-200">
            <CheckCircle2 size={18} /> Meeting request sent to {action.name}
          </div>
          <button aria-label="Dismiss" className="text-white/45 hover:text-white" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {action.name} now needs to <span className="font-semibold text-white/90">accept</span> your
          request before a time slot is booked.
          {action.mode === "interest"
            ? " Once they accept, the app schedules the earliest slot where you're both free."
            : " Once they accept, your selected slot is confirmed."}
        </p>
        <p className="mt-2 text-sm leading-6 text-white/70">
          Track its status anytime in the <span className="font-semibold text-white/90">Requests</span> tab.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="button-quiet h-9 min-h-9 px-3 text-sm" onClick={onClose} type="button">
            Keep browsing
          </button>
          <button className="button-primary h-9 min-h-9 px-3 text-sm" onClick={onGoToRequests} type="button">
            <ListChecks size={15} /> View my requests
          </button>
        </div>
      </div>
    </div>
  );
}

function paginationRange(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const last = pageCount - 1;
  const candidates = [0, last, page - 1, page, page + 1].filter((value) => value >= 0 && value <= last);
  const sorted = [...new Set(candidates)].sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  let previous: number | null = null;
  for (const value of sorted) {
    if (previous !== null && value - previous > 1) result.push("gap");
    result.push(value);
    previous = value;
  }
  return result;
}

function PaginationControls({
  onChange,
  page,
  pageCount,
}: {
  onChange: (page: number) => void;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/10 bg-[#0b0b0b] px-3 py-3">
      <button
        className="button-quiet h-8 min-h-8 px-2 text-xs"
        disabled={page <= 0}
        onClick={() => onChange(page - 1)}
        type="button"
      >
        <ChevronLeft size={14} /> Prev
      </button>
      {paginationRange(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          <span className="px-1 text-xs text-white/35" key={`gap-${index}`}>
            …
          </span>
        ) : (
          <button
            aria-current={entry === page ? "page" : undefined}
            className={cn(
              "h-8 min-h-8 min-w-8 border px-2 text-xs transition",
              entry === page
                ? "border-[#f8e18e]/70 bg-[#f8e18e]/10 text-[#f8e18e]"
                : "border-white/10 text-white/60 hover:border-white/25 hover:text-white",
            )}
            key={entry}
            onClick={() => onChange(entry)}
            type="button"
          >
            {entry + 1}
          </button>
        ),
      )}
      <button
        className="button-quiet h-8 min-h-8 px-2 text-xs"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        type="button"
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

function ParticipantDetailsModal({
  bookable,
  disabled,
  onClose,
  onRequest,
  onShortlist,
  participant,
  requestOpen,
  shortlisted,
}: {
  bookable: boolean;
  disabled: boolean;
  onClose: () => void;
  onRequest: () => void;
  onShortlist: () => void;
  participant: Account;
  requestOpen: boolean;
  shortlisted: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div
        className="my-auto flex max-h-[88vh] w-full max-w-2xl flex-col border border-white/15 bg-[#0c0c0c] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#f8e18e]">Participant details</div>
          <button aria-label="Close" className="text-white/45 hover:text-white" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto p-4">
          <ParticipantDetailPanel participant={participant} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button className="button-quiet h-9 min-h-9 px-3 text-sm" onClick={onClose} type="button">
            Close
          </button>
          <button
            className={cn(
              "button-quiet h-9 min-h-9 px-3 text-sm",
              shortlisted && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]",
            )}
            onClick={onShortlist}
            type="button"
          >
            {shortlisted ? "Saved" : "Save"}
          </button>
          <button
            className="button-primary h-9 min-h-9 px-3 text-sm"
            disabled={disabled || requestOpen || !bookable}
            onClick={onRequest}
            title={bookable ? undefined : "This person hasn't opted in to being booked yet."}
            type="button"
          >
            <Send size={15} /> Request meeting
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscoverySummary({
  onShowPending,
  onShowRecommended,
  onReviewActions,
  stats,
}: {
  onShowPending: () => void;
  onShowRecommended: () => void;
  onReviewActions: () => void;
  stats: { greatLeads: number; openActions: number; pending: number; researched: number };
}) {
  return (
    <div className="grid gap-2 border-b border-white/10 bg-black/20 p-3 sm:grid-cols-3">
      <button className="border border-white/10 bg-[#101010] p-2 text-left transition hover:border-[#f8e18e]/45" onClick={onShowRecommended} type="button">
        <div className="text-lg font-semibold text-white">{stats.greatLeads}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">recommended</div>
      </button>
      <button className="border border-white/10 bg-[#101010] p-2 text-left transition hover:border-[#f8e18e]/45" onClick={onReviewActions} type="button">
        <div className="text-lg font-semibold text-white">{stats.openActions}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">open actions</div>
      </button>
      <button className="border border-white/10 bg-[#101010] p-2 text-left transition hover:border-[#f8e18e]/45" onClick={onShowPending} type="button">
        <div className="text-lg font-semibold text-white">{stats.pending}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">needs research</div>
      </button>
    </div>
  );
}

function companyAnchorId(company: string) {
  return `company-${company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown"}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function companyDirectoryGroups(items: DirectoryItem[]): CompanyGroup[] {
  const grouped = new Map<string, DirectoryItem[]>();
  for (const item of items) {
    const company = (item.participant.company || item.profile?.company || "Independent / unknown").trim();
    grouped.set(company, [...(grouped.get(company) ?? []), item]);
  }
  return [...grouped.entries()]
    .map(([company, groupItems]) => {
      const tracks = [...new Set(groupItems.flatMap((item) => participantTracks(item.participant, item.profile).map((track) => track.name)))];
      const sourceTotal = groupItems.reduce((total, item) => total + (item.profile ? sourceCount(item.profile) : 0), 0);
      const description = companyDescription(company, groupItems, tracks);
      return {
        company,
        description,
        items: groupItems.sort((a, b) => b.rank - a.rank || a.participant.displayName.localeCompare(b.participant.displayName)),
        sourceTotal,
        tracks,
      };
    })
    .sort((a, b) => {
      const bestRankDelta = (b.items[0]?.rank ?? 0) - (a.items[0]?.rank ?? 0);
      return bestRankDelta || b.sourceTotal - a.sourceTotal || a.company.localeCompare(b.company);
    });
}

function companyDescription(company: string, items: DirectoryItem[], tracks: string[]) {
  const sourcedProfile = items
    .map((item) => item.profile)
    .filter((profile): profile is DisplayParticipantProfile => Boolean(profile))
    .sort((a, b) => sourceCount(b) - sourceCount(a))[0];
  if (sourcedProfile) {
    const firstSentence = sourcedProfile.displayBioMarkdown
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)[0]
      .replace(new RegExp(`^${escapeRegExp(company)}\\s+`, "i"), "");
    if (firstSentence.length > 40) return firstSentence;
    return sourcedProfile.displayHeadline;
  }
  if (tracks.length) return `Likely relevant to ${tracks.slice(0, 3).join(", ")} based on attendee titles and profile data.`;
  return "Company context is limited to attendee-provided row data.";
}

function CompanyGroupCard({
  activeTargetIds,
  disabled,
  group,
  onQuickInterest,
  onSelect,
  onShowDetails,
  onShortlist,
  onWarm,
  selectedId,
  shortlistIds,
}: {
  activeTargetIds: Set<Id<"accounts">>;
  disabled: boolean;
  group: CompanyGroup;
  onQuickInterest: (participant: Account) => void;
  onSelect: (participant: Account) => void;
  onShowDetails: (participant: Account) => void;
  onShortlist: (participant: Account) => void;
  onWarm: (participant: Account) => void;
  selectedId: Id<"accounts"> | null;
  shortlistIds: Array<Id<"accounts">>;
}) {
  return (
    <section
      className="scroll-mt-4 border border-white/10 bg-black/25 p-3"
      id={companyAnchorId(group.company)}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Building2 className="text-[#f8e18e]" size={17} />
            <h3 className="truncate text-base font-semibold leading-6 text-white">{group.company}</h3>
            <Badge>{group.items.length} people</Badge>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/58">{group.description}</p>
          {group.tracks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.tracks.map((track) => <Badge key={track}>{track}</Badge>)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {group.items.map(({ participant, profile }) => {
          const schedule = participantSpeakerSchedule(participant);
          return (
            <div
              className={cn(
                "grid gap-2 border px-3 py-2 transition md:grid-cols-[minmax(0,1fr)_auto]",
                selectedId === participant._id
                  ? "border-[#f8e18e]/70 bg-[#f8e18e]/10"
                  : "border-white/10 bg-[#101010] hover:border-white/25",
            )}
            key={participant._id}
            onPointerEnter={() => onWarm(participant)}
          >
            <button className="min-w-0 text-left" onClick={() => onSelect(participant)} type="button">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold leading-5 text-white">{participant.displayName}</span>
                  <StatusBadge status={participant.ticketCategory} />
                  {schedule && <Badge>{speakerScheduleLabel(schedule)}</Badge>}
                  {activeTargetIds.has(participant._id) && <Badge>request open</Badge>}
                </div>
                <div className="mt-1 truncate text-xs leading-5 text-white/50">
                  {participant.title || profile?.title || "Title TBD"}
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/38">
                  {profile?.displayHeadline || participant.networkingIntent || "Profile row only"}
                </div>
              </button>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button className="button-quiet h-8 min-h-8 px-2 text-xs" onClick={() => onShowDetails(participant)} type="button">
                  Details
                </button>
                <button
                  className={cn(
                    "button-quiet h-8 min-h-8 px-2 text-xs",
                    shortlistIds.includes(participant._id) && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]",
                  )}
                  onClick={() => onShortlist(participant)}
                  type="button"
                >
                  {shortlistIds.includes(participant._id) ? "Saved" : "Save"}
                </button>
                <button
                  className="button-quiet h-8 min-h-8 px-2 text-xs"
                  disabled={disabled || activeTargetIds.has(participant._id) || !participant.hasAvailability}
                  onClick={() => onQuickInterest(participant)}
                  title={participant.hasAvailability ? undefined : "This person hasn't opted in to being booked yet."}
                  type="button"
                >
                  Request meeting
                </button>
              </div>
              {!participant.hasAvailability && (
                <p className="text-[11px] leading-4 text-white/40 md:col-start-2 md:text-right">
                  Not opted in to booking yet
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ParticipantCard({
  activeRequestOpen,
  bookable,
  disabled,
  isSelected,
  match,
  onClick,
  onQuickInterest,
  onShowDetails,
  onShortlist,
  onWarm,
  participant,
  profile,
  shortlisted,
}: {
  activeRequestOpen: boolean;
  bookable: boolean;
  disabled: boolean;
  isSelected: boolean;
  match: MatchSignal;
  onClick: () => void;
  onQuickInterest: () => void;
  onShowDetails: () => void;
  onShortlist: () => void;
  onWarm: () => void;
  participant: Account;
  profile: DisplayParticipantProfile | null;
  shortlisted: boolean;
}) {
  const tags = profile?.displayTags.length
    ? profile.displayTags
    : participant.topics.length
      ? participant.topics
      : [participant.city, participant.country].filter(Boolean);
  const schedule = participantSpeakerSchedule(participant);
  return (
    <div
      className={cn(
        "grid gap-2 border px-3 py-2.5 text-left transition md:grid-cols-[minmax(0,1fr)_auto]",
        isSelected
          ? "border-[#f8e18e]/70 bg-[#f8e18e]/10"
          : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.045]",
      )}
      onClick={onClick}
      onFocus={onWarm}
      onPointerEnter={onWarm}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-sm font-semibold leading-5 text-white md:text-[15px]">{participant.displayName}</h3>
          <StatusBadge status={participant.ticketCategory} />
          {schedule && <Badge>{speakerScheduleLabel(schedule)}</Badge>}
          {activeRequestOpen && <Badge>request open</Badge>}
        </div>
        <p className="mt-1 truncate text-sm leading-5 text-white/62">
          {participant.title || profile?.title || "Title TBD"} · {participant.company || profile?.company || "Company TBD"}
        </p>
        <p className="mt-1 truncate text-xs leading-5 text-white/45">
          {profile?.displayHeadline || participant.networkingIntent || [participant.city, participant.country].filter(Boolean).join(", ") || "Profile research pending"}
        </p>
      </div>
      <div className="grid gap-2 md:min-w-[220px] md:justify-items-end">
        <div className="hidden max-w-[280px] justify-self-end md:block">
          <CompactTagRow items={(match.reasons.length ? match.reasons : tags).slice(0, 3)} />
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <button
            className="button-quiet h-8 min-h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onShowDetails();
            }}
            type="button"
          >
            Details
          </button>
          <button
            className={cn(
              "button-quiet h-8 min-h-8 px-2 text-xs",
              shortlisted && "border-[#f8e18e]/45 bg-[#f8e18e]/10 text-[#f8e18e]",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onShortlist();
            }}
            type="button"
          >
            {shortlisted ? "Saved" : "Save"}
          </button>
          <button
            className="button-quiet h-8 min-h-8 px-2 text-xs"
            disabled={disabled || activeRequestOpen || !bookable}
            onClick={(event) => {
              event.stopPropagation();
              onQuickInterest();
            }}
            title={bookable ? undefined : "This person hasn't opted in to being booked yet."}
            type="button"
          >
            Request meeting
          </button>
        </div>
        {!bookable && (
          <p className="text-right text-[11px] leading-4 text-white/40">
            Not opted in to booking yet
          </p>
        )}
      </div>
    </div>
  );
}

function ParticipantResultsList({
  activeTargetIds,
  disabled,
  items,
  onQuickInterest,
  onSelect,
  onShowDetails,
  onShortlist,
  onWarm,
  selectedId,
  shortlistIds,
}: {
  activeTargetIds: Set<Id<"accounts">>;
  disabled: boolean;
  items: DirectoryItem[];
  onQuickInterest: (participant: Account) => void;
  onSelect: (participant: Account) => void;
  onShowDetails: (participant: Account) => void;
  onShortlist: (participant: Account) => void;
  onWarm: (participant: Account) => void;
  selectedId: Id<"accounts"> | null;
  shortlistIds: Array<Id<"accounts">>;
}) {
  const shouldWindow = items.length > 40;
  const estimatePx = 98;
  const overscan = 10;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ end: 40, start: 0 });

  useEffect(() => {
    if (!shouldWindow) return;

    let frame = 0;
    const updateRange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const top = container.getBoundingClientRect().top + window.scrollY;
        const viewportTop = window.scrollY;
        const viewportBottom = viewportTop + window.innerHeight;
        const start = Math.max(0, Math.floor((viewportTop - top) / estimatePx) - overscan);
        const end = Math.min(items.length, Math.ceil((viewportBottom - top) / estimatePx) + overscan);
        setRange((current) => current.start === start && current.end === end ? current : { end, start });
      });
    };

    updateRange();
    window.addEventListener("scroll", updateRange, { passive: true });
    window.addEventListener("resize", updateRange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateRange);
      window.removeEventListener("resize", updateRange);
    };
  }, [items.length, shouldWindow]);

  const start = shouldWindow ? Math.min(range.start, items.length) : 0;
  const end = shouldWindow ? Math.min(Math.max(range.end, start), items.length) : items.length;
  const paddingTop = start * estimatePx;
  const paddingBottom = Math.max(0, (items.length - end) * estimatePx);
  const visibleItems = shouldWindow ? items.slice(start, end) : items;

  return (
    <div ref={containerRef} className="grid gap-1.5">
      {paddingTop > 0 && <div aria-hidden="true" style={{ height: paddingTop }} />}
      {visibleItems.map(({ match, participant, profile }) => (
        <ParticipantCard
          key={participant._id}
          activeRequestOpen={activeTargetIds.has(participant._id)}
          bookable={participant.hasAvailability}
          disabled={disabled}
          isSelected={selectedId === participant._id}
          match={match}
          onShortlist={() => onShortlist(participant)}
          onShowDetails={() => onShowDetails(participant)}
          onQuickInterest={() => onQuickInterest(participant)}
          participant={participant}
          profile={profile}
          shortlisted={shortlistIds.includes(participant._id)}
          onClick={() => onSelect(participant)}
          onWarm={() => onWarm(participant)}
        />
      ))}
      {paddingBottom > 0 && <div aria-hidden="true" style={{ height: paddingBottom }} />}
    </div>
  );
}

function StarterPicks({
  onSelect,
  onWarm,
  picks,
  selectedId,
}: {
  onSelect: (participant: Account) => void;
  onWarm: (participant: Account) => void;
  picks: Array<{ match: MatchSignal; participant: Account; profile: DisplayParticipantProfile | null }>;
  selectedId: Id<"accounts"> | null;
}) {
  const selectedPickId = selectedId && picks.some(({ participant }) => participant._id === selectedId)
    ? selectedId
    : "";

  function selectPick(participantId: string) {
    const pick = picks.find(({ participant }) => participant._id === participantId);
    if (!pick) return;
    onWarm(pick.participant);
    onSelect(pick.participant);
  }

  return (
    <div className="min-w-0 border-b border-white/10 bg-black/20 px-3 py-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#f8e18e]">Quick start</div>
          <div className="mt-1 text-xs leading-5 text-white/45">Optional suggested intros. Pick one or skip to the full directory below.</div>
        </div>
      </div>
      <select
        aria-label="Quick start suggestion"
        className="input sm:hidden"
        onChange={(event) => selectPick(event.target.value)}
        value={selectedPickId}
      >
        <option value="">Select a suggested intro...</option>
        {picks.map(({ match, participant, profile }) => (
          <option key={participant._id} value={participant._id}>
            {participant.displayName} · {participant.company || profile?.company || match.reasons[0] || "Suggested intro"}
          </option>
        ))}
      </select>
      <div className="hidden max-w-full min-w-0 overflow-x-auto overscroll-x-contain pb-1 sm:block">
        <div className="flex w-max gap-2">
        {picks.map(({ match, participant, profile }) => {
          const schedule = participantSpeakerSchedule(participant);
          return (
            <button
              className={cn(
                "grid min-h-28 w-[320px] min-w-0 flex-none content-between gap-2 overflow-hidden border p-3 text-left transition",
                selectedId === participant._id
                  ? "border-[#f8e18e]/70 bg-[#f8e18e]/10"
                  : "border-white/10 bg-[#101010] hover:border-[#f8e18e]/45 hover:bg-[#f8e18e]/5",
              )}
              key={participant._id}
              onClick={() => onSelect(participant)}
              onFocus={() => onWarm(participant)}
              onPointerEnter={() => onWarm(participant)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold leading-5 text-white">{participant.displayName}</span>
                  {schedule && <Badge>{speakerScheduleLabel(schedule)}</Badge>}
                </div>
                <div className="mt-1 truncate text-xs leading-5 text-white/55">
                  {participant.title || profile?.title || "Title TBD"} · {participant.company || profile?.company || "Company TBD"}
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-white/45">
                  {profile?.displayHeadline || participant.networkingIntent || "Researched profile"}
                </div>
              </div>
              <div className="min-w-0">
                {match.reasons.slice(0, 1).map((reason) => (
                  <span className="block truncate text-[11px] leading-5 text-white/38" key={reason}>{reason}</span>
                ))}
              </div>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function ShortlistTray({
  items,
  onClear,
  onSelect,
  onWarm,
  selectedId,
}: {
  items: Array<{ match: MatchSignal; participant: Account; profile: DisplayParticipantProfile | null }>;
  onClear: () => void;
  onSelect: (participant: Account) => void;
  onWarm: (participant: Account) => void;
  selectedId: Id<"accounts"> | null;
}) {
  return (
    <div className="border-b border-white/10 bg-[#0d0d0d] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Saved list</div>
        <button className="button-quiet h-7 min-h-7 px-2 text-[11px]" onClick={onClear} type="button">
          Clear
        </button>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {items.map(({ participant, profile }) => {
          const schedule = participantSpeakerSchedule(participant);
          return (
            <button
              className={cn(
                "min-w-[220px] border p-2 text-left transition",
                selectedId === participant._id
                  ? "border-[#f8e18e]/70 bg-[#f8e18e]/10"
                  : "border-white/10 bg-black/25 hover:border-white/25",
              )}
              key={participant._id}
              onClick={() => onSelect(participant)}
              onFocus={() => onWarm(participant)}
              onPointerEnter={() => onWarm(participant)}
              type="button"
            >
              <div className="truncate text-xs font-semibold text-white">{participant.displayName}</div>
              <div className="mt-1 truncate text-[11px] text-white/45">{participant.company || profile?.company || "Company TBD"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {schedule && <Badge>{speakerScheduleLabel(schedule)}</Badge>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantDetailPanel({ participant }: { participant: Account }) {
  const profile = participantProfileFor(participant);
  const schedule = participantSpeakerSchedule(participant);
  const location = [participant.city, participant.country].filter(Boolean).join(", ");
  return (
    <section className="grid gap-3">
      <div className="border border-white/10 bg-black/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-6">{participant.displayName}</h2>
          <StatusBadge status={participant.ticketCategory} />
          {schedule && <Badge>{speakerScheduleLabel(schedule)}</Badge>}
          <Badge>{participant.directoryOptIn ? "directory visible" : "hidden"}</Badge>
        </div>
        <div className="mt-2 text-sm leading-6 text-white/62">
          {participant.title || "Title TBD"} · {participant.company || "Company TBD"}
        </div>
        {location && <div className="mt-1 text-xs leading-5 text-white/42">{location}</div>}
      </div>
      {schedule && (
        <section className="border border-[#f8e18e]/25 bg-[#f8e18e]/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#f8e18e]">
            Speaker schedule
          </div>
          <p className="mt-1 text-xs leading-5 text-[#f8e18e]/75">
            Most likely onsite {schedule.dateLabels.join(", ")}.
          </p>
          <div className="mt-3 grid gap-2">
            {schedule.sessions.map((session) => (
              <div className="border border-[#f8e18e]/20 bg-black/20 p-2" key={`${session.title}-${session.time}-${session.room}`}>
                <div className="text-sm font-semibold leading-5 text-white">{session.title}</div>
                <div className="mt-1 text-xs leading-5 text-white/55">
                  {[session.dateLabel, session.time, session.room, session.track].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {profile ? (
        <ParticipantProfilePanel profile={profile} />
      ) : (
        <div className="border border-white/10 bg-black/25 p-3">
          <div className="text-sm font-semibold text-white/75">Research pending</div>
          <p className="mt-2 text-sm leading-6 text-white/50">
            No researched profile has been added for this participant yet. Current row data is limited to ticket,
            company, title, and location.
          </p>
          <TagRow items={[participant.networkingIntent, ...participant.topics].filter(Boolean)} />
        </div>
      )}
    </section>
  );
}

function ParticipantProfilePanel({
  compact = false,
  profile,
}: {
  compact?: boolean;
  profile: DisplayParticipantProfile | null;
}) {
  if (!profile) {
    return (
      <div className="border border-white/10 bg-black/25 p-3 text-sm leading-6 text-white/45">
        No researched profile has been added yet.
      </div>
    );
  }
  return (
    <section className="border border-white/10 bg-black/25 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{profileBadgeLabel(profile)}</Badge>
        <Badge>{profile.confidence} confidence</Badge>
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-6 text-white/85">{profile.displayHeadline}</h3>
      <div className="mt-2 whitespace-pre-line text-sm leading-6 text-white/62">
        {profile.displayBioMarkdown}
      </div>
      <TagRow items={profile.displayTags} />
      {!compact && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="text-xs leading-5 text-white/42">
            {profile.confidenceNote}
          </p>
        </div>
      )}
    </section>
  );
}

function ProfileView({
  actionPending,
  actor,
  availability,
  previewMode,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  availability: AvailabilitySlot[];
  previewMode?: boolean;
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const updateMyProfile = useMutation(api.networking.updateMyProfile);
  const setMyAvailability = useMutation(api.networking.setMyAvailability);
  const setMyDayAvailability = useMutation(api.networking.setMyDayAvailability);
  const researchedProfile = participantProfileFor(actor);
  const profileConfirmationDetail = actor.profileOverride
    ? `confirmed · last edited ${editedAtLabel(actor.profileOverride.updatedAt)}`
    : researchedProfile
      ? "AI researched · needs your confirmation"
      : "needs your confirmation";
  const [dragAvailability, setDragAvailability] = useState<boolean | null>(null);
  const [dragDayAvailability, setDragDayAvailability] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    displayName: actor.displayName,
    title: actor.title,
    company: actor.company,
    city: actor.city,
    country: actor.country,
    networkingIntent: actor.networkingIntent,
    topics: actor.topics.join("; "),
    directoryOptIn: actor.directoryOptIn,
    profileHeadline: actor.profileOverride?.headline || researchedProfile?.headline || "",
    profileBioMarkdown: actor.profileOverride?.bioMarkdown || researchedProfile?.bioMarkdown || "",
    profileTags: (actor.profileOverride?.tags.length ? actor.profileOverride.tags : researchedProfile?.tags ?? actor.topics).join("; "),
    profilePrimarySources: sourceLines(actor.profileOverride?.sources?.primary ?? researchedProfile?.sources.primary ?? []),
    profileSecondarySources: sourceLines(actor.profileOverride?.sources?.secondary ?? researchedProfile?.sources.secondary ?? []),
    participantApproved: actor.profileOverride?.participantApproved || researchedProfile?.participantApproved || false,
  });

  if (actor.role !== "participant") {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <UserCheck className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Admin profile</h2>
        <p className="mt-2 text-sm text-white/55">Switch to a participant to manage profile and availability.</p>
      </section>
    );
  }

  if (previewMode) {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <UserCheck className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Participant profile preview</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          Admin preview shows participant navigation without changing the signed-in account. Switch to an actual
          participant session to edit profile details or availability.
        </p>
      </section>
    );
  }

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    void runAction(
      () =>
        updateMyProfile({
          sessionToken,
          ...form,
        }),
      "Profile confirmed.",
    );
  }

  function setSlotAvailability(date: string, startMinute: number, available: boolean) {
    void setMyAvailability({
      sessionToken,
      date,
      startMinute,
      available,
    }).catch((error) => {
      setDragAvailability(null);
      void runAction(() => Promise.reject(error), "");
    });
  }

  function setDayAvailability(date: string, label: string, available: boolean) {
    void runAction(
      () => setMyDayAvailability({ sessionToken, date, available }),
      `${label} ${available ? "opened" : "hidden"}.`,
    );
  }

  function beginSlotDrag(date: string, startMinute: number, available: boolean) {
    const nextAvailable = !available;
    setDragAvailability(nextAvailable);
    setSlotAvailability(date, startMinute, nextAvailable);
  }

  function enterSlotDrag(date: string, startMinute: number, available: boolean) {
    if (dragAvailability === null || available === dragAvailability) return;
    setSlotAvailability(date, startMinute, dragAvailability);
  }

  function beginDayDrag(date: string, label: string, openCount: number) {
    const nextAvailable = openCount < slotLabels.length;
    setDragDayAvailability(nextAvailable);
    setDayAvailability(date, label, nextAvailable);
  }

  function enterDayDrag(date: string, label: string, openCount: number) {
    if (dragDayAvailability === null) return;
    if ((dragDayAvailability && openCount === slotLabels.length) || (!dragDayAvailability && openCount === 0)) return;
    setDayAvailability(date, label, dragDayAvailability);
  }

  return (
    <div
      className="grid gap-4"
      onPointerLeave={() => {
        setDragAvailability(null);
        setDragDayAvailability(null);
      }}
      onPointerUp={() => {
        setDragAvailability(null);
        setDragDayAvailability(null);
      }}
    >
      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Clock3 size={17} />} title="Your availability" detail="click or drag slots and day headers" />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {eventDateEntries(settings).map(([date, label]) => {
            const dayAvailability = availability.filter((slot) => slot.date === date);
            const openCount = dayAvailability.filter((slot) => slot.available).length;
            const dayFullyOpen = openCount === slotLabels.length;
            return (
              <div
                key={date}
                className="grid min-w-0 content-start gap-2 border border-white/10 bg-black/20 p-3"
                onPointerEnter={() => enterDayDrag(date, label, openCount)}
              >
                <div className="grid gap-2">
                  <button
                    aria-label={`Toggle all availability for ${label}`}
                    aria-pressed={dayFullyOpen}
                    className={cn(
                      "cursor-pointer border px-3 py-2 text-left transition active:cursor-grabbing",
                      dayFullyOpen
                        ? "border-emerald-300/25 bg-emerald-300/10"
                        : "border-white/10 bg-white/[0.035] hover:border-[#f8e18e]/40",
                    )}
                    disabled={actionPending}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      beginDayDrag(date, label, openCount);
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-white/78">{label}</span>
                      <span className="text-xs text-white/45">{openCount} open</span>
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-white/35">
                      Click or drag day to {dayFullyOpen ? "hide" : "open"} all
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button-quiet h-8 min-h-8 cursor-pointer px-2 text-xs"
                      disabled={actionPending}
                      onClick={() => setDayAvailability(date, label, true)}
                      type="button"
                    >
                      Open all
                    </button>
                    <button
                      className="button-quiet h-8 min-h-8 cursor-pointer px-2 text-xs"
                      disabled={actionPending}
                      onClick={() => setDayAvailability(date, label, false)}
                      type="button"
                    >
                      Hide all
                    </button>
                  </div>
                </div>
                <div className="grid select-none gap-2">
                  {slotLabels.map((slot) => {
                    const availabilitySlot = dayAvailability.find((item) => item.startMinute === slot.minute);
                    const available = availabilitySlot?.available ?? false;
                    return (
                      <button
                        key={`${date}:${slot.minute}`}
                        type="button"
                        aria-pressed={available}
                        className={cn(
                          "flex h-12 min-w-0 cursor-pointer touch-none flex-col items-center justify-center border px-2 text-xs font-semibold leading-tight transition active:cursor-grabbing",
                          available
                            ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                            : "border-white/10 bg-white/[0.035] text-white/45 hover:border-[#f8e18e]/35",
                        )}
                        disabled={actionPending}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          beginSlotDrag(date, slot.minute, available);
                        }}
                        onPointerEnter={() => {
                          if (dragDayAvailability !== null) return;
                          enterSlotDrag(date, slot.minute, available);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setSlotAvailability(date, slot.minute, !available);
                        }}
                      >
                        <span>{slot.label}</span>
                        <span className="mt-0.5 text-[10px] font-medium opacity-70">
                          {available ? "Open" : "Hidden"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
      <form onSubmit={saveProfile} className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<UserCheck size={17} />} title="Profile confirmation" detail={profileConfirmationDetail} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required />
          </Field>
          <Field label="Company">
            <input className="input" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} required />
          </Field>
          <Field label="Title">
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </Field>
          <Field label="Location">
            <input
              className="input"
              value={[form.city, form.country].filter(Boolean).join(", ")}
              onChange={(event) => {
                const [city, country = ""] = event.target.value.split(",").map((part) => part.trim());
                setForm({ ...form, city, country });
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Networking intent">
              <textarea
                className="input min-h-24 resize-none"
                value={form.networkingIntent}
                onChange={(event) => setForm({ ...form, networkingIntent: event.target.value })}
                placeholder="Who do you want to meet and why?"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Topics">
              <input
                className="input"
                value={form.topics}
                onChange={(event) => setForm({ ...form, topics: event.target.value })}
                placeholder="agents; evals; consumer AI"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Directory headline">
              <input
                className="input"
                value={form.profileHeadline}
                onChange={(event) => setForm({ ...form, profileHeadline: event.target.value })}
                placeholder="What should people know you for?"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Directory bio">
              <textarea
                className="input min-h-32 resize-y"
                value={form.profileBioMarkdown}
                onChange={(event) => setForm({ ...form, profileBioMarkdown: event.target.value })}
                placeholder="A concise, public-facing profile for the directory."
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Directory tags">
              <input
                className="input"
                value={form.profileTags}
                onChange={(event) => setForm({ ...form, profileTags: event.target.value })}
                placeholder="AI governance; agents; infrastructure"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Toggle
              label="Hide me from the booking directory"
              checked={!form.directoryOptIn}
              onChange={(value) => setForm({ ...form, directoryOptIn: !value })}
            />
            <p className="mt-1 text-xs leading-5 text-white/45">
              You&apos;re listed by default so people can request meetings with you. Check this to opt out of the directory.
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 p-4">
          <button className="button-primary" disabled={actionPending} type="submit">
            <Check size={15} /> Confirm profile
          </button>
        </div>
      </form>

      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Search size={17} />} title="Research preview" detail={researchedProfile ? "shown in directory" : "not researched"} />
        <div className="p-4">
          <ParticipantProfilePanel profile={researchedProfile} />
        </div>
      </section>
      </div>
    </div>
  );
}

function RequestsView({
  actionPending,
  actor,
  interests,
  previewMode,
  requests,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  interests: MeetingInterest[];
  previewMode?: boolean;
  requests: MeetingRequest[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const respond = useMutation(api.networking.respondToPeerRequest);
  const respondInterest = useMutation(api.networking.respondToMeetingInterest);
  const confirmCounter = useMutation(api.networking.confirmCounter);
  const cancelRequest = useMutation(api.networking.cancelRequest);
  const cancelInterest = useMutation(api.networking.cancelMeetingInterest);
  const visible: Array<
    ({ kind: "request" } & MeetingRequest) | ({ kind: "interest" } & MeetingInterest)
  > = [
    ...requests
      .filter((request) => {
        if (actor.role === "admin") return true;
        return request.requesterAccountId === actor._id || request.targetAccountId === actor._id;
      })
      .map((request) => ({ ...request, kind: "request" as const })),
    ...interests
      .filter((interest) => {
        if (actor.role === "admin") return true;
        return interest.requesterAccountId === actor._id || interest.targetAccountId === actor._id;
      })
      .map((interest) => ({ ...interest, kind: "interest" as const })),
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader icon={<ListChecks size={17} />} title="Request queue" detail={`${visible.length} visible`} />
      {previewMode && (
        <div className="border-b border-[#f8e18e]/25 bg-[#f8e18e]/10 px-4 py-3 text-sm leading-6 text-[#f8e18e]">
          Admin preview uses participant-scoped filtering. Meeting actions are disabled.
        </div>
      )}
      <div className="divide-y divide-white/10">
        {visible.length === 0 && <EmptyState title="No requests yet" detail="Incoming and outgoing meeting requests will appear here." />}
        {visible.map((item) => {
          const incoming = item.targetAccountId === actor._id;
          const isInterest = item.kind === "interest";
          const counterStartMinute =
            !isInterest
              ? slotLabels.find((slot) => slot.minute > item.preferredStartMinute)?.minute ??
                slotLabels[0]?.minute
              : undefined;
          return (
            <article key={`${item.kind}:${item._id}`} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">
                    {item.requester?.displayName ?? "Requester"} → {item.target?.displayName ?? "Participant"}
                  </h3>
                  <Badge>{isInterest ? "any-time request" : "timed request"}</Badge>
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-white/45">
                    {isInterest ? "Next mutual slot" : `${dateLabels[item.date]} · ${minuteLabel(item.preferredStartMinute)}`}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/60">{item.reason}</p>
                <p className="mt-2 text-xs text-white/45">
                  {item.context || `${item.requester?.title ?? ""} ${item.requester?.company ?? ""}`.trim()}
                </p>
                {isInterest && item.status === "pending" && (
                  <p className="mt-2 text-xs leading-5 text-white/45">
                    Accepting this will book the earliest slot where both participants are available.
                  </p>
                )}
                {item.meeting && (
                  <div className="mt-3 border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">
                    {dateLabels[item.meeting.date]} · {minuteLabel(item.meeting.startMinute)} · Table {item.meeting.tableNumber} · group {item.meeting.participantCount}/{settings.maxMeetingGroupSize}
                  </div>
                )}
                {item.responseNote && <p className="mt-2 text-xs text-white/45">{item.responseNote}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {(incoming || actor.role === "admin") && (item.status === "pending" || item.status === "countered") && (
                  <>
                    <button
                      className="button-quiet"
                      disabled={actionPending || previewMode}
                      onClick={() =>
                        void runAction(
                          () =>
                            isInterest
                              ? respondInterest({ sessionToken, interestId: item._id, action: "decline", note: "Declined from queue." })
                              : respond({ sessionToken, requestId: item._id, action: "decline", note: "Declined from queue." }),
                          isInterest ? "Interest declined." : "Request declined.",
                        )
                      }
                    >
                      <X size={15} /> Decline
                    </button>
                    {!isInterest && (
                      <button
                        className="button-quiet"
                        disabled={actionPending || previewMode || counterStartMinute === undefined}
                        onClick={() => {
                          if (counterStartMinute === undefined) return;
                          void runAction(
                            () =>
                              respond({
                                sessionToken,
                                requestId: item._id,
                                action: "counter",
                                counterStartMinute,
                                note: `Countered to ${minuteLabel(counterStartMinute)}.`,
                              }),
                            "Counter sent.",
                          );
                        }}
                      >
                        <Clock3 size={15} /> Counter
                      </button>
                    )}
                    <button
                      className="button-primary"
                      disabled={actionPending || previewMode}
                      onClick={() =>
                        void runAction(
                          () =>
                            isInterest
                              ? respondInterest({ sessionToken, interestId: item._id, action: "accept", note: "Accepted from queue." })
                              : respond({ sessionToken, requestId: item._id, action: "accept", note: "Accepted from queue." }),
                          isInterest ? "Interest accepted and scheduled." : "Request accepted.",
                        )
                      }
                    >
                      <Check size={15} /> {isInterest ? "Accept interest" : "Accept"}
                    </button>
                  </>
                )}
                {!isInterest && item.requesterAccountId === actor._id && item.status === "countered" && (
                  <button
                    className="button-primary"
                    disabled={actionPending || previewMode}
                    onClick={() => void runAction(() => confirmCounter({ sessionToken, requestId: item._id }), "Counter confirmed.")}
                  >
                    <Check size={15} /> Confirm counter
                  </button>
                )}
                {item.requesterAccountId === actor._id && (item.status === "pending" || item.status === "countered") && (
                  <button
                    className="button-quiet"
                    disabled={actionPending || previewMode}
                    onClick={() =>
                      void runAction(
                        () =>
                          isInterest
                            ? cancelInterest({ sessionToken, interestId: item._id })
                            : cancelRequest({ sessionToken, requestId: item._id }),
                        isInterest ? "Interest cancelled." : "Request cancelled.",
                      )
                    }
                  >
                    <X size={15} /> Cancel
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ScheduleView({
  actionPending,
  actor,
  meetings,
  previewMode,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  meetings: Meeting[];
  previewMode?: boolean;
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const moveMeeting = useMutation(api.networking.moveMeeting);
  const updateMeetingStatus = useMutation(api.networking.updateMeetingStatus);
  const visible = meetings
    .filter((meeting) => {
      if (actor.role === "admin") return true;
      return meeting.participants.some((participant) => participant.accountId === actor._id);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.tableNumber - b.tableNumber);

  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader
        icon={<CalendarDays size={17} />}
        title="Confirmed schedule"
        detail={`${visible.length} meetings`}
        action={
          <button
            className="button-quiet"
            onClick={() =>
              csvDownload("aiewf-networking-schedule.csv", [
                ["date", "time", "table", "participants", "status"],
                ...visible.map((meeting) => [
                  meeting.date,
                  minuteLabel(meeting.startMinute),
                  String(meeting.tableNumber),
                  meeting.participants.map((participant) => participant.account?.displayName ?? "Participant").join("; "),
                  meeting.status,
                ]),
              ])
            }
          >
            <Download size={15} /> Export
          </button>
        }
      />
      {previewMode && (
        <div className="border-b border-[#f8e18e]/25 bg-[#f8e18e]/10 px-4 py-3 text-sm leading-6 text-[#f8e18e]">
          Admin preview shows the participant-scoped schedule. Switch back to admin view for room-wide controls.
        </div>
      )}
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        {visible.length === 0 && (
          <div className="lg:col-span-2">
            <EmptyState title="No confirmed meetings" detail="Accepted requests will appear here with table assignment." />
          </div>
        )}
        {visible.map((meeting) => (
          <article key={meeting._id} className="grid gap-4 border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-lg text-[#f8e18e]">Table {meeting.tableNumber}</div>
                <div className="mt-1 text-sm text-white/55">
                  {dateLabels[meeting.date]} · {minuteLabel(meeting.startMinute)}
                </div>
              </div>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="grid gap-2">
              {meeting.participants.map((participant) => (
                <div key={participant._id} className="flex items-start justify-between gap-3 border border-white/10 bg-black/30 p-3">
                  <div>
                    <div className="font-semibold">{participant.account?.displayName ?? "Participant"}</div>
                    <div className="mt-1 text-xs text-white/45">
                      {participant.account?.title} · {participant.account?.company}
                    </div>
                  </div>
                  <Badge>{participant.role}</Badge>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {actor.role === "admin" ? (
                <>
                  <select
                    aria-label="Move meeting time"
                    className="small-input w-28"
                    disabled={actionPending}
                    value={meeting.startMinute}
                    onChange={(event) =>
                      void runAction(
                        () =>
                          moveMeeting({
                            sessionToken,
                            meetingId: meeting._id,
                            startMinute: Number(event.target.value),
                            tableNumber: meeting.tableNumber,
                          }),
                        "Meeting moved.",
                      )
                    }
                  >
                    {slotLabels.map((slot) => (
                      <option key={slot.minute} value={slot.minute}>{slot.label}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Reassign table"
                    className="small-input w-20"
                    disabled={actionPending}
                    value={meeting.tableNumber}
                    onChange={(event) =>
                      void runAction(
                        () =>
                          moveMeeting({
                            sessionToken,
                            meetingId: meeting._id,
                            startMinute: meeting.startMinute,
                            tableNumber: Number(event.target.value),
                          }),
                        "Table reassigned.",
                      )
                    }
                  >
                    {Array.from({ length: settings.activeTables + settings.reserveTables }, (_, index) => (
                      <option key={index + 1} value={index + 1}>T{index + 1}</option>
                    ))}
                  </select>
                </>
              ) : (
                <button
                  className="button-quiet"
                  disabled={actionPending || previewMode}
                  onClick={() =>
                    void runAction(
                      () =>
                        updateMeetingStatus({
                          sessionToken,
                          meetingId: meeting._id,
                          status: meeting.status === "completed" ? "confirmed" : "completed",
                        }),
                      "Meeting status updated.",
                    )
                  }
                >
                  <Check size={15} /> Toggle done
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminView({
  actionPending,
  actor,
  demoLoginEnabled,
  importBatches,
  interests,
  meetings,
  requests,
  runAction,
  sessionToken,
  setSessionToken,
  settings,
}: {
  actionPending: boolean;
  actor: Account;
  demoLoginEnabled: boolean;
  importBatches: ImportBatch[];
  interests: MeetingInterest[];
  meetings: Meeting[];
  requests: MeetingRequest[];
  runAction: RunAction;
  sessionToken: string;
  setSessionToken: (token: string | null) => void;
  settings: Settings;
}) {
  const updateSettings = useMutation(api.networking.updateSettings);
  const upsertParticipants = useMutation(api.networking.upsertParticipantsFromRows);
  const setParticipantOptIn = useMutation(api.networking.setParticipantOptIn);
  const resetDemoData = useMutation(api.networking.resetDemoData);
  const [participantSearch, setParticipantSearch] = useState("");
  const adminParticipants = useQuery(api.networking.listAdminParticipants, {
    sessionToken,
    search: participantSearch,
  }) as AdminParticipantsResult | undefined;
  const participants = visibleAccounts(adminParticipants?.participants);
  const [form, setForm] = useState({
    dayStartMinute: settings.dayStartMinute,
    dayEndMinute: settings.dayEndMinute,
    slotMinutes: settings.slotMinutes,
    activeTables: settings.activeTables,
    reserveTables: settings.reserveTables,
    outgoingRequestCapPerDay: settings.outgoingRequestCapPerDay,
    maxMeetingGroupSize: settings.maxMeetingGroupSize,
    allowCounters: settings.allowCounters,
  });
  const [csv, setCsv] = useState("First Name,Last Name,Email,Registration Status,Ticket Type,Company,Title,Holder Email,Holder Company Name,Holder Job Title\nAda,Lovelace,ada@example.com,REGISTERED,AI Leadership (All Access),Analytical Engines,Founder,ada@example.com,Analytical Engines,Founder");

  if (actor.role !== "admin") {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <Settings2 className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Admin access required</h2>
      </section>
    );
  }

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    void runAction(() => updateSettings({ sessionToken, ...form }), "Settings updated.");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid gap-4">
        <form onSubmit={saveSettings} className="border border-white/10 bg-[#101010]">
          <SectionHeader icon={<SlidersHorizontal size={17} />} title="Room settings" detail="admin controls" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <NumberField label="Day start minute" value={form.dayStartMinute} onChange={(value) => setForm({ ...form, dayStartMinute: value })} />
            <NumberField label="Day end minute" value={form.dayEndMinute} onChange={(value) => setForm({ ...form, dayEndMinute: value })} />
            <NumberField label="Slot minutes" value={form.slotMinutes} onChange={(value) => setForm({ ...form, slotMinutes: value })} />
            <NumberField label="Active tables" value={form.activeTables} onChange={(value) => setForm({ ...form, activeTables: value })} />
            <NumberField label="Reserve tables" value={form.reserveTables} onChange={(value) => setForm({ ...form, reserveTables: value })} />
            <NumberField label="Outgoing cap" value={form.outgoingRequestCapPerDay} onChange={(value) => setForm({ ...form, outgoingRequestCapPerDay: value })} />
            <NumberField label="Max group size" value={form.maxMeetingGroupSize} onChange={(value) => setForm({ ...form, maxMeetingGroupSize: value })} />
            <Toggle label="Allow counters" checked={form.allowCounters} onChange={(value) => setForm({ ...form, allowCounters: value })} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-white/10 p-4">
            <button className="button-primary" disabled={actionPending} type="submit">
              <Settings2 size={15} /> Save settings
            </button>
            {demoLoginEnabled && (
              <button
                type="button"
                className="button-quiet"
                disabled={actionPending}
                onClick={() =>
                  void runAction(
                    () =>
                      resetDemoData({ sessionToken }).then((result) => {
                        setSessionToken(result.token);
                      }),
                    "Demo data reset.",
                  )
                }
              >
                <RotateCcw size={15} /> Reset demo data
              </button>
            )}
          </div>
        </form>

        <section className="border border-white/10 bg-[#101010]">
          <SectionHeader
            icon={<Users size={17} />}
            title="Participant inventory"
            detail={
              adminParticipants
                ? `${adminParticipants.totalMatches} matches`
                : "loading"
            }
          />
          <div className="border-b border-white/10 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" size={16} />
              <input
                value={participantSearch}
                onChange={(event) => setParticipantSearch(event.target.value)}
                className="input pl-9"
                placeholder="Search name, email, company, ticket"
              />
            </div>
            {adminParticipants?.hasMore && (
              <p className="mt-2 text-xs text-white/45">
                Showing first {adminParticipants.limit}. Narrow the search to manage a specific participant.
              </p>
            )}
          </div>
          <div className="grid gap-3 p-3">
            {adminParticipants === undefined && (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="animate-spin" size={16} /> Loading participants
              </div>
            )}
            {adminParticipants !== undefined && participants.length === 0 && (
              <p className="text-sm text-white/50">No participants match that search.</p>
            )}
            {participants.map((participant) => (
              <div key={participant._id} className="grid gap-3 border border-white/10 bg-black/25 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{participant.displayName}</h3>
                    <StatusBadge status={participant.directoryOptIn ? "opted_in" : "hidden"} />
                    <StatusBadge status={participant.ticketCategory} />
                  </div>
                  <p className="mt-1 text-sm text-white/55">{participant.title || "Missing title"} · {participant.company || "Missing company"}</p>
                  <p className="mt-1 text-xs text-white/40">{participant.email}</p>
                </div>
                <button
                  className={participant.directoryOptIn ? "button-quiet" : "button-primary"}
                  disabled={actionPending}
                  onClick={() =>
                    void runAction(
                      () =>
                        setParticipantOptIn({
                          sessionToken,
                          accountId: participant._id,
                          directoryOptIn: !participant.directoryOptIn,
                        }),
                      participant.directoryOptIn ? "Participant hidden." : "Participant opted in.",
                    )
                  }
                >
                  {participant.directoryOptIn ? <X size={15} /> : <Check size={15} />}
                  {participant.directoryOptIn ? "Hide" : "Opt in"}
                </button>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="border border-white/10 bg-[#101010] p-4 xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
          <Database size={16} /> Data ops
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="button-quiet"
            onClick={() =>
              csvDownload("aiewf-participants.csv", [
                ["name", "email", "company", "title", "ticket", "signedUp", "directoryOptIn"],
                ...participants.map((participant) => [
                  participant.displayName,
                  participant.email,
                  participant.company,
                  participant.title,
                  participant.ticketType,
                  String(participant.signedUp),
                  String(participant.directoryOptIn),
                ]),
              ])
            }
          >
            <Download size={15} /> People
          </button>
          <button
            className="button-quiet"
            onClick={() =>
              csvDownload("aiewf-meetings.csv", [
                ["date", "time", "table", "participants", "status"],
                ...meetings.map((meeting) => [
                  meeting.date,
                  minuteLabel(meeting.startMinute),
                  String(meeting.tableNumber),
                  meeting.participants.map((participant) => participant.account?.displayName ?? "").join("; "),
                  meeting.status,
                ]),
              ])
            }
          >
            <Download size={15} /> Meetings
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          className="input mt-4 min-h-64 resize-y font-mono text-xs"
        />
        <button
          className="button-primary mt-3 w-full"
          disabled={actionPending}
          onClick={() => {
            const parsed = parseParticipantCsv(csv);
            void runAction(
              () =>
                parsed.error
                  ? Promise.reject(new Error(parsed.error))
                  : upsertParticipants({ sessionToken, rows: parsed.rows }),
              parsed.error ? "" : `${parsed.rows.length} participant rows processed.`,
            );
          }}
        >
          <Import size={15} /> Import participant CSV
        </button>
        <div className="mt-4 grid gap-2 border-t border-white/10 pt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Recent imports</div>
          {importBatches.length === 0 && <p className="text-xs leading-5 text-white/45">No import batches yet.</p>}
          {importBatches.map((batch) => (
            <div key={batch._id} className="border border-white/10 bg-black/30 p-2 text-xs text-white/60">
              {batch.summary} · missing company {batch.missingCompanyRows} · missing title {batch.missingTitleRows}
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">
          {requests.length} timed requests · {interests.length} interests · {meetings.length} meetings currently in Convex.
        </div>
      </section>
    </div>
  );
}

function RoomDisplayView({
  onExit,
  roomDisplay,
}: {
  onExit: () => void;
  roomDisplay: RoomDisplayData | null | undefined;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const participantUrl = `${window.location.origin}/?surface=directory`;
    void QRCode.toDataURL(participantUrl, {
      margin: 1,
      width: 240,
      color: { dark: "#050505", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, []);

  if (roomDisplay === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <div className="flex items-center gap-3 text-[#f8e18e]">
          <Loader2 className="animate-spin" />
          <span>Loading room display</span>
        </div>
      </main>
    );
  }

  if (roomDisplay === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <section className="border border-white/10 bg-[#101010] p-6">
          <h1 className="text-xl font-semibold">Room display unavailable</h1>
          <button type="button" className="button-primary mt-4" onClick={onExit}>
            Exit display
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white xl:h-screen xl:overflow-hidden">
      <div className="mx-auto grid min-h-screen w-full max-w-[1920px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:h-full xl:min-h-0">
        <header className="grid gap-4 border-b border-white/10 pb-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#f8e18e]">
              <Monitor size={16} />
              <span>{roomDisplay.settings.eventName}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
                Networking Room
              </h1>
              <div className="pb-1 font-mono text-xl text-white/60">
                {dateLabels[roomDisplay.date]} · {roomDisplay.nowLabel}
              </div>
            </div>
            <p className="mt-3 max-w-4xl text-lg leading-8 text-white/58">
              {roomDisplay.settings.roomName} · scan to opt in, set availability, and book peer meetings.
            </p>
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-4 justify-self-start lg:justify-self-end">
            <div className="flex aspect-square items-center justify-center bg-white p-2">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="Networking app QR code" className="h-full w-full" src={qrDataUrl} />
              ) : (
                <QrCode className="text-black" size={56} />
              )}
            </div>
            <div className="text-sm leading-6 text-white/60">
              <div className="font-semibold text-white">Scan to get started</div>
              <div>Groups max out at {roomDisplay.settings.maxMeetingGroupSize} people.</div>
              <button type="button" className="button-quiet mt-3" onClick={onExit}>
                Exit display
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:overflow-hidden">
          <section className="min-h-0 overflow-hidden border border-white/10 bg-[#101010]">
            <SectionHeader
              icon={<Table2 size={18} />}
              title="Now and next"
              detail={`${roomDisplay.counts.live} live · ${roomDisplay.counts.upcoming} upcoming`}
            />
            <div className="grid max-h-[calc(100vh-230px)] gap-3 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
              {roomDisplay.nextMeetings.length === 0 && (
                <div className="sm:col-span-2 xl:col-span-3">
                  <EmptyState title="No upcoming meetings" detail="Accepted peer meetings will appear on this display." />
                </div>
              )}
              {roomDisplay.nextMeetings.map((meeting) => (
                <article key={meeting.meetingId} className="grid min-h-[230px] gap-4 border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-2xl text-[#f8e18e]">T{meeting.tableNumber}</div>
                    <StatusBadge status={meeting.status} />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/45">{meeting.label}</div>
                    <h2 className="mt-2 text-2xl font-semibold leading-tight">
                      {meeting.participants.filter(Boolean).map((participant) => participant?.displayName).slice(0, 2).join(" + ")}
                    </h2>
                  </div>
                  <div className="self-end border-t border-white/10 pt-3 text-sm text-white/55">
                    Group {meeting.participantCount}/{roomDisplay.settings.maxMeetingGroupSize}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="grid gap-2 self-start">
            <DisplayStat label="Open tables" value={roomDisplay.counts.openTables} />
            <DisplayStat label="Pending" value={roomDisplay.counts.pendingRequests} />
            <DisplayStat label="Tables" value={roomDisplay.settings.activeTables} />
            <DisplayStat label="Slot length" value={`${roomDisplay.settings.slotMinutes}m`} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function DisplayStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-white/10 bg-[#101010] p-4">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/45">{label}</div>
    </div>
  );
}

function SectionHeader({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[#f8e18e]">{icon}</span>
        <h2 className="font-semibold">{title}</h2>
        {detail && <span className="text-xs text-white/45">{detail}</span>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="p-4 text-sm">
      <div className="font-semibold text-white/75">{title}</div>
      <p className="mt-1 leading-6 text-white/45">{detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium uppercase tracking-[0.12em] text-white/45">
      {label}
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <input className="input" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between border border-white/10 bg-black/30 px-3 py-3 text-sm text-white/70">
      {label}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", statusStyles[status] ?? "border-white/10 bg-white/5 text-white/55")}>
      {status.replace("_", " ")}
    </span>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="border border-white/10 bg-black/30 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-white/50">{children}</span>;
}

function TagRow({ items }: { items: string[] }) {
  const visible = items.filter(Boolean).slice(0, 6);
  if (!visible.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {visible.map((item) => (
        <span key={item} className="border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/55">
          {item}
        </span>
      ))}
    </div>
  );
}

function CompactTagRow({ items }: { items: string[] }) {
  const visible = items.filter(Boolean).slice(0, 3);
  if (!visible.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {visible.map((item) => (
        <span key={item} className="max-w-32 truncate border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-white/45">
          {item}
        </span>
      ))}
    </div>
  );
}
