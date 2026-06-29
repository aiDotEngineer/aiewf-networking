import { readFileSync } from "node:fs";
import { join } from "node:path";

const queuePath = join(process.cwd(), "tmp/participant-profile-research-queue.json");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const positional = [];
const options = new Map();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith("--")) {
    options.set(arg.slice(2), args[index + 1]);
    index += 1;
  } else {
    positional.push(arg);
  }
}

const start = Number(options.get("start") ?? positional[0] ?? 0);
const shardSize = Number(options.get("shard-size") ?? positional[1] ?? 5);
const shardCount = Number(options.get("shard-count") ?? options.get("count") ?? positional[2] ?? 4);
const queue = JSON.parse(readFileSync(queuePath, "utf8"));

for (let shard = 0; shard < shardCount; shard += 1) {
  const rows = queue.slice(start + shard * shardSize, start + (shard + 1) * shardSize);
  console.log(`\n--- SHARD ${shard + 1} ---`);
  console.log(
    [
      "Research participant profile shard for /Users/swyx/Work/aiewf-networking.",
      "Do not edit files. Return JSON array only, no prose outside JSON.",
      "IMPORTANT: sources.primary and sources.secondary must be arrays of objects {label,url,note}, not URL strings.",
      "Shape each item as StaticParticipantProfile: lookupKey, displayName, headline, company, title, location, tags, confidence, confidenceNote, participantApproved:false, aiGenerated:true, lastResearchedAt:\"2026-06-29\", bioMarkdown, sources:{primary:[], secondary:[]}.",
      "Use primary socials/blogs/company/speaker pages first, then high-signal secondary sources. No raw email addresses. Keep bios terse and professionally useful for attendee matchmaking. Low/medium confidence if evidence is weak.",
      `Participants: ${rows
        .map(
          (row, index) =>
            `${index + 1}) lookupKey ${row.lookupKey}, ${row.displayName}, ${row.title}, ${row.company}${row.city || row.country ? `, ${[row.city, row.country].filter(Boolean).join(" ")}` : ""}.`,
        )
        .join(" ")}`,
    ].join(" "),
  );
}
