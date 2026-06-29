import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const csvPath = join(root, "networkingdata.csv");
const profileDataPath = join(root, "src/lib/participant-profile-data.ts");
const profileShardDir = join(root, "content/participant-profile-shards");
const skiplistPath = join(root, "content/participant-profile-skiplist.json");
const outputDir = join(root, "tmp");
const jsonOutputPath = join(outputDir, "participant-profile-research-queue.json");
const csvOutputPath = join(outputDir, "participant-profile-research-queue.csv");

const missingValues = new Set(["", "n/a", "na", "none", "null"]);

function clean(value) {
  const trimmed = String(value ?? "").trim();
  return missingValues.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function coalesce(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsFromCsv(text) {
  const [headers, ...records] = parseCsv(text);
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])),
  );
}

function profileLookupKey(value) {
  let hash = 0x811c9dc5;
  for (const char of value.trim().toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

function researchedLookupKeys() {
  const data = readFileSync(profileDataPath, "utf8");
  const keys = new Set([...data.matchAll(/lookupKey:\s*"([^"]+)"/g)].map((match) => match[1]));
  for (const filename of readdirSync(profileShardDir).filter((file) => file.endsWith(".json"))) {
    const profiles = JSON.parse(readFileSync(join(profileShardDir, filename), "utf8"));
    for (const profile of profiles) {
      if (profile.lookupKey) keys.add(profile.lookupKey);
    }
  }
  return keys;
}

function skippedLookupKeys() {
  try {
    const rows = JSON.parse(readFileSync(skiplistPath, "utf8"));
    if (!Array.isArray(rows)) return new Set();
    return new Set(rows.map((row) => row.lookupKey).filter(Boolean));
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const researched = researchedLookupKeys();
const skipped = skippedLookupKeys();
const seen = new Set();
const queue = rowsFromCsv(readFileSync(csvPath, "utf8"))
  .map((row) => {
    const email = coalesce(row["Holder Email"], row.Email, row["Buyer Email"]).toLowerCase();
    const firstName = coalesce(row["First Name"], row["Buyer First Name"], row["Holder First Name"]);
    const lastName = coalesce(row["Last Name"], row["Buyer Last Name"], row["Holder Last Name"]);
    const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const company = coalesce(row.Company, row["Holder Company Name"]);
    const title = coalesce(row.Title, row["Holder Job Title"]);
    const lookupKey = profileLookupKey(email);
    return {
      lookupKey,
      email,
      displayName,
      title,
      company,
      ticketType: clean(row["Ticket Type"]),
      city: clean(row["Holder City"]),
      country: clean(row["Holder Country"]),
      profileComplete: Boolean(displayName && title && company),
      searchQuery: [displayName, title, company].filter(Boolean).join(" "),
    };
  })
  .filter((participant) => {
    if (!participant.email || seen.has(participant.email)) return false;
    seen.add(participant.email);
    return participant.profileComplete && !researched.has(participant.lookupKey) && !skipped.has(participant.lookupKey);
  })
  .sort((a, b) => a.displayName.localeCompare(b.displayName));

mkdirSync(outputDir, { recursive: true });
writeFileSync(jsonOutputPath, `${JSON.stringify(queue, null, 2)}\n`);
writeFileSync(
  csvOutputPath,
  [
    ["lookupKey", "displayName", "title", "company", "ticketType", "city", "country", "searchQuery"],
    ...queue.map((participant) => [
      participant.lookupKey,
      participant.displayName,
      participant.title,
      participant.company,
      participant.ticketType,
      participant.city,
      participant.country,
      participant.searchQuery,
    ]),
  ]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n") + "\n",
);

console.log(
  JSON.stringify(
    {
      queued: queue.length,
      researched: researched.size,
      skipped: skipped.size,
      jsonOutputPath,
      csvOutputPath,
      firstFive: queue.slice(0, 5),
    },
    null,
    2,
  ),
);
