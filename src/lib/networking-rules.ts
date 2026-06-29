export type ParticipantImportRow = Record<string, string | undefined>;

export type TicketCategory = "leadership" | "speaker" | "sponsor" | "other";

export type NormalizedParticipant = {
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  ticketType: string;
  ticketCategory: TicketCategory;
  registrationStatus: string;
  profileImageUrl: string;
  city: string;
  country: string;
  companySize: string;
  profileComplete: boolean;
};

const MISSING_VALUES = new Set(["", "n/a", "na", "none", "null"]);

export const ACTIVE_REQUEST_STATUSES = ["pending", "countered", "accepted"] as const;

export const MAX_MEETING_GROUP_SIZE = 4;

export function cleanSheetValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return MISSING_VALUES.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function normalizeEmail(value: string | undefined) {
  return cleanSheetValue(value).toLowerCase();
}

function coalesceSheetValue(...values: Array<string | undefined>) {
  for (const value of values) {
    const cleaned = cleanSheetValue(value);
    if (cleaned) return cleaned;
  }
  return "";
}

export function ticketCategory(ticketType: string | undefined): TicketCategory {
  const normalized = cleanSheetValue(ticketType).toLowerCase();
  if (normalized.includes("speaker")) return "speaker";
  if (normalized.includes("sponsor")) return "sponsor";
  if (normalized.includes("leadership")) return "leadership";
  return "other";
}

export function normalizeParticipantRow(row: ParticipantImportRow): NormalizedParticipant {
  const firstName = coalesceSheetValue(row["First Name"], row["Holder First Name"], row["Buyer First Name"]);
  const lastName = coalesceSheetValue(row["Last Name"], row["Holder Last Name"], row["Buyer Last Name"]);
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

export function isActiveRequestStatus(status: string) {
  return ACTIVE_REQUEST_STATUSES.includes(
    status as (typeof ACTIVE_REQUEST_STATUSES)[number],
  );
}

export function canJoinMeetingGroup(currentParticipantCount: number) {
  return currentParticipantCount < MAX_MEETING_GROUP_SIZE;
}
