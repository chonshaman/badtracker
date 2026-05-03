import { casualUnitPrice, courtSharePerPlayer, playerBills, shuttleFeePerMatch } from "./sessionMath";
import type { Match, PlayerBill, RosterEntry, Session, TrackerState } from "../types";

export function getSessionMatches(state: TrackerState, sessionId: string): Match[] {
  return state.matches.filter((match) => match.sessionId === sessionId);
}

export function getSessionBills(
  state: TrackerState,
  session: Session,
  roster: RosterEntry[] = state.roster,
): PlayerBill[] {
  return playerBills({
    session,
    users: state.users,
    roster,
    matches: state.matches,
  });
}

export function getUserBillForSession(
  state: TrackerState,
  session: Session,
  userId: string,
  roster: RosterEntry[] = state.roster,
): PlayerBill | undefined {
  return getSessionBills(state, session, roster).find((bill) => bill.userIds.includes(userId));
}

export function getSessionCollected(
  state: TrackerState,
  session: Session,
  roster: RosterEntry[] = state.roster,
): number {
  return getSessionBills(state, session, roster)
    .filter((bill) => bill.paid)
    .reduce((sum, bill) => sum + bill.totalDue, 0);
}

export function getSessionTotalDue(
  state: TrackerState,
  session: Session,
  roster: RosterEntry[] = state.roster,
): number {
  return getSessionBills(state, session, roster).reduce((sum, bill) => sum + bill.totalDue, 0);
}

export function getPlayerFeeMetric(
  state: TrackerState,
  session: Session,
  roster: RosterEntry[] = state.roster,
): number {
  return session.billingMethod === "casual"
    ? casualUnitPrice(session, state.matches, roster)
    : courtSharePerPlayer(session, roster);
}

export function getBillingSummaryText(
  state: TrackerState,
  session: Session,
  roster: RosterEntry[] = state.roster,
): string {
  if (session.billingMethod === "casual") {
    return `Fee/match: ${formatMoneyForSummary(casualUnitPrice(session, state.matches, roster))}`;
  }
  return `Court share: ${formatMoneyForSummary(courtSharePerPlayer(session, roster))} + Shuttle/match: ${formatMoneyForSummary(shuttleFeePerMatch(session))}`;
}

function formatMoneyForSummary(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value) + " ₫";
}
