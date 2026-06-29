import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const shardDir = join(process.cwd(), "content/participant-profile-shards");
const profileDataPath = join(process.cwd(), "src/lib/participant-profile-data.ts");
const validConfidence = new Set(["high", "medium", "low"]);
const errors = [];
const baseSeen = new Map();
const shardSeen = new Map();

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function validateSource(source, path) {
  assert(source && typeof source === "object" && !Array.isArray(source), `${path} source must be an object`);
  assert(typeof source?.label === "string" && source.label.trim().length > 0, `${path} source label missing`);
  assert(typeof source?.url === "string" && /^https?:\/\//.test(source.url), `${path} source url must be http(s)`);
  assert(typeof source?.note === "string" && source.note.trim().length > 0, `${path} source note missing`);
}

function validateProfile(profile, path) {
  for (const field of ["lookupKey", "displayName", "headline", "company", "title", "confidenceNote", "bioMarkdown", "lastResearchedAt"]) {
    assert(typeof profile[field] === "string" && profile[field].trim().length > 0, `${path}.${field} missing`);
  }
  assert(validConfidence.has(profile.confidence), `${path}.confidence invalid`);
  assert(profile.participantApproved === false, `${path}.participantApproved must be false for researched seeds`);
  assert(profile.aiGenerated === true, `${path}.aiGenerated must be true for researched seeds`);
  assert(Array.isArray(profile.tags) && profile.tags.length >= 3, `${path}.tags needs at least 3 items`);
  assert(profile.sources && typeof profile.sources === "object", `${path}.sources missing`);
  assert(Array.isArray(profile.sources?.primary), `${path}.sources.primary missing`);
  assert(Array.isArray(profile.sources?.secondary), `${path}.sources.secondary missing`);
  assert(profile.sources.primary.length + profile.sources.secondary.length >= 2, `${path} needs at least 2 sources`);
  profile.sources.primary.forEach((source, index) => validateSource(source, `${path}.sources.primary[${index}]`));
  profile.sources.secondary.forEach((source, index) => validateSource(source, `${path}.sources.secondary[${index}]`));
  if (shardSeen.has(profile.lookupKey)) {
    errors.push(`${path}.lookupKey duplicates ${shardSeen.get(profile.lookupKey)}`);
  } else {
    shardSeen.set(profile.lookupKey, path);
  }
}

const profileData = readFileSync(profileDataPath, "utf8");
for (const match of profileData.matchAll(/lookupKey:\s*"([^"]+)"/g)) {
  const key = match[1];
  if (baseSeen.has(key)) errors.push(`base profile ${key} duplicates ${baseSeen.get(key)}`);
  baseSeen.set(key, `src/lib/participant-profile-data.ts:${match.index}`);
}

for (const filename of readdirSync(shardDir).filter((file) => file.endsWith(".json")).sort()) {
  const filepath = join(shardDir, filename);
  const profiles = JSON.parse(readFileSync(filepath, "utf8"));
  assert(Array.isArray(profiles), `${filename} must contain an array`);
  profiles.forEach((profile, index) => validateProfile(profile, `${filename}[${index}]`));
}

for (const [key, shardPath] of shardSeen) {
  if (baseSeen.has(key)) errors.push(`${shardPath}.lookupKey duplicates base profile ${baseSeen.get(key)}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${baseSeen.size + shardSeen.size} participant profiles including JSON shards.`);
