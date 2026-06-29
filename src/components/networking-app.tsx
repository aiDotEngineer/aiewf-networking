"use client";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Gauge,
  Import,
  ListChecks,
  Loader2,
  LockKeyhole,
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
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

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
  active: boolean;
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
type ImportBatch = Doc<"importBatches">;
type Bootstrap = {
  settings: Settings;
  actor: Account;
  accounts: Array<Account | null>;
  participants: Array<Account | null>;
  myAvailability: AvailabilitySlot[];
  allAvailability: AvailabilitySlot[];
  requests: MeetingRequest[];
  meetings: Meeting[];
  importBatches: ImportBatch[];
  slotLabels: Array<{ minute: number; label: string }>;
};
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
  const stats = dashboardStats(data);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <TopStrip settings={data.settings} />
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
        <Header
          actor={actor}
          actorEmail={actorEmail}
          demoAccounts={accounts ?? []}
          demoLoginEnabled={demoLoginEnabled}
          isPending={sessionPending}
          onActorChange={startSession}
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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Navigation actor={actor} activeView={activeView} onChange={setActiveView} />
          <section className="min-w-0">
            <MetricStrip settings={data.settings} stats={stats} />
            {activeView === "directory" && (
              <DirectoryView
                actionPending={actionPending}
                actor={actor}
                participants={visibleAccounts(data.participants)}
                requests={data.requests}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
              />
            )}
            {activeView === "profile" && (
              <ProfileView
                actionPending={actionPending}
                actor={actor}
                availability={data.myAvailability}
                runAction={runAction}
                sessionToken={sessionToken}
                settings={data.settings}
                slotLabels={data.slotLabels}
              />
            )}
            {activeView === "requests" && (
              <RequestsView
                actionPending={actionPending}
                actor={actor}
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
                actor={actor}
                meetings={data.meetings}
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
                participants={visibleAccounts(data.participants)}
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

function dashboardStats(data: Bootstrap) {
  const slotsPerDay = Math.floor(
    (data.settings.dayEndMinute - data.settings.dayStartMinute) / data.settings.slotMinutes,
  );
  const participants = visibleAccounts(data.participants);
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
            <div className="font-mono text-xs text-[#f8e18e]">$ ai.engineer/wf/networking</div>
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
  demoAccounts,
  demoLoginEnabled,
  isPending,
  onActorChange,
  onLogout,
}: {
  actor: Account;
  actorEmail: string;
  demoAccounts: DemoAccount[];
  demoLoginEnabled: boolean;
  isPending: boolean;
  onActorChange: (email: string) => void;
  onLogout: () => void;
}) {
  return (
    <header className="grid gap-3 border border-white/10 bg-[#101010] p-3 sm:grid-cols-[1fr_auto] sm:p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
          <span className="font-mono text-[#f8e18e]">$ ai.engineer/wf/networking</span>
          <span className="hidden sm:inline">·</span>
          <span>Peer booking room</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Networking Room
          </h1>
          <RolePill actor={actor} />
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

function RolePill({ actor }: { actor: Account }) {
  return (
    <span className="inline-flex items-center gap-1 border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
      <LockKeyhole size={12} />
      {actor.role}
      {actor.role === "participant" ? ` · ${actor.directoryOptIn ? "opted in" : "hidden"}` : ""}
    </span>
  );
}

function Navigation({
  activeView,
  actor,
  onChange,
}: {
  activeView: View;
  actor: Account;
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
  const items = allItems.filter((item) => item.id !== "admin" || actor.role === "admin");
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
      <div className="mt-4 hidden border-t border-white/10 pt-4 text-xs leading-5 text-white/45 lg:block">
        Opt-in participants request time with each other. Accepted groups take one table, up to four people.
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
  participants,
  requests,
  runAction,
  sessionToken,
  settings,
}: {
  actionPending: boolean;
  actor: Account;
  participants: Account[];
  requests: MeetingRequest[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
}) {
  const createPeerRequest = useMutation(api.networking.createPeerRequest);
  const [query, setQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState("all");
  const [date, setDate] = useState(settings.startDate);
  const [selectedId, setSelectedId] = useState<Id<"accounts"> | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const selected =
    participants.find((participant) => participant._id === selectedId) ??
    participants.find((participant) => participant._id !== actor._id) ??
    null;
  const availability = useQuery(
    api.networking.getParticipantAvailability,
    selected ? { accountId: selected._id, date } : "skip",
  ) as AvailabilitySlot[] | undefined;

  const activeOutgoingForDay = requests.filter(
    (request) =>
      request.requesterAccountId === actor._id &&
      request.date === date &&
      activeOutgoingStatus(request.status),
  );
  const atCap = activeOutgoingForDay.length >= settings.outgoingRequestCapPerDay;
  const openTargetIds = new Set(activeOutgoingForDay.map((request) => request.targetAccountId));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = participants
    .filter((participant) => participant.role === "participant" && participant._id !== actor._id)
    .filter((participant) => participant.signedUp && participant.directoryOptIn)
    .filter((participant) => ticketFilter === "all" || participant.ticketCategory === ticketFilter)
    .filter((participant) => {
      if (!normalizedQuery) return true;
      const haystack = [
        participant.displayName,
        participant.company,
        participant.title,
        participant.networkingIntent,
        participant.topics.join(" "),
        participant.city,
        participant.country,
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((a, b) => a.company.localeCompare(b.company) || a.displayName.localeCompare(b.displayName));
  const availableSlots = (availability ?? []).filter((slot) => slot.available && slot.groupOpen !== false);
  const fallbackSlot: number | "" = availableSlots.length > 0 ? availableSlots[0].startMinute : "";
  const effectiveSelectedSlot: number | "" =
    selectedSlot !== "" && availableSlots.some((slot) => slot.startMinute === selectedSlot)
      ? selectedSlot
      : fallbackSlot;

  function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!selected || effectiveSelectedSlot === "" || atCap) return;
    void runAction(
      () =>
        createPeerRequest({
          sessionToken,
          targetAccountId: selected._id,
          date,
          preferredStartMinute: effectiveSelectedSlot,
          reason,
          context: `${actor.title}, ${actor.company}`,
        }),
      `Request sent to ${selected.displayName}.`,
    ).then((completed) => {
      if (completed) setReason("");
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Search size={17} />} title="Participant directory" detail={`${filtered.length} visible`} />
        <div className="grid gap-3 border-b border-white/10 p-4 md:grid-cols-[minmax(0,1fr)_180px_160px]">
          <Field label="Search">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company, name, title, intent..."
            />
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
          <Field label="Date">
            <select className="input" value={date} onChange={(event) => setDate(event.target.value)}>
              {eventDateEntries(settings).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.length === 0 && (
            <div className="md:col-span-2 2xl:col-span-3">
              <EmptyState title="No matching participants" detail="Try a broader company, name, or topic search." />
            </div>
          )}
          {filtered.map((participant) => (
            <button
              key={participant._id}
              className={cn(
                "grid min-h-[210px] gap-3 border p-4 text-left transition",
                selected?._id === participant._id
                  ? "border-[#f8e18e]/70 bg-[#f8e18e]/10"
                  : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.045]",
              )}
              onClick={() => {
                setSelectedId(participant._id);
                setSelectedSlot("");
              }}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold leading-tight">{participant.displayName}</h3>
                  <StatusBadge status={participant.ticketCategory} />
                </div>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  {participant.title || "Title TBD"} · {participant.company || "Company TBD"}
                </p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/50">
                  {participant.networkingIntent || "No networking intent added yet."}
                </p>
              </div>
              <div className="self-end">
                <TagRow items={participant.topics.length ? participant.topics : [participant.city, participant.country].filter(Boolean)} />
                {openTargetIds.has(participant._id) && (
                  <div className="mt-3 text-xs text-[#f8e18e]">Active request already open</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      <form onSubmit={submitRequest} className="border border-white/10 bg-[#101010] p-4 xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f8e18e]">
          <Send size={16} /> Request time
        </div>
        <div className="mt-1 text-xs text-white/45">
          {activeOutgoingForDay.length}/{settings.outgoingRequestCapPerDay} active outgoing requests for {dateLabels[date]}.
        </div>
        {!actor.profileComplete || !actor.directoryOptIn ? (
          <div className="mt-4 border border-yellow-300/20 bg-yellow-300/10 p-3 text-sm leading-6 text-yellow-100">
            Confirm your profile and opt into the directory before sending requests.
          </div>
        ) : selected ? (
          <div className="mt-4 grid gap-3">
            <div className="border border-white/10 bg-black/30 p-3">
              <div className="text-lg font-semibold">{selected.displayName}</div>
              <div className="mt-1 text-sm text-white/55">{selected.title} · {selected.company}</div>
            </div>
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
            </Field>
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
                atCap ||
                !availableSlots.length ||
                reason.trim().length < 8 ||
                openTargetIds.has(selected._id)
              }
              type="submit"
            >
              <Send size={16} /> Send request
            </button>
            {atCap && <p className="text-xs leading-5 text-white/45">Request cap reached for this day.</p>}
          </div>
        ) : (
          <EmptyState title="Select a participant" detail="Choose someone from the directory to see open times." />
        )}
      </form>
    </div>
  );
}

function ProfileView({
  actionPending,
  actor,
  availability,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  availability: AvailabilitySlot[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const updateMyProfile = useMutation(api.networking.updateMyProfile);
  const setMyAvailability = useMutation(api.networking.setMyAvailability);
  const [form, setForm] = useState({
    displayName: actor.displayName,
    title: actor.title,
    company: actor.company,
    city: actor.city,
    country: actor.country,
    networkingIntent: actor.networkingIntent,
    topics: actor.topics.join("; "),
    directoryOptIn: actor.directoryOptIn,
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

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
      <form onSubmit={saveProfile} className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<UserCheck size={17} />} title="Profile confirmation" detail={actor.profileComplete ? "complete" : "needs fields"} />
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
          <Toggle label="Show me in the booking directory" checked={form.directoryOptIn} onChange={(value) => setForm({ ...form, directoryOptIn: value })} />
        </div>
        <div className="border-t border-white/10 p-4">
          <button className="button-primary" disabled={actionPending} type="submit">
            <Check size={15} /> Confirm profile
          </button>
        </div>
      </form>

      <section className="border border-white/10 bg-[#101010]">
        <SectionHeader icon={<Clock3 size={17} />} title="Your availability" detail="toggle open slots" />
        <div className="grid gap-4 p-4">
          {eventDateEntries(settings).map(([date, label]) => {
            const dayAvailability = availability.filter((slot) => slot.date === date);
            return (
              <div key={date} className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-white/70">{label}</span>
                  <span className="text-white/45">{dayAvailability.filter((slot) => slot.available).length} open</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {slotLabels.map((slot) => {
                    const availabilitySlot = dayAvailability.find((item) => item.startMinute === slot.minute);
                    const available = availabilitySlot?.available ?? false;
                    return (
                      <button
                        key={`${date}:${slot.minute}`}
                        type="button"
                        aria-pressed={available}
                        className={cn(
                          "flex h-12 min-w-0 flex-col items-center justify-center border px-2 text-xs font-semibold leading-tight transition",
                          available
                            ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                            : "border-white/10 bg-white/[0.035] text-white/45",
                        )}
                        disabled={actionPending || !actor.profileComplete}
                        onClick={() =>
                          void runAction(
                            () =>
                              setMyAvailability({
                                sessionToken,
                                date,
                                startMinute: slot.minute,
                                available: !available,
                              }),
                            available ? "Slot hidden." : "Slot opened.",
                          )
                        }
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
    </div>
  );
}

function RequestsView({
  actionPending,
  actor,
  requests,
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  requests: MeetingRequest[];
  runAction: RunAction;
  sessionToken: string;
  settings: Settings;
  slotLabels: Array<{ minute: number; label: string }>;
}) {
  const respond = useMutation(api.networking.respondToPeerRequest);
  const confirmCounter = useMutation(api.networking.confirmCounter);
  const cancelRequest = useMutation(api.networking.cancelRequest);
  const visible = requests
    .filter((request) => {
      if (actor.role === "admin") return true;
      return request.requesterAccountId === actor._id || request.targetAccountId === actor._id;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="border border-white/10 bg-[#101010]">
      <SectionHeader icon={<ListChecks size={17} />} title="Request queue" detail={`${visible.length} visible`} />
      <div className="divide-y divide-white/10">
        {visible.length === 0 && <EmptyState title="No requests yet" detail="Incoming and outgoing booking requests will appear here." />}
        {visible.map((request) => {
          const incoming = request.targetAccountId === actor._id;
          const counterStartMinute =
            slotLabels.find((slot) => slot.minute > request.preferredStartMinute)?.minute ??
            slotLabels[0]?.minute;
          return (
            <article key={request._id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">
                    {request.requester?.displayName ?? "Requester"} → {request.target?.displayName ?? "Participant"}
                  </h3>
                  <StatusBadge status={request.status} />
                  <span className="text-xs text-white/45">{dateLabels[request.date]} · {minuteLabel(request.preferredStartMinute)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/60">{request.reason}</p>
                <p className="mt-2 text-xs text-white/45">
                  {request.context || `${request.requester?.title ?? ""} ${request.requester?.company ?? ""}`.trim()}
                </p>
                {request.meeting && (
                  <div className="mt-3 border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">
                    Table {request.meeting.tableNumber} · group {request.meeting.participantCount}/{settings.maxMeetingGroupSize}
                  </div>
                )}
                {request.responseNote && <p className="mt-2 text-xs text-white/45">{request.responseNote}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {(incoming || actor.role === "admin") && (request.status === "pending" || request.status === "countered") && (
                  <>
                    <button
                      className="button-quiet"
                      disabled={actionPending}
                      onClick={() =>
                        void runAction(
                          () => respond({ sessionToken, requestId: request._id, action: "decline", note: "Declined from queue." }),
                          "Request declined.",
                        )
                      }
                    >
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
                              note: `Countered to ${minuteLabel(counterStartMinute)}.`,
                            }),
                          "Counter sent.",
                        );
                      }}
                    >
                      <Clock3 size={15} /> Counter
                    </button>
                    <button
                      className="button-primary"
                      disabled={actionPending}
                      onClick={() =>
                        void runAction(
                          () => respond({ sessionToken, requestId: request._id, action: "accept", note: "Accepted from queue." }),
                          "Request accepted.",
                        )
                      }
                    >
                      <Check size={15} /> Accept
                    </button>
                  </>
                )}
                {request.requesterAccountId === actor._id && request.status === "countered" && (
                  <button
                    className="button-primary"
                    disabled={actionPending}
                    onClick={() => void runAction(() => confirmCounter({ sessionToken, requestId: request._id }), "Counter confirmed.")}
                  >
                    <Check size={15} /> Confirm counter
                  </button>
                )}
                {request.requesterAccountId === actor._id && (request.status === "pending" || request.status === "countered") && (
                  <button
                    className="button-quiet"
                    disabled={actionPending}
                    onClick={() => void runAction(() => cancelRequest({ sessionToken, requestId: request._id }), "Request cancelled.")}
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
  runAction,
  sessionToken,
  settings,
  slotLabels,
}: {
  actionPending: boolean;
  actor: Account;
  meetings: Meeting[];
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
                  disabled={actionPending}
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
  meetings,
  participants,
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
  participants: Account[];
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
          <SectionHeader icon={<Users size={17} />} title="Participant inventory" detail={`${participants.length} rows`} />
          <div className="grid gap-3 p-3">
            {participants.slice(0, 60).map((participant) => (
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
          {requests.length} requests · {meetings.length} meetings currently in Convex.
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
