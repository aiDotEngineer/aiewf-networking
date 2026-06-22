"use client";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Gauge,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LockKeyhole,
  Mail,
  Menu,
  Monitor,
  MapPin,
  MessageSquare,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Upload,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Account = Doc<"accounts">;
type Company = Doc<"companies">;
type Availability = Doc<"availability">;
type Settings = Doc<"eventSettings">;
type DemoAccount = {
  _id: Id<"accounts">;
  email: string;
  displayName: string;
  role: Account["role"];
  title: string;
  track: string | null;
  companyId: Id<"companies"> | null;
};
type RequestDoc = Doc<"meetingRequests"> & {
  company: Company | null;
  attendee: Account | null;
  meeting: Doc<"meetings"> | null;
};
type MeetingDoc = Doc<"meetings"> & {
  company: Company | null;
  attendee: Account | null;
  request: Doc<"meetingRequests"> | null;
};
type DeskMatchDoc = Doc<"deskMatchRequests"> & {
  attendee: Account | null;
  suggestedCompany: Company | null;
  meetingRequest: Doc<"meetingRequests"> | null;
};
type RoomDisplayData = {
  settings: {
    eventName: string;
    roomName: string;
    activeTables: number;
    slotMinutes: number;
  };
  date: string;
  nowMinute: number;
  nowLabel: string;
  counts: {
    live: number;
    upcoming: number;
    openCompanies: number;
    pendingRequests: number;
  };
  nextMeetings: Array<{
    meetingId: Id<"meetings">;
    tableNumber: number;
    startMinute: number;
    endMinute: number;
    label: string;
    status: string;
    companyName: string;
    attendeeName: string;
    attendeeTitle: string;
  }>;
  opportunities: Array<{
    companyId: Id<"companies">;
    companyName: string;
    tier: string;
    hostNames: string[];
    topics: string[];
    startMinute: number;
    label: string;
    pendingRequests: number;
  }>;
};
type CompanyCsvRow = {
  name: string;
  tier?: string;
  contactEmail?: string;
  hostNames?: string;
  topics?: string;
  wantsToMeet?: string;
  sponsor?: boolean;
  optedIn?: boolean;
  description?: string;
};
type View = "attendee" | "display" | "marketplace" | "requests" | "schedule" | "companies" | "desk" | "admin";
type RunAction = (task: () => Promise<unknown>, success: string) => Promise<boolean>;

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
  requested: "border-[#f8e18e]/35 bg-[#f8e18e]/10 text-[#f8e18e]",
  matched: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  closed: "border-white/10 bg-white/5 text-white/55",
  "opted in": "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  hidden: "border-white/10 bg-white/5 text-white/55",
};

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

function canHostRespond(status: RequestDoc["status"]) {
  return status === "pending" || status === "countered";
}

function nextCounterStartMinute(
  slotLabels: Array<{ minute: number; label: string }>,
  preferredStartMinute: number,
) {
  return slotLabels.find((slot) => slot.minute > preferredStartMinute)?.minute;
}

function companySlotsForDate(
  companyId: Id<"companies">,
  date: string,
  availability: Availability[],
  slotLabels: Array<{ minute: number; label: string }>,
  slotMinutes: number,
) {
  const windows = availability.filter(
    (window) => window.companyId === companyId && window.date === date,
  );
  return slotLabels.filter((slot) =>
    windows.some(
      (window) =>
        slot.minute >= window.startMinute && slot.minute + slotMinutes <= window.endMinute,
    ),
  );
}

function isOpenRequestStatus(status: RequestDoc["status"]) {
  return status !== "cancelled" && status !== "declined";
}

function userFacingError(error: unknown) {
  if (!(error instanceof Error)) return "Action failed.";
  const raw = error.message.trim();
  const convexMessage = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n| at | Called by client|$)/);
  return (convexMessage?.[1] ?? raw).trim();
}

function isViewAvailable(view: View, actor: Account | null) {
  if (!actor) return false;
  if (view === "admin") return actor.role === "admin";
  if (view === "desk") return actor.role === "admin";
  if (view === "marketplace") return actor.role !== "company";
  if (view === "attendee") return actor.role !== "company";
  return true;
}

