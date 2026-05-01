import type { PlayerBill, RosterEntry, Session, User } from "../types";

export function maxMatches(session: Session): number {
  return session.totalCourtTime / session.matchDuration;
}

export function shuttleFeePerMatch(session: Session): number {
  if (session.shuttlesPerTube <= 0) return 0;
  return session.shuttlePrice / session.shuttlesPerTube;
}

function matchParticipantCount() {
  return 2;
}

function sessionMatches(
  session: Session,
  matches: { playerAId: string; playerBId: string; sessionId: string; score?: string; isStake?: boolean; winnerId?: string }[],
) {
  return matches.filter((match) => match.sessionId === session.id);
}

export function casualUnitPrice(
  session: Session,
  matches: { playerAId: string; playerBId: string; sessionId: string; score?: string; isStake?: boolean; winnerId?: string }[],
): number {
  const loggedMatches = sessionMatches(session, matches);
  const totalIndividualPlays = loggedMatches.reduce((total) => total + matchParticipantCount(), 0);
  if (totalIndividualPlays <= 0) return 0;
  const totalExpenses = session.courtPrice + loggedMatches.length * shuttleFeePerMatch(session);
  return totalExpenses / totalIndividualPlays;
}

function playerShuttleShareForMatch(
  session: Session,
  match: { playerAId: string; playerBId: string; score?: string; isStake?: boolean; winnerId?: string },
  userIds: string[],
): number {
  const isPlayerInMatch = userIds.includes(match.playerAId) || userIds.includes(match.playerBId);
  if (!isPlayerInMatch) return 0;

  const matchShuttleCost = shuttleFeePerMatch(session);
  const participantCount = 2;
  if (!match.isStake) return matchShuttleCost / participantCount;

  const winnerId = match.winnerId ?? inferWinnerIdFromScore(match);
  if (!winnerId) return matchShuttleCost / participantCount;
  return userIds.includes(winnerId) ? 0 : matchShuttleCost;
}

function playerCasualShareForMatch(
  unitPrice: number,
  match: { playerAId: string; playerBId: string; score?: string; isStake?: boolean; winnerId?: string },
  userIds: string[],
): number {
  const isPlayerInMatch = userIds.includes(match.playerAId) || userIds.includes(match.playerBId);
  if (!isPlayerInMatch) return 0;
  if (!match.isStake) return unitPrice;

  const winnerId = match.winnerId ?? inferWinnerIdFromScore(match);
  if (!winnerId) return unitPrice;
  return userIds.includes(winnerId) ? 0 : unitPrice * matchParticipantCount();
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
  matches: { playerAId: string; playerBId: string; sessionId: string; score?: string; isStake?: boolean; winnerId?: string }[];
}): PlayerBill[] {
  const groupedEntries = new Map<string, { user: User; entries: RosterEntry[]; userIds: string[] }>();
  const loggedMatches = sessionMatches(args.session, args.matches);
  const isCasualBilling = (args.session.billingMethod ?? "standard") === "casual";
  const casualSharePerPlay = casualUnitPrice(args.session, args.matches);

  args.roster
    .filter((entry) => entry.sessionId === args.session.id)
    .forEach((entry) => {
      const user = args.users.find((candidate) => candidate.id === entry.userId);
      if (!user) return;
      const existing = groupedEntries.get(user.id);
      if (existing) {
        existing.entries.push(entry);
        existing.userIds.push(user.id);
        return;
      }
      groupedEntries.set(user.id, { user, entries: [entry], userIds: [user.id] });
    });

  return Array.from(groupedEntries.values())
    .map(({ user, entries, userIds }) => {
      const uniqueUserIds = Array.from(new Set(userIds));
      const matchesPlayed = loggedMatches.filter(
        (match) =>
          (uniqueUserIds.includes(match.playerAId) || uniqueUserIds.includes(match.playerBId)),
      ).length;
      const isPresent = entries.some((entry) => entry.isPresent);
      const courtShare = isCasualBilling
        ? loggedMatches.reduce((total, match) => total + playerCasualShareForMatch(casualSharePerPlay, match, uniqueUserIds), 0)
        : isPresent
          ? courtSharePerPlayer(args.session, args.roster)
          : 0;
      const shuttleFee = isCasualBilling
        ? 0
        : loggedMatches.reduce((total, match) => {
            if (!uniqueUserIds.includes(match.playerAId) && !uniqueUserIds.includes(match.playerBId)) {
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

function inferWinnerIdFromScore(match: { playerAId: string; playerBId: string; score?: string }): string | undefined {
  if (!match.score) return undefined;
  const [firstScore, secondScore] = match.score.split(/[-:]/).map((value) => Number(value.trim()));
  if (!Number.isFinite(firstScore) || !Number.isFinite(secondScore) || firstScore === secondScore) {
    return undefined;
  }
  return firstScore > secondScore ? match.playerAId : match.playerBId;
}
