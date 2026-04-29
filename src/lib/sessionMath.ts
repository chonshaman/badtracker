import type { PlayerBill, RosterEntry, Session, User } from "../types";

export function calculateFee(input: {
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
}): number {
  const maxMatches = input.totalCourtTime / input.matchDuration;
  if (!Number.isFinite(maxMatches) || maxMatches <= 0 || input.shuttlesPerTube <= 0) {
    return 0;
  }

  const courtCostPerMatch = input.courtPrice / maxMatches;
  const shuttleCostPerMatch = input.shuttlePrice / input.shuttlesPerTube;
  return Math.ceil((courtCostPerMatch + shuttleCostPerMatch) / 2);
}

export function maxMatches(session: Session): number {
  return session.totalCourtTime / session.matchDuration;
}

export function playerBills(args: {
  session: Session;
  users: User[];
  roster: RosterEntry[];
  matches: { playerAId: string; playerBId: string; sessionId: string }[];
}): PlayerBill[] {
  const groupedEntries = new Map<string, { user: User; entries: RosterEntry[]; userIds: string[] }>();

  args.roster
    .filter((entry) => entry.sessionId === args.session.id)
    .forEach((entry) => {
      const user = args.users.find((candidate) => candidate.id === entry.userId);
      if (!user) return;
      const key = user.name.trim().toLowerCase();
      const existing = groupedEntries.get(key);
      if (existing) {
        existing.entries.push(entry);
        existing.userIds.push(user.id);
        return;
      }
      groupedEntries.set(key, { user, entries: [entry], userIds: [user.id] });
    });

  return Array.from(groupedEntries.values())
    .map(({ user, entries, userIds }) => {
      const uniqueUserIds = Array.from(new Set(userIds));
      const matchesPlayed = args.matches.filter(
        (match) =>
          match.sessionId === args.session.id &&
          (uniqueUserIds.includes(match.playerAId) || uniqueUserIds.includes(match.playerBId)),
      ).length;
      return {
        user,
        userIds: uniqueUserIds,
        matchesPlayed,
        totalDue: matchesPlayed * args.session.feePerPerson,
        paid: entries.every((entry) => entry.paid),
      };
    })
    .sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.user.name.localeCompare(b.user.name));
}
