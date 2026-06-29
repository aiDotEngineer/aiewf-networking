import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTIVE_REQUEST_STATUSES,
  canJoinMeetingGroup,
  normalizeParticipantRow,
} from "./networking-rules.ts";

test("normalizes sheet rows into participant profile fields", () => {
  const participant = normalizeParticipantRow({
    "First Name": "Aamir",
    "Last Name": "Shakir",
    Email: "buyer@example.com",
    "Holder Email": "Aamir@MixedBread.ai ",
    "Ticket Type": "AI Leadership (All Access)",
    Company: "N/A",
    "Holder Company Name": "Mixedbread",
    Title: "N/A",
    "Holder Job Title": "Founder",
    "Registration Status": "REGISTERED",
  });

  assert.equal(participant.email, "aamir@mixedbread.ai");
  assert.equal(participant.displayName, "Aamir Shakir");
  assert.equal(participant.company, "Mixedbread");
  assert.equal(participant.title, "Founder");
  assert.equal(participant.ticketType, "AI Leadership (All Access)");
  assert.equal(participant.ticketCategory, "leadership");
  assert.equal(participant.profileComplete, true);
});

test("treats pending, countered, and accepted as active outgoing requests", () => {
  assert.deepEqual(ACTIVE_REQUEST_STATUSES, ["pending", "countered", "accepted"]);
});

test("allows one-to-many groups up to four total participants", () => {
  assert.equal(canJoinMeetingGroup(1), true);
  assert.equal(canJoinMeetingGroup(3), true);
  assert.equal(canJoinMeetingGroup(4), false);
});
