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

export function shuttleFeePerMatch(session: Session): number {
  if (session.shuttlesPerTube <= 0) return 0;
  return session.shuttlePrice / session.shuttlesPerTube;
}

function playerShuttleShareForMatch(
  session: Session,
  match: { playerAId: string; playerBId: string; isStake?: boolean; winnerId?: string },
  userIds: string[],
): number {
  const isPlayerInMatch = userIds.includes(match.playerAId) || userIds.includes(match.playerBId);
  if (!isPlayerInMatch) return 0;

  const matchShuttleCost = shuttleFeePerMatch(session);
  const participantCount = 2;
  if (!match.isStake) return matchShuttleCost / participantCount;

  return match.winnerId && userIds.includes(match.winnerId) ? 0 : matchShuttleCost;
}

export function activeRosterCount(roster: RosterEntry[], sessionId: string): number {
  return roster.filter((entry) => entry.sessionId === sessionId && entry.isPresent).length;
}

export function courtSharePerPlayer(session: Session, roster: RosterEntry[]): number {
  const activeCount = activeRosterCount(roster, session.id);
  return activeCount > 0 ? session.courtPrice / activeCount : 0;
}

export function playerBills(args: {
  session: Session;
  users: User[];
  roster: RosterEntry[];
  matches: { playerAId: string; playerBId: string; sessionId: string; isStake?: boolean; winnerId?: string }[];
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
      const isPresent = entries.some((entry) => entry.isPresent);
      const courtShare = isPresent ? courtSharePerPlayer(args.session, args.roster) : 0;
      const shuttleFee = args.matches.reduce((total, match) => {
        if (
          match.sessionId !== args.session.id ||
          (!uniqueUserIds.includes(match.playerAId) && !uniqueUserIds.includes(match.playerBId))
        ) {
          return total;
        }
        return total + playerShuttleShareForMatch(args.session, match, uniqueUserIds);
      }, 0);
      return {
        user,
        userIds: uniqueUserIds,
        isPresent,
        isHost: entries.some((entry) => entry.isHost),
        courtShare,
        shuttleFee,
        matchesPlayed,
        totalDue: courtShare + shuttleFee,
        paid: entries.every((entry) => entry.paid),
      };
    })
    .sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.user.name.localeCompare(b.user.name));
}
