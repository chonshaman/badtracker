import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playerBills } from "../.test-dist/lib/sessionMath.js";

const session = {
  id: "session-1",
  slug: "smash-tracker",
  date: "2026-05-01",
  courtPrice: 120000,
  shuttlePrice: 20000,
  shuttlesPerTube: 1,
  matchDuration: 20,
  totalCourtTime: 120,
  billingMethod: "standard",
  status: "Active",
  createdAt: "2026-05-01T10:00:00.000Z",
};

describe("playerBills identity handling", () => {
  it("does not merge players with identical display names", () => {
    const users = [
      { id: "u-minh-1", name: "Minh", role: "Player", type: "Regular" },
      { id: "u-minh-2", name: "Minh", role: "Player", type: "Temp" },
      { id: "u-hung", name: "Hung", role: "Player", type: "Regular" },
    ];
    const roster = users.map((user) => ({
      sessionId: session.id,
      userId: user.id,
      paid: false,
      isPresent: true,
      isHost: false,
    }));
    const matches = [
      {
        id: "match-1",
        sessionId: session.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-minh-1",
        playerBId: "u-hung",
        isStake: false,
        status: "Valid",
      },
    ];

    const bills = playerBills({ session, users, roster, matches });
    const minhBills = bills.filter((bill) => bill.user.name === "Minh");

    assert.equal(minhBills.length, 2);
    assert.deepEqual(
      minhBills.map((bill) => ({ userIds: bill.userIds, matchesPlayed: bill.matchesPlayed })),
      [
        { userIds: ["u-minh-1"], matchesPlayed: 1 },
        { userIds: ["u-minh-2"], matchesPlayed: 0 },
      ],
    );
  });
});