function fallbackView(actor: Account | null): View {
  return actor?.role === "company" ? "requests" : "attendee";
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

const companyCsvHeaders = new Set([
  "name",
  "tier",
  "contactEmail",
  "hostNames",
  "topics",
  "wantsToMeet",
  "sponsor",
  "optedIn",
  "description",
]);

function parseCompanyCsvBoolean(value: string) {
  return ["true", "yes", "1", "y"].includes(value.trim().toLowerCase());
}

function parseCompanyCsv(text: string): { rows: CompanyCsvRow[]; error: string | null } {
  const table = parseCsvTable(text);
  if (table.length < 2) {
    return { rows: [], error: "CSV needs a header row and at least one company row." };
  }
  const headers = table[0].map((item) => item.trim());
  if (!headers.includes("name")) {
    return { rows: [], error: "CSV must include a name column." };
  }
  const unknownHeader = headers.find((header) => header && !companyCsvHeaders.has(header));
  if (unknownHeader) {
    return { rows: [], error: `Unknown CSV column: ${unknownHeader}.` };
  }

  const rows = table.slice(1).map((values) => {
    const row: CompanyCsvRow = { name: "" };
    headers.forEach((header, index) => {
      const value = values[index] ?? "";
      switch (header) {
        case "name":
          row.name = value;
          break;
        case "tier":
          row.tier = value;
          break;
        case "contactEmail":
          row.contactEmail = value;
          break;
        case "hostNames":
          row.hostNames = value;
          break;
        case "topics":
          row.topics = value;
          break;
        case "wantsToMeet":
          row.wantsToMeet = value;
          break;
        case "sponsor":
          row.sponsor = parseCompanyCsvBoolean(value);
          break;
        case "optedIn":
          row.optedIn = parseCompanyCsvBoolean(value);
          break;
        case "description":
          row.description = value;
          break;
      }
    });
    return row;
  });
  if (rows.some((row) => !row.name.trim())) {
    return { rows: [], error: "Every CSV row needs a company name." };
  }
  return { rows, error: null };
}

export function NetworkingApp() {
  const accounts = useQuery(api.networking.listDemoAccounts, {});
  const ensureDemoData = useMutation(api.networking.ensureDemoData);
  const startDemoSession = useMutation(api.networking.startDemoSession);
  const seedStartedRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const sessionRequestRef = useRef(0);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [actorEmail, setActorEmail] = useState("priya@leadership.test");
  const data = useQuery(
    api.networking.getBootstrap,
    sessionToken ? { sessionToken } : "skip",
  );
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window === "undefined") return "attendee";
    const surface = new URLSearchParams(window.location.search).get("surface");
    if (surface === "display") return "display";
    return "attendee";
  });
  const displayDate = data?.settings?.startDate ?? "2026-06-30";
  const displayNowMinute = data?.settings
    ? data.settings.dayStartMinute + Math.max(0, data.settings.slotMinutes - 7)
    : undefined;
  const roomDisplay = useQuery(
    api.networking.getRoomDisplay,
    data?.settings && activeView === "display"
      ? {
          date: displayDate,
          nowMinute: displayNowMinute,
        }
      : "skip",
  );
  const [selectedRequestId, setSelectedRequestId] = useState<Id<"meetingRequests"> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [sessionPending, setSessionPending] = useState(false);
  const actionLockRef = useRef(false);

  useEffect(() => {
    if (accounts && accounts.length === 0 && !seedStartedRef.current) {
      seedStartedRef.current = true;
      void ensureDemoData({}).catch((error) => setNotice(error.message));
    }
  }, [accounts, ensureDemoData]);

  const startSession = useCallback((email: string) => {
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
  }, [startDemoSession]);

  useEffect(() => {
    if (!accounts?.length || sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    const initialEmail =
      accounts.find((account) => account.role === "attendee")?.email ??
      accounts.find((account) => account.role === "admin")?.email ??
      accounts[0].email;
    startSession(initialEmail);
  }, [accounts, startSession]);

  function changeAccount(email: string) {
    startSession(email);
  }

  const actor = data?.actor ?? null;
  const deskRequests = (data?.deskRequests ?? []) as DeskMatchDoc[];
  const effectiveActiveView = isViewAvailable(activeView, actor)
    ? activeView
    : fallbackView(actor);
  const wideView = effectiveActiveView === "attendee" || effectiveActiveView === "desk";
  const selectedRequest =
    data?.requests.find((request) => request._id === selectedRequestId) ??
    data?.requests.find((request) => request.status === "pending") ??
    data?.requests[0] ??
    null;

  const stats = useMemo(() => {
    if (!data?.settings) {
      return { confirmed: 0, pending: 0, capacity: 0, optedIn: 0 };
    }
    const slotsPerDay = Math.floor(
      (data.settings.dayEndMinute - data.settings.dayStartMinute) / data.settings.slotMinutes,
    );
    return {
      confirmed: data.meetings.filter((meeting) => meeting.status !== "cancelled").length,
      pending: data.requests.filter((request) => request.status === "pending").length,
      capacity: data.settings.activeTables * slotsPerDay * 2,
      optedIn: data.companies.filter((company) => company.optedIn).length,
    };
  }, [data]);

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

  if (!accounts || !sessionToken || !data || !data.settings) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Loader2 className="animate-spin text-[#f8e18e]" />
          <h1 className="text-2xl font-semibold">Preparing networking room</h1>
          {notice ? (
            <>
              <p className="text-sm leading-6 text-red-200">{notice}</p>
              {accounts?.length ? (
                <button className="button-primary" onClick={() => startSession(actorEmail)}>
                  Retry session
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-sm leading-6 text-white/60">
              Initializing the Convex data model and opening a scoped fake session.
            </p>
          )}
        </div>
      </main>
    );
  }

  if (effectiveActiveView === "display") {
    return (
      <RoomDisplayView
        roomDisplay={roomDisplay as RoomDisplayData | null | undefined}
        onExit={() => setActiveView(fallbackView(actor))}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <TopStrip settings={data.settings} />
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
        <Header
          accounts={data.accounts}
          actor={actor}
          actorEmail={actorEmail}
          isPending={sessionPending}
          onActorChange={changeAccount}
        />
        {notice && (
          <div className="flex items-center justify-between border border-[#f8e18e]/30 bg-[#f8e18e]/10 px-3 py-2 text-sm text-[#f8e18e]">
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className={cn(
            "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4",
            wideView
              ? "lg:grid-cols-[220px_minmax(0,1fr)]"
              : "lg:grid-cols-[220px_minmax(0,1fr)_360px]",
          )}
        >
          <Navigation actor={actor} activeView={effectiveActiveView} onChange={setActiveView} />
          <section className="min-w-0">
            {effectiveActiveView !== "attendee" && (
              <MetricStrip settings={data.settings} stats={stats} />
            )}
            {actor && effectiveActiveView === "attendee" && (
              <AttendeeExperience
                actionPending={actionPending}
                actor={actor}
                availability={data.availability}
                companies={data.companies}
                deskRequests={deskRequests}
                meetings={data.meetings}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {actor && effectiveActiveView === "marketplace" && (
              <Marketplace
                actionPending={actionPending}
                actor={actor}
                availability={data.availability}
                companies={data.companies}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {actor && effectiveActiveView === "requests" && (
              <RequestQueue
                actionPending={actionPending}
                actor={actor}
                onSelect={setSelectedRequestId}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                slotLabels={data.slotLabels}
              />
            )}
            {actor && effectiveActiveView === "schedule" && (
              <ScheduleView
                actionPending={actionPending}
                actor={actor}
                meetings={data.meetings}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
                onSelectRequest={setSelectedRequestId}
              />
            )}
            {actor && effectiveActiveView === "companies" && (
              <CompaniesView
                actionPending={actionPending}
                actor={actor}
                availability={data.availability}
                companies={data.companies}
                runAction={runAction}
                sessionToken={sessionToken}
              />
            )}
            {actor && effectiveActiveView === "desk" && (
              <DeskQueueView
                actionPending={actionPending}
                actor={actor}
                companies={data.companies}
                deskRequests={deskRequests}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                slotLabels={data.slotLabels}
              />
            )}
            {actor && effectiveActiveView === "admin" && (
              <AdminView
                key={`${data.settings._id}:${data.settings.updatedAt}`}
                actionPending={actionPending}
                actor={actor}
                companies={data.companies}
                importBatches={data.importBatches}
                meetings={data.meetings}
                runAction={runAction}
                sessionToken={sessionToken}
                setSessionToken={setSessionToken}
                settings={data.settings}
              />
            )}
          </section>
          {!wideView && (
            <DetailPanel
              actionPending={actionPending}
              actor={actor}
              request={selectedRequest}
              runAction={runAction}
              sessionToken={sessionToken}
              settings={data.settings}
              slotLabels={data.slotLabels}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function TopStrip({ settings }: { settings: Settings }) {
  return (
    <div className="border-b border-white/10 bg-[#f8e18e] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-black sm:px-5">
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-2">
        <span>AIE World Fair Networking</span>
        <span className="font-mono normal-case tracking-normal">
          Room 3001 · June 30 - July 1 · {settings.activeTables} active tables ·{" "}
          {settings.reserveTables} reserve
        </span>
      </div>
    </div>
  );
}

function Header({
  accounts,
  actor,
  actorEmail,
  isPending,
  onActorChange,
}: {
  accounts: DemoAccount[];
  actor: Account | null;
  actorEmail: string;
  isPending: boolean;
  onActorChange: (email: string) => void;
}) {
  return (
    <header className="grid gap-3 border border-white/10 bg-[#101010] p-3 sm:grid-cols-[1fr_auto] sm:p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
          <span className="font-mono text-[#f8e18e]">$ curl -sL ai.engineer/wf/networking</span>
          <span className="hidden sm:inline">·</span>
          <span>Company 1:1s</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Networking Room Ops
          </h1>
          {actor && <RolePill role={actor.role} />}
        </div>
      </div>
      <label className="grid min-w-0 gap-1 text-xs text-white/55">
        Fake account
        <select
          value={actorEmail}
          onChange={(event) => onActorChange(event.target.value)}
          className="h-11 w-full min-w-0 max-w-full border border-white/15 bg-black px-3 text-sm font-medium text-white outline-none transition focus:border-[#f8e18e] sm:min-w-[310px]"
        >
          {accounts.map((account) => (
            <option key={account._id} value={account.email}>
              {account.displayName} · {account.role} · {account.email}
            </option>
          ))}
        </select>
        {isPending && <span className="text-[#f8e18e]">Syncing action...</span>}
      </label>
    </header>
  );
}

function RolePill({ role }: { role: Account["role"] }) {
  return (
    <span className="inline-flex items-center gap-1 border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
      <LockKeyhole size={12} />
      {role}
    </span>
  );
}

function Navigation({
  activeView,
  actor,
  onChange,
}: {
  activeView: View;
  actor: Account | null;
  onChange: (view: View) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const allItems: Array<{ id: View; label: string; icon: ReactNode }> = [
    { id: "attendee", label: "Attendee", icon: <Users size={16} /> },
    { id: "display", label: "Room display", icon: <Monitor size={16} /> },
    { id: "marketplace", label: "Marketplace", icon: <Search size={16} /> },
    { id: "requests", label: "Requests", icon: <ListChecks size={16} /> },
    { id: "schedule", label: "Schedule", icon: <CalendarDays size={16} /> },
    { id: "companies", label: "Companies", icon: <Building2 size={16} /> },
    { id: "desk", label: "Desk queue", icon: <Handshake size={16} /> },
    { id: "admin", label: "Admin", icon: <Settings2 size={16} /> },
  ];
  const items = allItems.filter((item) => {
    if (item.id === "admin" || item.id === "desk") return actor?.role === "admin";
    if (item.id === "attendee") return actor?.role !== "company";
    if (item.id === "marketplace") return actor?.role !== "company";
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
          <span>Menu </span>
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
            <span className="flex min-w-0 items-center gap-2"><span className="shrink-0">{item.icon}</span><span className="truncate">{item.label}</span></span>
            <ChevronRight className="hidden lg:block" size={14} />
          </button>
        ))}
      </nav>
      <div className="mt-4 hidden border-t border-white/10 pt-4 text-xs leading-5 text-white/45 lg:block">
        1:1 requests with desk-assisted matching for attendees who want help.
      </div>
    </aside>
  );
}

function MetricStrip({
  settings,
  stats,
}: {
  settings: Settings;
  stats: { confirmed: number; pending: number; capacity: number; optedIn: number };
}) {
  const metrics = [
    { label: "Confirmed", value: stats.confirmed, icon: <Check size={16} /> },
    { label: "Pending", value: stats.pending, icon: <MessageSquare size={16} /> },
    { label: "Capacity", value: stats.capacity, icon: <Gauge size={16} /> },
    { label: "Opted-in", value: stats.optedIn, icon: <Building2 size={16} /> },
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

function AttendeeExperience({
  actionPending,
  actor,
  availability,
  companies,
  deskRequests,
  meetings,
  requests,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  availability: Availability[];
  companies: Company[];
  deskRequests: DeskMatchDoc[];
  meetings: MeetingDoc[];
  requests: RequestDoc[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const createRequest = useMutation(api.networking.createRequest);
  const createDeskMatchRequest = useMutation(api.networking.createDeskMatchRequest);
  const updateDeskMatchStatus = useMutation(api.networking.updateDeskMatchStatus);
  const [date, setDate] = useState(settings.startDate);
  const [preferredStartMinute, setPreferredStartMinute] = useState(
    slotLabels[1]?.minute ?? settings.dayStartMinute,
  );
  const [intent, setIntent] = useState("");
  const [topicText, setTopicText] = useState("agents; evals; production AI");
  const effectivePreferredStartMinute = slotLabels.some(
    (slot) => slot.minute === preferredStartMinute,
  )
    ? preferredStartMinute
    : slotLabels[0]?.minute ?? settings.dayStartMinute;

  if (actor.role !== "attendee") {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <Users className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Attendee account required</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
          Switch to an attendee fake account to use the attendee networking experience.
        </p>
      </section>
    );
  }

  const eligibleCompanies = companies
    .filter((company) => company.optedIn)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const myRequests = requests.filter((request) => request.attendeeAccountId === actor._id);
  const dailyCount = myRequests.filter(
    (request) => request.date === date && isOpenRequestStatus(request.status),
  ).length;
  const atRequestCap = dailyCount >= settings.attendeeRequestCapPerDay;
  const openRequestCompanyIds = new Set(
    myRequests
      .filter((request) => request.date === date && isOpenRequestStatus(request.status))
      .map((request) => request.companyId),
  );
  const myMeetings = meetings
    .filter(
      (meeting) =>
        meeting.attendeeAccountId === actor._id &&
        meeting.status !== "cancelled" &&
        meeting.date === date,
    )
    .sort((a, b) => a.startMinute - b.startMinute);
  const myDeskRequests = deskRequests
    .filter((request) => request.attendeeAccountId === actor._id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const openDeskRequest = myDeskRequests.find(
    (request) =>
      request.date === date && (request.status === "requested" || request.status === "matched"),
  );
  const topicQuery = `${intent} ${topicText}`.toLowerCase();
  const recommendations = eligibleCompanies
    .map((company) => {
      const slots = companySlotsForDate(
        company._id,
        date,
        availability,
        slotLabels,
        settings.slotMinutes,
      );
      const nextSlot =
        slots.find((slot) => slot.minute >= effectivePreferredStartMinute) ?? slots[0] ?? null;
      const topicScore = company.topics.filter((topic) => {
        const normalizedTopic = topic.toLowerCase();
        return (
          topicQuery.includes(normalizedTopic) ||
          normalizedTopic.split(/\s+/).some((part) => part.length > 3 && topicQuery.includes(part))
        );
      }).length;
      return { company, nextSlot, topicScore };
    })
    .filter((item) => item.nextSlot && !openRequestCompanyIds.has(item.company._id))
    .sort(
      (a, b) =>
        b.topicScore - a.topicScore ||
        Number(b.company.sponsor) - Number(a.company.sponsor) ||
        a.company.priority - b.company.priority ||
        a.company.name.localeCompare(b.company.name),
    )
    .slice(0, 4);

  function requestCompany(company: Company, startMinute: number) {
    const trimmedIntent = intent.trim();
    const reason =
      trimmedIntent.length >= 8
        ? trimmedIntent
        : `Meet ${company.name} about practical AI deployment and partnerships.`;
    void runAction(
      () =>
        createRequest({
          sessionToken,
          companyId: company._id,
          date,
          preferredStartMinute: startMinute,
          reason,
          context: `${actor.title}. Requested from the attendee concierge view.`,
        }),
      `Request sent to ${company.name}.`,
    );
  }

  function askDesk() {
    const trimmedIntent = intent.trim();
    void runAction(
      () =>
        createDeskMatchRequest({
          sessionToken,
          date,
          preferredStartMinute: effectivePreferredStartMinute,
          intent: trimmedIntent,
          topics: topicText,
        }),
      "Desk match request added.",
    );
  }

  return (
    <div className="grid gap-4">
      <section className="border border-white/10 bg-[#101010]">
        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#f8e18e]">
              <Sparkles size={14} />
              <span>Attendee mode</span>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
              Got 30 minutes? Make it count.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base sm:leading-7">
              Share what you want to find, then request a company directly or ask the room desk to make a practical match.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Field label="Date">
                <select className="input" value={date} onChange={(event) => setDate(event.target.value)}>
                  <option value="2026-06-30">Tue Jun 30</option>
                  <option value="2026-07-01">Wed Jul 1</option>
                </select>
              </Field>
              <Field label="Best time">
                <select
                  className="input"
                  value={effectivePreferredStartMinute}
                  onChange={(event) => setPreferredStartMinute(Number(event.target.value))}
                >
                  {slotLabels.map((slot) => (
                    <option key={slot.minute} value={slot.minute}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="grid gap-3">
            <Field label="What are you looking for?">
              <textarea
                className="input min-h-28 resize-none"
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                placeholder="Production agent observability, eval tooling, enterprise deployment patterns..."
              />
            </Field>
            <Field label="Topics">
              <input
                className="input"
                value={topicText}
                onChange={(event) => setTopicText(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="button-primary"
              disabled={actionPending || Boolean(openDeskRequest) || intent.trim().length < 8}
              onClick={askDesk}
            >
              <Handshake size={16} /> Ask the desk to match me
            </button>
            <div className="text-xs leading-5 text-white/45">
              {openDeskRequest
                ? `Desk request is ${openDeskRequest.status}.`
                : `${dailyCount}/${settings.attendeeRequestCapPerDay} direct company requests used for ${dateLabels[date]}.`}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="border border-white/10 bg-[#101010]">
          <SectionHeader
            icon={<ArrowRight size={17} />}
            title="Recommended next"
            detail={`${recommendations.length} options`}
          />
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            {recommendations.length === 0 && (
              <div className="sm:col-span-2">
                <EmptyState
                  title="No direct options available"
                  detail="Try a different time, or ask the room desk to route you to a useful match."
                />
              </div>
            )}
            {recommendations.map(({ company, nextSlot, topicScore }) => (
              <article key={company._id} className="grid min-h-[220px] gap-4 border border-white/10 bg-black/25 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold">{company.name}</h3>
                    <Badge accent={topicScore > 0}>{company.tier}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/60">
                    {company.description}
                  </p>
                  <TagRow items={company.topics} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 self-end">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/45">Next slot</div>
                    <div className="mt-1 font-mono text-lg text-[#f8e18e]">{nextSlot?.label}</div>
                  </div>
                  <button
                    type="button"
                    className="button-primary"
                    disabled={actionPending || atRequestCap || !nextSlot}
                    onClick={() => {
                      if (!nextSlot) return;
                      requestCompany(company, nextSlot.minute);
                    }}
                  >
                    <Send size={15} /> Request
                  </button>
                </div>
              </article>
            ))}
          </div>
          {atRequestCap && (
            <div className="border-t border-white/10 px-4 py-3 text-xs leading-5 text-white/45">
              Daily request cap reached for {dateLabels[date]}. Desk requests are separate.
            </div>
          )}
        </section>

        <div className="grid gap-4">
          <section className="border border-white/10 bg-[#101010]">
            <SectionHeader
              icon={<CalendarDays size={17} />}
              title="Your schedule"
              detail={`${myMeetings.length} confirmed`}
            />
            <div className="divide-y divide-white/10">
              {myMeetings.length === 0 && (
                <EmptyState
                  title="Nothing confirmed yet"
                  detail="Accepted company requests will appear here with table assignment."
                />
              )}
              {myMeetings.map((meeting) => (
                <div key={meeting._id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{meeting.company?.name ?? "Company"}</div>
                    <StatusBadge status={meeting.status} />
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-white/60">
                    <span className="flex items-center gap-2">
                      <Clock3 size={14} /> {dateLabels[meeting.date]} · {minuteLabel(meeting.startMinute)}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin size={14} /> Table {meeting.tableNumber}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-white/10 bg-[#101010]">
            <SectionHeader
              icon={<ListChecks size={17} />}
              title="Your requests"
              detail={`${myRequests.length + myDeskRequests.length} total`}
            />
            <div className="divide-y divide-white/10">
              {myRequests.length === 0 && myDeskRequests.length === 0 && (
                <EmptyState
                  title="No requests yet"
                  detail="Direct company requests and desk matches will show here."
                />
              )}
              {myRequests.slice(0, 5).map((request) => (
                <div key={request._id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{request.company?.name ?? "Company"}</span>
                    <StatusBadge status={request.status} />
                  </div>
                  <div className="mt-1 text-white/45">
                    {dateLabels[request.date]} · {minuteLabel(request.preferredStartMinute)}
                  </div>
                </div>
              ))}
              {myDeskRequests.slice(0, 3).map((request) => (
                <div key={request._id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Desk match</span>
                    <StatusBadge status={request.status} />
                  </div>
                  <div className="mt-1 text-white/45">
                    {request.suggestedCompany
                      ? `Suggested ${request.suggestedCompany.name}`
                      : `${dateLabels[request.date]} · ${minuteLabel(request.preferredStartMinute)}`}
                  </div>
                  {request.status === "requested" && (
                    <button
                      type="button"
                      className="button-quiet mt-3"
                      disabled={actionPending}
                      onClick={() =>
                        void runAction(
                          () =>
                            updateDeskMatchStatus({
                              sessionToken,
                              deskMatchRequestId: request._id,
                              status: "cancelled",
                            }),
                          "Desk request cancelled.",
                        )
                      }
                    >
                      <X size={15} /> Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DeskQueueView({
  actionPending,
  actor,
  companies,
  deskRequests,
  requests,
  runAction,
  sessionToken,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  companies: Company[];
  deskRequests: DeskMatchDoc[];
  requests: RequestDoc[];
  runAction: RunAction;
  sessionToken: string;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const assignDeskMatch = useMutation(api.networking.assignDeskMatch);
  const updateDeskMatchStatus = useMutation(api.networking.updateDeskMatchStatus);
  const [companySelections, setCompanySelections] = useState<Record<string, Id<"companies">>>({});
  const [timeSelections, setTimeSelections] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (actor.role !== "admin") {
    return (
      <section className="border border-white/10 bg-[#101010] p-6">
        <ShieldCheck className="text-[#f8e18e]" />
        <h2 className="mt-4 text-xl font-semibold">Admin access required</h2>
        <p className="mt-2 text-sm text-white/55">Switch to admin@aiewf.test to operate the desk queue.</p>
      </section>
    );
  }

  const companyOptions = companies
    .filter((company) => company.optedIn)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const visible = deskRequests
    .slice()
    .sort(
      (a, b) =>
        Number(a.status !== "requested") - Number(b.status !== "requested") ||
        b.updatedAt - a.updatedAt,
    );

  function hasOpenRequestForCompany(request: DeskMatchDoc, companyId: Id<"companies">) {
    return requests.some(
      (meetingRequest) =>
        meetingRequest.attendeeAccountId === request.attendeeAccountId &&
        meetingRequest.companyId === companyId &&
        meetingRequest.date === request.date &&
        isOpenRequestStatus(meetingRequest.status),
    );
  }

  function topicScore(company: Company, request: DeskMatchDoc) {
    const topicText = request.topics.join(" ").toLowerCase();
    return company.topics.filter((topic) => {
      const normalizedTopic = topic.toLowerCase();
      return (
        topicText.includes(normalizedTopic) ||
        normalizedTopic.split(/\s+/).some((part) => part.length > 3 && topicText.includes(part))
      );
    }).length;
  }

  function suggestedCompanyFor(request: DeskMatchDoc) {
    const candidates = companyOptions.filter(
      (company) => !hasOpenRequestForCompany(request, company._id),
    );
    const rankedCandidates = candidates.length > 0 ? candidates : companyOptions;
    return (
      rankedCandidates
        .slice()
        .sort(
          (a, b) =>
            topicScore(b, request) - topicScore(a, request) ||
            a.priority - b.priority ||
            a.name.localeCompare(b.name),
        )[0] ?? companyOptions[0]
    );
  }

  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader
        icon={<Handshake size={17} />}
        title="Desk match queue"
        detail={`${visible.filter((request) => request.status === "requested").length} open`}
      />
      <div className="divide-y divide-white/10">
        {visible.length === 0 && (
          <EmptyState
            title="No desk requests"
            detail="Attendees who ask for help finding a match will appear here."
          />
        )}
        {visible.map((request) => {
          const suggestedCompany = suggestedCompanyFor(request);
          const selectedCompanyId =
            companySelections[request._id] ?? suggestedCompany?._id ?? companyOptions[0]?._id;
          const selectedTime = timeSelections[request._id] ?? request.preferredStartMinute;
          const selectedNote = notes[request._id] ?? "";
          const selectedCompanyBlocked =
            !selectedCompanyId || hasOpenRequestForCompany(request, selectedCompanyId);
          return (
            <div key={request._id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{request.attendee?.displayName ?? "Attendee"}</h3>
                  <StatusBadge status={request.status} />
                  <span className="text-xs text-white/45">
                    {dateLabels[request.date]} · {minuteLabel(request.preferredStartMinute)}
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">{request.intent}</p>
                <TagRow items={request.topics} />
                <p className="mt-3 text-xs text-white/45">{request.attendee?.title}</p>
                {request.suggestedCompany && (
                  <div className="mt-3 border border-sky-300/20 bg-sky-300/10 p-3 text-sm text-sky-100">
                    Suggested {request.suggestedCompany.name}
                    {request.meetingRequest ? ` · request ${request.meetingRequest.status}` : ""}
                  </div>
                )}
              </div>
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Company">
                    <select
                      className="input"
                      disabled={request.status !== "requested" || companyOptions.length === 0}
                      value={selectedCompanyId ?? ""}
                      onChange={(event) =>
                        setCompanySelections({
                          ...companySelections,
                          [request._id]: event.target.value as Id<"companies">,
                        })
                      }
                    >
                      {companyOptions.length === 0 && <option value="">No opted-in companies</option>}
                      {companyOptions.map((company) => (
                        <option
                          disabled={hasOpenRequestForCompany(request, company._id)}
                          key={company._id}
                          value={company._id}
                        >
                          {company.name}
                          {hasOpenRequestForCompany(request, company._id)
                            ? " (already requested)"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Time">
                    <select
                      className="input"
                      disabled={request.status !== "requested"}
                      value={selectedTime}
                      onChange={(event) =>
                        setTimeSelections({
                          ...timeSelections,
                          [request._id]: Number(event.target.value),
                        })
                      }
                    >
                      {slotLabels.map((slot) => (
                        <option key={slot.minute} value={slot.minute}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Desk note">
                  <input
                    className="input"
                    disabled={request.status !== "requested"}
                    value={selectedNote}
                    onChange={(event) => setNotes({ ...notes, [request._id]: event.target.value })}
                    placeholder="Why this company is a useful match"
                  />
                </Field>
                {request.status === "requested" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="button-primary"
                      disabled={actionPending || selectedCompanyBlocked}
                      onClick={() => {
                        if (!selectedCompanyId || selectedCompanyBlocked) return;
                        void runAction(
                          () =>
                            assignDeskMatch({
                              sessionToken,
                              deskMatchRequestId: request._id,
                              companyId: selectedCompanyId,
                              preferredStartMinute: selectedTime,
                              note: selectedNote,
                            }),
                          "Desk match sent to company.",
                        );
                      }}
                    >
                      <Send size={15} /> Send company request
                    </button>
                    <button
                      type="button"
                      className="button-quiet"
                      disabled={actionPending}
                      onClick={() =>
                        void runAction(
                          () =>
                            updateDeskMatchStatus({
                              sessionToken,
                              deskMatchRequestId: request._id,
                              status: "closed",
                            }),
                          "Desk request closed.",
                        )
                      }
                    >
                      <Check size={15} /> Close
                    </button>
                  </div>
                ) : (
                  <div className="text-xs leading-5 text-white/45">
                    This desk request is {request.status}.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
    const attendeeUrl = `${window.location.origin}/?surface=attendee`;
    void QRCode.toDataURL(attendeeUrl, {
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
              {roomDisplay.settings.roomName} · scan to request a 1:1 or ask the desk for a match.
            </p>
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-4 justify-self-start lg:justify-self-end">
            <div className="flex aspect-square items-center justify-center bg-white p-2">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="Attendee request QR code" className="h-full w-full" src={qrDataUrl} />
              ) : (
                <QrCode className="text-black" size={56} />
              )}
            </div>
            <div className="text-sm leading-6 text-white/60">
              <div className="font-semibold text-white">Scan to get started</div>
              <div>or chat with the room desk.</div>
              <button type="button" className="button-quiet mt-3" onClick={onExit}>
                Exit display
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:overflow-hidden">
          <section className="min-h-0 overflow-hidden border border-white/10 bg-[#101010]">
            <SectionHeader
              icon={<Table2 size={18} />}
              title="Now and next"
              detail={`${roomDisplay.counts.live} live · ${roomDisplay.counts.upcoming} upcoming`}
            />
            <div className="grid max-h-[calc(100vh-230px)] gap-3 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {roomDisplay.nextMeetings.length === 0 && (
                <div className="sm:col-span-2 xl:col-span-3 2xl:col-span-4">
                  <EmptyState
                    title="No upcoming meetings"
                    detail="Accepted 1:1 meetings will appear on this display."
                  />
                </div>
              )}
              {roomDisplay.nextMeetings.map((meeting) => (
                <article
                  key={meeting.meetingId}
                  className="grid min-h-[230px] gap-4 border border-white/10 bg-white/[0.045] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-2xl text-[#f8e18e]">T{meeting.tableNumber}</div>
                    <StatusBadge status={meeting.status} />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/45">
                      {meeting.label}
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold leading-tight">
                      {meeting.companyName}
                    </h2>
                  </div>
                  <div className="self-end border-t border-white/10 pt-3">
                    <div className="text-sm font-semibold">{meeting.attendeeName}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">
                      {meeting.attendeeTitle}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="grid min-h-0 gap-4 xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden">
            <section className="grid grid-cols-2 gap-2">
              <DisplayStat label="Open companies" value={roomDisplay.counts.openCompanies} />
              <DisplayStat label="Pending" value={roomDisplay.counts.pendingRequests} />
              <DisplayStat label="Tables" value={roomDisplay.settings.activeTables} />
              <DisplayStat label="Slot length" value={`${roomDisplay.settings.slotMinutes}m`} />
            </section>
            <section className="min-h-0 overflow-hidden border border-white/10 bg-[#101010]">
              <SectionHeader
                icon={<Sparkles size={18} />}
                title="Open next"
                detail={`${roomDisplay.opportunities.length} options`}
              />
              <div className="divide-y divide-white/10 xl:max-h-[calc(100vh-360px)] xl:overflow-y-auto">
                {roomDisplay.opportunities.length === 0 && (
                  <EmptyState
                    title="No open slots"
                    detail="Check the desk for manual routing."
                  />
                )}
                {roomDisplay.opportunities.map((opportunity) => (
                  <div key={`${opportunity.companyId}-${opportunity.startMinute}`} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold leading-tight">
                          {opportunity.companyName}
                        </div>
                        <div className="mt-1 text-xs text-white/45">
                          {opportunity.hostNames.join(", ") || opportunity.tier}
                        </div>
                      </div>
                      <div className="font-mono text-[#f8e18e]">{opportunity.label}</div>
                    </div>
                    <TagRow items={opportunity.topics} />
                  </div>
                ))}
              </div>
            </section>
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

function Marketplace({
  actionPending,
  actor,
  availability,
  companies,
  requests,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  availability: Availability[];
  companies: Company[];
  requests: RequestDoc[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const createRequest = useMutation(api.networking.createRequest);
  const eligibleCompanies = companies
    .filter((company) => company.optedIn)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const [selectedCompanyId, setSelectedCompanyId] = useState<Id<"companies"> | "">(
    eligibleCompanies[0]?._id ?? "",
  );
  const [date, setDate] = useState("2026-06-30");
  const [preferredStartMinute, setPreferredStartMinute] = useState(10 * 60 + 40);
  const [alternateStartMinute, setAlternateStartMinute] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [context, setContext] = useState("");
  const selectedCompany =
    eligibleCompanies.find((company) => company._id === selectedCompanyId) ??
    eligibleCompanies[0];
  const effectiveSelectedCompanyId = selectedCompany?._id ?? "";
  const myRequests = requests.filter((request) => request.attendeeAccountId === actor._id);
  const dailyCount = myRequests.filter(
    (request) => request.date === date && isOpenRequestStatus(request.status),
  ).length;
  const atRequestCap = dailyCount >= settings.attendeeRequestCapPerDay;
  const availableSlots = selectedCompany
    ? slotLabels.filter((slot) =>
        availability
          .filter((window) => window.companyId === selectedCompany._id && window.date === date)
          .some((window) => slot.minute >= window.startMinute && slot.minute < window.endMinute),
      )
    : slotLabels;
  const hasAvailability = availableSlots.length > 0;
  const effectivePreferredStartMinute = availableSlots.some(
    (slot) => slot.minute === preferredStartMinute,
  )
    ? preferredStartMinute
    : availableSlots[0]?.minute;
  const effectiveAlternateStartMinute =
    alternateStartMinute !== "" &&
    availableSlots.some((slot) => slot.minute === alternateStartMinute)
      ? alternateStartMinute
      : "";
  const canSubmit =
    actor.role === "attendee" &&
    Boolean(effectiveSelectedCompanyId) &&
    hasAvailability &&
    effectivePreferredStartMinute !== undefined &&
    !atRequestCap &&
    !actionPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!effectiveSelectedCompanyId || effectivePreferredStartMinute === undefined || !canSubmit) {
      return;
    }
    void runAction(
      () =>
        createRequest({
          sessionToken,
          companyId: effectiveSelectedCompanyId,
          date,
          preferredStartMinute: effectivePreferredStartMinute,
          ...(effectiveAlternateStartMinute === "" ? {} : { alternateStartMinute: effectiveAlternateStartMinute }),
          reason,
          context,
        }),
      "Meeting request submitted.",
    ).then((completed) => {
      if (completed) {
        setReason("");
        setContext("");
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Sparkles size={17} />} title="Opted-in companies" detail={`${eligibleCompanies.length} available`} />
        <div className="divide-y divide-white/10">
          {eligibleCompanies.length === 0 && <EmptyState title="No companies are open" detail="Ask an admin to opt companies into the networking room before attendees request meetings." />}
          {eligibleCompanies.map((company) => (
            <button
              key={company._id}
              onClick={() => setSelectedCompanyId(company._id)}
              className={cn(
                "grid w-full gap-3 p-4 text-left transition sm:grid-cols-[1fr_auto]",
                effectiveSelectedCompanyId === company._id ? "bg-[#f8e18e]/10" : "hover:bg-white/[0.04]",
              )}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{company.name}</h3>
                  <Badge>{company.tier}</Badge>
                  {company.sponsor && <Badge accent>sponsor</Badge>}
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">{company.description}</p>
                <TagRow items={company.topics} />
              </div>
              <div className="text-left sm:text-right">
                <div className="text-sm font-semibold">{myRequests.filter((request) => request.companyId === company._id).length} requests</div>
                <div className="mt-1 text-xs text-white/45">{company.hostNames.join(", ") || "Host TBD"}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
      <form onSubmit={submit} className="border border-white/10 bg-[#101010] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
          <MessageSquare size={16} /> Request meeting
        </div>
        <div className="mt-1 text-xs text-white/45">
          {dailyCount}/{settings.attendeeRequestCapPerDay} requests used for {dateLabels[date]}
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Company">
            <select className="input" value={effectiveSelectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value as Id<"companies">)} required>
              {eligibleCompanies.length === 0 && <option value="">No opted-in companies</option>}
              {eligibleCompanies.map((company) => <option key={company._id} value={company._id}>{company.name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <select className="input" value={date} onChange={(e) => setDate(e.target.value)}>
              <option value="2026-06-30">Tue Jun 30</option>
              <option value="2026-07-01">Wed Jul 1</option>
            </select>
          </Field>
          <Field label="Preferred time">
            <select className="input" value={hasAvailability ? effectivePreferredStartMinute : ""} onChange={(e) => setPreferredStartMinute(Number(e.target.value))} disabled={!hasAvailability}>
              {hasAvailability ? availableSlots.map((slot) => <option key={slot.minute} value={slot.minute}>{slot.label}</option>) : <option value="">No availability for this date</option>}
            </select>
          </Field>
          <Field label="Alternate time">
            <select className="input" value={effectiveAlternateStartMinute} onChange={(e) => setAlternateStartMinute(e.target.value === "" ? "" : Number(e.target.value))} disabled={!hasAvailability}>
              <option value="">No alternate</option>
              {availableSlots.map((slot) => <option key={slot.minute} value={slot.minute}>{slot.label}</option>)}
            </select>
          </Field>
          <Field label="Reason">
            <textarea className="input min-h-24 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should the company know before accepting?" required />
          </Field>
          <Field label="Context">
            <textarea className="input min-h-20 resize-none" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Role, company, buying/research intent" />
          </Field>
          <button className="button-primary" disabled={!canSubmit} type="submit">
            <MessageSquare size={16} /> Request meeting
          </button>
          {actor.role !== "attendee" && <p className="text-xs leading-5 text-white/45">Switch to an attendee account to submit requests.</p>}
          {actor.role === "attendee" && !hasAvailability && <p className="text-xs leading-5 text-white/45">This company has not opened availability for the selected date.</p>}
          {actor.role === "attendee" && atRequestCap && <p className="text-xs leading-5 text-white/45">Daily request cap reached for this date.</p>}
        </div>
      </form>
    </div>
  );
}

function RequestQueue({
  actionPending,
  actor,
  onSelect,
  requests,
  runAction,
  sessionToken,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  onSelect: (id: Id<"meetingRequests">) => void;
  requests: RequestDoc[];
  runAction: RunAction;
  sessionToken: string;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const respond = useMutation(api.networking.respondToRequest);
  const confirmCounter = useMutation(api.networking.confirmCounter);
  const visible = requests
    .filter((request) => {
      if (actor.role === "admin") return true;
      if (actor.role === "company") return actor.companyId === request.companyId;
      return actor._id === request.attendeeAccountId;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader icon={<ListChecks size={17} />} title="Request queue" detail={`${visible.length} visible`} />
      <div className="divide-y divide-white/10">
        {visible.length === 0 && <EmptyState title="No visible requests" detail="Requests will appear here when attendees ask for time with this company." />}
        {visible.map((request) => {
          const counterStartMinute = nextCounterStartMinute(
            slotLabels,
            request.preferredStartMinute,
          );

          return (
            <div key={request._id} className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_270px]">
              <button onClick={() => onSelect(request._id)} className="min-w-0 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{request.company?.name ?? "Company"}</h3>
                  <StatusBadge status={request.status} />
                  <span className="text-xs text-white/45">{dateLabels[request.date]} · {minuteLabel(request.preferredStartMinute)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/60">{request.reason}</p>
                <p className="mt-2 text-xs text-white/45">{request.attendee?.displayName} · {request.attendee?.title}</p>
              </button>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {actor.role !== "attendee" && canHostRespond(request.status) && (
                  <>
                    <button className="button-quiet" disabled={actionPending} onClick={() => void runAction(() => respond({ sessionToken, requestId: request._id, action: "decline", note: "Declined from queue." }), "Request declined.")}>
                      <X size={15} /> Decline
                    </button>
                    <button
                      className="button-quiet"
                      disabled={actionPending || counterStartMinute === undefined}
                      onClick={() => {
                        if (counterStartMinute === undefined) return;
                        void runAction(
                          () =>
                            respond({
                              sessionToken,
                              requestId: request._id,
                              action: "counter",
                              counterStartMinute,
                              note: "Counter-proposed to the next available slot.",
                            }),
                          "Counter sent.",
                        );
                      }}
                    >
                      <Clock3 size={15} /> Counter
                    </button>
                    <button className="button-primary" disabled={actionPending} onClick={() => void runAction(() => respond({ sessionToken, requestId: request._id, action: "accept", note: "Accepted from queue." }), "Request accepted and table assigned.")}>
                      <Check size={15} /> Accept
                    </button>
                  </>
                )}
                {actor.role === "attendee" && request.status === "countered" && request.attendeeAccountId === actor._id && (
                  <button className="button-primary" disabled={actionPending} onClick={() => void runAction(() => confirmCounter({ sessionToken, requestId: request._id }), "Counter confirmed.")}>
                    <Check size={15} /> Confirm counter
                  </button>
                )}
              </div>
            </div>
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
  onSelectRequest,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  meetings: MeetingDoc[];
  onSelectRequest: (id: Id<"meetingRequests">) => void;
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const moveMeeting = useMutation(api.networking.moveMeeting);
  const updateMeetingStatus = useMutation(api.networking.updateMeetingStatus);
  const visible = meetings
    .filter((meeting) => actor.role === "admin" || actor.companyId === meeting.companyId || actor._id === meeting.attendeeAccountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.tableNumber - b.tableNumber);
  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader
        icon={<CalendarDays size={17} />}
        title="Confirmed schedule"
        detail={`${visible.length} meetings`}
        action={<button className="button-quiet" onClick={() => csvDownload("aiewf-networking-schedule.csv", [["date", "time", "table", "company", "attendee", "status"], ...visible.map((meeting) => [meeting.date, minuteLabel(meeting.startMinute), String(meeting.tableNumber), meeting.company?.name ?? "", meeting.attendee?.displayName ?? "", meeting.status])])}><Download size={15} /> Export schedule</button>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-white/45">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Table</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Attendee</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Ops</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {visible.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No confirmed meetings" detail="Accepted requests will appear here with their assigned tables." />
                </td>
              </tr>
            )}
            {visible.map((meeting) => (
              <tr key={meeting._id} className="align-top">
                <td className="px-4 py-3">{dateLabels[meeting.date]}</td>
                <td className="px-4 py-3 font-mono text-[#f8e18e]">{minuteLabel(meeting.startMinute)}</td>
                <td className="px-4 py-3">Table {meeting.tableNumber}</td>
                <td className="px-4 py-3">{meeting.company?.name}</td>
                <td className="px-4 py-3"><button className="text-left hover:text-[#f8e18e]" onClick={() => onSelectRequest(meeting.requestId)}>{meeting.attendee?.displayName}</button><div className="text-xs text-white/45">{meeting.attendee?.title}</div></td>
                <td className="px-4 py-3"><StatusBadge status={meeting.status} /></td>
                <td className="px-4 py-3">
                  {actor.role === "admin" ? (
                    <div className="flex flex-wrap gap-2">
                      <select
                        aria-label={`Move ${meeting.company?.name ?? "company"} meeting time`}
                        className="small-input w-28"
                        disabled={actionPending}
                        value={meeting.startMinute}
                        onChange={(e) => void runAction(() => moveMeeting({ sessionToken, meetingId: meeting._id, startMinute: Number(e.target.value), tableNumber: meeting.tableNumber }), "Meeting moved.")}
                      >
                        {slotLabels.map((slot) => <option key={slot.minute} value={slot.minute}>{slot.label}</option>)}
                      </select>
                      <select
                        aria-label={`Reassign ${meeting.company?.name ?? "company"} meeting table`}
                        className="small-input w-20"
                        disabled={actionPending}
                        value={meeting.tableNumber}
                        onChange={(e) => void runAction(() => moveMeeting({ sessionToken, meetingId: meeting._id, startMinute: meeting.startMinute, tableNumber: Number(e.target.value) }), "Table reassigned.")}
                      >
                        {Array.from({ length: settings.activeTables + settings.reserveTables }, (_, index) => <option key={index + 1} value={index + 1}>T{index + 1}</option>)}
                      </select>
                    </div>
                  ) : (
                    <button className="button-quiet" disabled={actionPending} onClick={() => void runAction(() => updateMeetingStatus({ sessionToken, meetingId: meeting._id, status: meeting.status === "completed" ? "confirmed" : "completed" }), "Meeting status updated.")}>
                      <Check size={15} /> Toggle done
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompaniesView({
  actionPending,
  actor,
  availability,
  companies,
  runAction,
  sessionToken,
}: {
  actionPending: boolean;
  actor: Account;
  availability: Availability[];
  companies: Company[];
  runAction: RunAction;
  sessionToken: string;
}) {
  const setCompanyOptIn = useMutation(api.networking.setCompanyOptIn);
  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader icon={<Building2 size={17} />} title="Company inventory" detail={`${companies.length} companies`} />
      <div className="divide-y divide-white/10">
        {companies.length === 0 && <EmptyState title="No companies loaded" detail="Import or seed company data before opening attendee requests." />}
        {companies.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).map((company) => (
          <div key={company._id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{company.name}</h3>
                <StatusBadge status={company.optedIn ? "opted in" : "hidden"} />
                <span className="text-xs text-white/45">{company.tier}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-white/60">{company.description}</p>
              <TagRow items={[...company.topics, ...company.wantsToMeet].slice(0, 8)} />
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
                <span className="flex items-center gap-1"><Mail size={13} />{company.contactEmail}</span>
                <span className="flex items-center gap-1"><Clock3 size={13} />{availability.filter((window) => window.companyId === company._id).length} windows</span>
              </div>
            </div>
            {actor.role === "admin" && (
              <div className="flex items-center gap-2 lg:justify-end">
                <button className={company.optedIn ? "button-quiet" : "button-primary"} disabled={actionPending} onClick={() => void runAction(() => setCompanyOptIn({ sessionToken, companyId: company._id, optedIn: !company.optedIn }), company.optedIn ? "Company hidden." : "Company opted in.")}>
                  {company.optedIn ? <X size={15} /> : <Check size={15} />}{company.optedIn ? "Hide" : "Opt in"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminView({
  actionPending,
  actor,
  companies,
  importBatches,
  meetings,
  runAction,
  sessionToken,
  setSessionToken,
  settings,
}: {
  actionPending: boolean;
  actor: Account;
  companies: Company[];
  importBatches: Array<Doc<"importBatches">>;
  meetings: MeetingDoc[];
  runAction: RunAction;
  sessionToken: string;
  setSessionToken: (token: string) => void;
  settings: Settings;
}) {
  const updateSettings = useMutation(api.networking.updateSettings);
  const upsertCompanies = useMutation(api.networking.upsertCompaniesFromRows);
  const resetDemoData = useMutation(api.networking.resetDemoData);
  const [form, setForm] = useState({
    dayStartMinute: settings.dayStartMinute,
    dayEndMinute: settings.dayEndMinute,
    slotMinutes: settings.slotMinutes,
    activeTables: settings.activeTables,
    reserveTables: settings.reserveTables,
    attendeeRequestCapPerDay: settings.attendeeRequestCapPerDay,
    companyAcceptCapPerDay: settings.companyAcceptCapPerDay,
    allowCounters: settings.allowCounters,
    sponsorsOnlyDefault: settings.sponsorsOnlyDefault,
  });
  const [csv, setCsv] = useState("name,tier,contactEmail,hostNames,topics,wantsToMeet,sponsor,optedIn,description\nAnthropic,Lab,anthropic-hosts@aiewf.test,Dana Lee,agents;evals,enterprise leaders;AI engineers,true,false,Imported candidate sponsor");

  if (actor.role !== "admin") {
    return <section className="border border-white/10 bg-[#101010] p-6"><ShieldCheck className="text-[#f8e18e]" /><h2 className="mt-4 text-xl font-semibold">Admin access required</h2><p className="mt-2 text-sm text-white/55">Switch to admin@aiewf.test to manage room settings.</p></section>;
  }

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    void runAction(() => updateSettings({ sessionToken, ...form }), "Settings updated.");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={saveSettings} className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<SlidersHorizontal size={17} />} title="Room settings" detail="Admin defaults" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <NumberField label="Day start minute" value={form.dayStartMinute} onChange={(v) => setForm({ ...form, dayStartMinute: v })} />
          <NumberField label="Day end minute" value={form.dayEndMinute} onChange={(v) => setForm({ ...form, dayEndMinute: v })} />
          <NumberField label="Slot minutes" value={form.slotMinutes} onChange={(v) => setForm({ ...form, slotMinutes: v })} />
          <NumberField label="Active tables" value={form.activeTables} onChange={(v) => setForm({ ...form, activeTables: v })} />
          <NumberField label="Reserve tables" value={form.reserveTables} onChange={(v) => setForm({ ...form, reserveTables: v })} />
          <NumberField label="Attendee request cap" value={form.attendeeRequestCapPerDay} onChange={(v) => setForm({ ...form, attendeeRequestCapPerDay: v })} />
          <NumberField label="Company accept cap" value={form.companyAcceptCapPerDay} onChange={(v) => setForm({ ...form, companyAcceptCapPerDay: v })} />
          <Toggle label="Allow counters" checked={form.allowCounters} onChange={(v) => setForm({ ...form, allowCounters: v })} />
          <Toggle label="Sponsors default" checked={form.sponsorsOnlyDefault} onChange={(v) => setForm({ ...form, sponsorsOnlyDefault: v })} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-white/10 p-4">
          <button className="button-primary" disabled={actionPending} type="submit"><Settings2 size={15} /> Save settings</button>
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
        </div>
      </form>
      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Database size={17} />} title="Data ops" detail="CSV-ready" />
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button className="button-quiet" onClick={() => csvDownload("aiewf-companies.csv", [["name", "tier", "contactEmail", "hostNames", "topics", "wantsToMeet", "sponsor", "optedIn", "description"], ...companies.map((company) => [company.name, company.tier, company.contactEmail, company.hostNames.join(";"), company.topics.join(";"), company.wantsToMeet.join(";"), String(company.sponsor), String(company.optedIn), company.description])])}><Download size={15} /> Companies</button>
            <button className="button-quiet" onClick={() => csvDownload("aiewf-meetings.csv", [["date", "time", "table", "company", "attendee", "status"], ...meetings.map((meeting) => [meeting.date, minuteLabel(meeting.startMinute), String(meeting.tableNumber), meeting.company?.name ?? "", meeting.attendee?.displayName ?? "", meeting.status])])}><Download size={15} /> Meetings</button>
          </div>
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} className="input min-h-52 resize-y font-mono text-xs" />
          <button className="button-primary" disabled={actionPending} onClick={() => {
            const parsed = parseCompanyCsv(csv);
            void runAction(
              () =>
                parsed.error
                  ? Promise.reject(new Error(parsed.error))
                  : upsertCompanies({ sessionToken, rows: parsed.rows }),
              parsed.error ? "" : `${parsed.rows.length} CSV rows processed.`,
            );
          }}><Upload size={15} /> Import company CSV</button>
          <div className="border-t border-white/10 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Recent imports</div>
            <div className="mt-2 grid gap-2">
              {importBatches.length === 0 && <p className="text-xs leading-5 text-white/45">No import batches yet.</p>}
              {importBatches.map((batch) => <div key={batch._id} className="border border-white/10 bg-black/30 p-2 text-xs text-white/60">{batch.summary} · {batch.rowCount} rows</div>)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function DetailPanel({
  actionPending,
  actor,
  request,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account | null;
  request: RequestDoc | null;
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const respond = useMutation(api.networking.respondToRequest);
  const confirmCounter = useMutation(api.networking.confirmCounter);
  const counterStartMinute = request
    ? nextCounterStartMinute(slotLabels, request.preferredStartMinute)
    : undefined;
  return (
    <aside className="border border-white/10 bg-[#101010] p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-92px)] lg:overflow-y-auto">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]"><LayoutDashboard size={17} /> Request detail</div>
      {!request || !actor ? (
        <p className="mt-6 text-sm leading-6 text-white/55">Select a request to inspect status and table assignment.</p>
      ) : (
        <div className="mt-4 grid gap-4">
          <div><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{request.company?.name}</h2><StatusBadge status={request.status} /></div><p className="mt-2 text-sm leading-6 text-white/60">{request.reason}</p></div>
          <InfoLine icon={<Users size={15} />} label="Attendee" value={`${request.attendee?.displayName} · ${request.attendee?.title}`} />
          <InfoLine icon={<MapPin size={15} />} label="Room" value={settings.roomName} />
          <InfoLine icon={<Clock3 size={15} />} label="Preferred" value={`${dateLabels[request.date]} · ${minuteLabel(request.preferredStartMinute)}`} />
          {request.counterStartMinute && <InfoLine icon={<Clock3 size={15} />} label="Counter" value={minuteLabel(request.counterStartMinute)} />}
          {request.meeting && <InfoLine icon={<Table2 size={15} />} label="Assigned" value={`Table ${request.meeting.tableNumber} · ${minuteLabel(request.meeting.startMinute)}`} />}
          <div className="border border-white/10 bg-black/30 p-3"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Context</div><p className="mt-2 text-sm leading-6 text-white/65">{request.context || "No context added."}</p></div>
          <div className="grid gap-2">
            {actor.role !== "attendee" && canHostRespond(request.status) && (
              <>
                <button className="button-primary" disabled={actionPending} onClick={() => void runAction(() => respond({ sessionToken, requestId: request._id, action: "accept", note: "Accepted from detail panel." }), "Request accepted.")}><Check size={15} /> Accept</button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="button-quiet"
                    disabled={actionPending || counterStartMinute === undefined}
                    onClick={() => {
                      if (counterStartMinute === undefined) return;
                      void runAction(
                        () =>
                          respond({
                            sessionToken,
                            requestId: request._id,
                            action: "counter",
                            counterStartMinute,
                            note: "Counter-proposed from detail panel.",
                          }),
                        "Counter sent.",
                      );
                    }}
                  ><Clock3 size={15} /> Counter</button>
                  <button className="button-quiet" disabled={actionPending} onClick={() => void runAction(() => respond({ sessionToken, requestId: request._id, action: "decline", note: "Declined from detail panel." }), "Request declined.")}><X size={15} /> Decline</button>
                </div>
              </>
            )}
            {actor.role === "attendee" && request.status === "countered" && request.attendeeAccountId === actor._id && (
              <button className="button-primary" disabled={actionPending} onClick={() => void runAction(() => confirmCounter({ sessionToken, requestId: request._id }), "Counter confirmed.")}><Check size={15} /> Confirm counter</button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function SectionHeader({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><span className="text-[#f8e18e]">{icon}</span><h2 className="font-semibold">{title}</h2>{detail && <span className="text-xs text-white/45">{detail}</span>}</div>{action}</div>;
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
  return <label className="grid gap-1 text-xs font-medium uppercase tracking-[0.12em] text-white/45">{label}{children}</label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <Field label={label}><input className="input" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between border border-white/10 bg-black/30 px-3 py-3 text-sm text-white/70">{label}<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-flex border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", statusStyles[status] ?? "border-white/10 bg-white/5 text-white/55")}>{status.replace("_", " ")}</span>;
}

function Badge({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={cn("border px-2 py-1 text-[11px] uppercase tracking-[0.12em]", accent ? "border-[#f8e18e]/30 bg-[#f8e18e]/10 text-[#f8e18e]" : "border-white/10 text-white/50")}>{children}</span>;
}

function TagRow({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <div className="mt-3 flex flex-wrap gap-2">{items.slice(0, 7).map((item) => <span key={item} className="border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/55">{item}</span>)}</div>;
}

function InfoLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex gap-3 border border-white/10 bg-black/30 p-3"><span className="mt-0.5 text-[#f8e18e]">{icon}</span><div><div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">{label}</div><div className="mt-1 text-sm leading-5 text-white/75">{value}</div></div></div>;
}
