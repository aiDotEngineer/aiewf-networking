"use client";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LockKeyhole,
  Mail,
  Menu,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Upload,
  Users,
  X,
} from "lucide-react";
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
type View = "marketplace" | "requests" | "schedule" | "companies" | "admin";
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

function userFacingError(error: unknown) {
  if (!(error instanceof Error)) return "Action failed.";
  const raw = error.message.trim();
  const convexMessage = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n| at | Called by client|$)/);
  return (convexMessage?.[1] ?? raw).trim();
}

function isViewAvailable(view: View, actor: Account | null) {
  if (!actor) return false;
  if (view === "admin") return actor.role === "admin";
  if (view === "marketplace") return actor.role !== "company";
  return true;
}

function fallbackView(actor: Account | null): View {
  return actor?.role === "company" ? "requests" : "marketplace";
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
  const [actorEmail, setActorEmail] = useState("admin@aiewf.test");
  const data = useQuery(
    api.networking.getBootstrap,
    sessionToken ? { sessionToken } : "skip",
  );
  const [activeView, setActiveView] = useState<View>("marketplace");
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
      accounts.find((account) => account.role === "admin")?.email ?? accounts[0].email;
    startSession(initialEmail);
  }, [accounts, startSession]);

  function changeAccount(email: string) {
    startSession(email);
  }

  const actor = data?.actor ?? null;
  const effectiveActiveView = isViewAvailable(activeView, actor)
    ? activeView
    : fallbackView(actor);
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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
          <Navigation actor={actor} activeView={effectiveActiveView} onChange={setActiveView} />
          <section className="min-w-0">
            <MetricStrip settings={data.settings} stats={stats} />
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
          <DetailPanel
            actionPending={actionPending}
            actor={actor}
            request={selectedRequest}
            runAction={runAction}
            sessionToken={sessionToken}
            settings={data.settings}
            slotLabels={data.slotLabels}
          />
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
    { id: "marketplace", label: "Marketplace", icon: <Search size={16} /> },
    { id: "requests", label: "Requests", icon: <ListChecks size={16} /> },
    { id: "schedule", label: "Schedule", icon: <CalendarDays size={16} /> },
    { id: "companies", label: "Companies", icon: <Building2 size={16} /> },
    { id: "admin", label: "Admin", icon: <Settings2 size={16} /> },
  ];
  const items = allItems.filter((item) => {
    if (item.id === "admin") return actor?.role === "admin";
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
        Double opt-in by default. Companies must accept before table assignment.
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
  const dailyCount = myRequests.filter((request) => request.date === date && request.status !== "cancelled").length;
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
