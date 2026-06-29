const speakersUrl = "https://www.ai.engineer/worldsfair/speakers.json";

function normalizedPersonKey(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const dayDateLabels = new Map([
  ["Day 1", "Mon Jun 29"],
  ["Day 2", "Tue Jun 30"],
  ["Day 3", "Wed Jul 1"],
  ["Day 4", "Thu Jul 2"],
]);

function dateLabelForDay(day) {
  const prefix = [...dayDateLabels.keys()].find((candidate) => day.startsWith(candidate));
  return prefix ? dayDateLabels.get(prefix) : day;
}

const response = await fetch(speakersUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch ${speakersUrl}: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const scheduleMap = {};

for (const speaker of payload.speakers ?? []) {
  if (!speaker.name || !Array.isArray(speaker.sessions) || speaker.sessions.length === 0) continue;
  const sessions = speaker.sessions
    .filter((session) => session.status !== "cancelled")
    .map((session) => ({
      dateLabel: dateLabelForDay(session.day ?? ""),
      day: session.day ?? "",
      room: session.room ?? "",
      time: session.time ?? "",
      title: session.title ?? "",
      track: session.track ?? "",
      type: session.type ?? "",
    }));
  if (!sessions.length) continue;
  const dateLabels = [...new Set(sessions.map((session) => session.dateLabel).filter(Boolean))];
  const days = [...new Set(sessions.map((session) => session.day).filter(Boolean))];
  scheduleMap[normalizedPersonKey(speaker.name)] = { dateLabels, days, sessions };
}

const generated = `// Generated from ${speakersUrl} on 2026-06-29.
// Maps normalized speaker names to World Fair session day/time context.

export type SpeakerScheduleSession = {
  dateLabel: string;
  day: string;
  room: string;
  time: string;
  title: string;
  track: string;
  type: string;
};

export type SpeakerScheduleInfo = {
  dateLabels: string[];
  days: string[];
  sessions: SpeakerScheduleSession[];
};

export const speakerScheduleMap: Record<string, SpeakerScheduleInfo> = ${JSON.stringify(scheduleMap, null, 2)};
`;

await import("node:fs/promises").then(({ writeFile }) => writeFile("src/lib/worldsfair-speaker-schedule.ts", generated));
