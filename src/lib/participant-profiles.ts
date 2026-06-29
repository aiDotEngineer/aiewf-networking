export type ProfileConfidence = "high" | "medium" | "low";
export type ProfileSourceKind = "primary" | "secondary";

export type ProfileSource = {
  label: string;
  url: string;
  note: string;
};

export type StaticParticipantProfile = {
  lookupKey: string;
  displayName: string;
  headline: string;
  company: string;
  title: string;
  location: string;
  tags: string[];
  confidence: ProfileConfidence;
  confidenceNote: string;
  participantApproved: boolean;
  aiGenerated: boolean;
  lastResearchedAt: string;
  bioMarkdown: string;
  sources: Record<ProfileSourceKind, ProfileSource[]>;
};

export type ParticipantProfileOverride = {
  headline: string;
  bioMarkdown: string;
  tags: string[];
  participantApproved: boolean;
  approvedAt?: number;
  updatedAt: number;
};

export type DisplayParticipantProfile = StaticParticipantProfile & {
  displayHeadline: string;
  displayBioMarkdown: string;
  displayTags: string[];
  displayParticipantApproved: boolean;
  override?: ParticipantProfileOverride | null;
};

export function profileLookupKey(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value.trim().toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export function sourceCount(profile: StaticParticipantProfile) {
  return profile.sources.primary.length + profile.sources.secondary.length;
}

export function mergeParticipantProfile(
  profile: StaticParticipantProfile,
  override: ParticipantProfileOverride | null | undefined,
): DisplayParticipantProfile {
  return {
    ...profile,
    override,
    displayHeadline: override?.headline.trim() || profile.headline,
    displayBioMarkdown: override?.bioMarkdown.trim() || profile.bioMarkdown,
    displayTags: override?.tags.length ? override.tags : profile.tags,
    displayParticipantApproved: override?.participantApproved || profile.participantApproved,
  };
}

export function profileSearchText(profile: DisplayParticipantProfile) {
  return [
    profile.displayHeadline,
    profile.displayBioMarkdown,
    profile.displayTags.join(" "),
    profile.confidence,
    ...profile.sources.primary.map((source) => `${source.label} ${source.note}`),
    ...profile.sources.secondary.map((source) => `${source.label} ${source.note}`),
  ]
    .join(" ")
    .toLowerCase();
}
