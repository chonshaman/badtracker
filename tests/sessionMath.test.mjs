import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { casualUnitPrice, playerBills } from "../.test-dist/lib/sessionMath.js";

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

describe("playerBills stake billing", () => {
  it("charges the lower-score player for both shuttle shares when loser pays all is enabled", () => {
    const users = [
      { id: "u-winner", name: "Winner", role: "Player", type: "Regular" },
      { id: "u-loser", name: "Loser", role: "Player", type: "Regular" },
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
        id: "match-stake",
        sessionId: session.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-winner",
        playerBId: "u-loser",
        score: "21-19",
        isStake: true,
        winnerId: "u-winner",
        status: "Valid",
      },
    ];

    const bills = playerBills({ session, users, roster, matches });
    const winnerBill = bills.find((bill) => bill.user.id === "u-winner");
    const loserBill = bills.find((bill) => bill.user.id === "u-loser");

    assert.equal(winnerBill?.courtShare, 60000);
    assert.equal(winnerBill?.shuttleFee, 0);
    assert.equal(winnerBill?.totalDue, 60000);
    assert.equal(loserBill?.courtShare, 60000);
    assert.equal(loserBill?.shuttleFee, 20000);
    assert.equal(loserBill?.totalDue, 80000);
  });

  it("infers the stake winner from score when older match data is missing winnerId", () => {
    const users = [
      { id: "u-player", name: "Player", role: "Player", type: "Regular" },
      { id: "u-opponent", name: "Opponent", role: "Player", type: "Regular" },
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
        id: "match-stake-fallback",
        sessionId: session.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-player",
        playerBId: "u-opponent",
        score: "17-21",
        isStake: true,
        status: "Valid",
      },
    ];

    const bills = playerBills({ session, users, roster, matches });
    const playerBill = bills.find((bill) => bill.user.id === "u-player");
    const opponentBill = bills.find((bill) => bill.user.id === "u-opponent");

    assert.equal(playerBill?.shuttleFee, 20000);
    assert.equal(opponentBill?.shuttleFee, 0);
  });

  it("applies loser pays all to casual pooled billing", () => {
    const casualSession = { ...session, billingMethod: "casual" };
    const users = [
      { id: "u-winner", name: "Winner", role: "Player", type: "Regular" },
      { id: "u-loser", name: "Loser", role: "Player", type: "Regular" },
    ];
    const roster = users.map((user) => ({
      sessionId: casualSession.id,
      userId: user.id,
      paid: false,
      isPresent: true,
      isHost: false,
    }));
    const matches = [
      {
        id: "match-casual-stake",
        sessionId: casualSession.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-winner",
        playerBId: "u-loser",
        score: "21-19",
        isStake: true,
        winnerId: "u-winner",
        status: "Valid",
      },
    ];

    const bills = playerBills({ session: casualSession, users, roster, matches });
    const winnerBill = bills.find((bill) => bill.user.id === "u-winner");
    const loserBill = bills.find((bill) => bill.user.id === "u-loser");

    assert.equal(winnerBill?.totalDue, 0);
    assert.equal(loserBill?.totalDue, 140000);
  });
});

describe("casual billing present participant scaling", () => {
  it("excludes no-show players from casual proportional bills and recalculates unit price", () => {
    const casualSession = { ...session, billingMethod: "casual" };
    const users = [
      { id: "u-present-a", name: "Present A", role: "Player", type: "Regular" },
      { id: "u-present-b", name: "Present B", role: "Player", type: "Regular" },
      { id: "u-no-show", name: "No Show", role: "Player", type: "Regular" },
    ];
    const roster = [
      { sessionId: casualSession.id, userId: "u-present-a", paid: false, isPresent: true, isHost: false },
      { sessionId: casualSession.id, userId: "u-present-b", paid: false, isPresent: true, isHost: false },
      { sessionId: casualSession.id, userId: "u-no-show", paid: false, isPresent: false, isHost: false },
    ];
    const matches = [
      {
        id: "match-present",
        sessionId: casualSession.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-present-a",
        playerBId: "u-present-b",
        isStake: false,
        status: "Valid",
      },
      {
        id: "match-no-show",
        sessionId: casualSession.id,
        createdAt: "2026-05-01T10:25:00.000Z",
        playerAId: "u-present-a",
        playerBId: "u-no-show",
        isStake: false,
        status: "Valid",
      },
    ];

    const unitPrice = casualUnitPrice(casualSession, matches, roster);
    const bills = playerBills({ session: casualSession, users, roster, matches });
    const presentA = bills.find((bill) => bill.user.id === "u-present-a");
    const presentB = bills.find((bill) => bill.user.id === "u-present-b");
    const noShow = bills.find((bill) => bill.user.id === "u-no-show");

    assert.equal(unitPrice, 160000 / 3);
    assert.equal(presentA?.totalDue, (160000 / 3) * 2);
    assert.equal(presentB?.totalDue, 160000 / 3);
    assert.equal(noShow?.totalDue, 0);
  });

  it("recalculates casual billing when a player is removed from the roster", () => {
    const casualSession = { ...session, billingMethod: "casual" };
    const users = [
      { id: "u-present-a", name: "Present A", role: "Player", type: "Regular" },
      { id: "u-present-b", name: "Present B", role: "Player", type: "Regular" },
      { id: "u-removed", name: "Removed", role: "Player", type: "Regular" },
    ];
    const roster = [
      { sessionId: casualSession.id, userId: "u-present-a", paid: false, isPresent: true, isHost: false },
      { sessionId: casualSession.id, userId: "u-present-b", paid: false, isPresent: true, isHost: false },
    ];
    const matches = [
      {
        id: "match-present",
        sessionId: casualSession.id,
        createdAt: "2026-05-01T10:05:00.000Z",
        playerAId: "u-present-a",
        playerBId: "u-present-b",
        isStake: false,
        status: "Valid",
      },
      {
        id: "match-removed",
        sessionId: casualSession.id,
        createdAt: "2026-05-01T10:25:00.000Z",
        playerAId: "u-present-a",
        playerBId: "u-removed",
        isStake: false,
        status: "Valid",
      },
    ];

    const unitPrice = casualUnitPrice(casualSession, matches, roster);
    const bills = playerBills({ session: casualSession, users, roster, matches });
    const presentA = bills.find((bill) => bill.user.id === "u-present-a");
    const removed = bills.find((bill) => bill.user.id === "u-removed");

    assert.equal(unitPrice, 160000 / 3);
    assert.equal(presentA?.totalDue, (160000 / 3) * 2);
    assert.equal(removed, undefined);
  });
});
