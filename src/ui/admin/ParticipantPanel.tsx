import { useEffect, useRef, useState } from "react";
import { formatVnd } from "../../lib/money";
import { activeRosterCount, casualUnitPrice, courtSharePerPlayer, playerBills } from "../../lib/sessionMath";
import { getSessionBills } from "../../lib/selectors";
import type { Match, Session, TrackerState, User } from "../../types";
import { ChevronDown, ChevronUp, Plus, RefreshIcon, Trash2 } from "../icons";
import { MatchSummaryCard } from "../MatchSummaryCard";

type Store = ReturnType<typeof import("../../lib/store").useTrackerStore>;

export function ParticipantPanel({
  session,
  store,
  sessionMatches,
  isHost,
  currentPlayerId,
  highlightMatchId,
  onPendingRemovalIdsChange,
}: {
  session: Session;
  store: Store;
  sessionMatches: Match[];
  isHost: boolean;
  currentPlayerId?: string;
  highlightMatchId?: string;
  onPendingRemovalIdsChange?: (userIds: string[]) => void;
}) {
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [isParticipantRefreshCoolingDown, setIsParticipantRefreshCoolingDown] = useState(false);
  const [pendingRemovedPlayerIds, setPendingRemovedPlayerIds] = useState<string[]>([]);
  const [collapsingRemovedPlayerIds, setCollapsingRemovedPlayerIds] = useState<string[]>([]);
  const removePlayerTimersRef = useRef<Record<string, number>>({});
  const collapsePlayerTimersRef = useRef<Record<string, number>>({});
  const autoExpandedPlayerRef = useRef<string | undefined>(undefined);
  const playerBillsForSession = getSessionBills(store.state, session);
  const statsRoster = pendingRemovedPlayerIds.length > 0
    ? store.state.roster.filter(
        (entry) => !(entry.sessionId === session.id && pendingRemovedPlayerIds.includes(entry.userId)),
      )
    : store.state.roster;
  const activeCount = activeRosterCount(statsRoster, session.id);
  const courtShare = courtSharePerPlayer(session, statsRoster);
  const fixedPricePerMatch = casualUnitPrice(session, store.state.matches, statsRoster);
  const duplicateRosterNames = duplicateSessionRosterNames(session.id, store.state);

  useEffect(
    () => () => {
      Object.values(removePlayerTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      Object.values(collapsePlayerTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    },
    [],
  );

  useEffect(() => {
    onPendingRemovalIdsChange?.(pendingRemovedPlayerIds);
  }, [onPendingRemovalIdsChange, pendingRemovedPlayerIds]);

  useEffect(() => {
    if (!currentPlayerId) return;
    if (autoExpandedPlayerRef.current === currentPlayerId) return;
    const currentBill = playerBillsForSession.find((bill) => bill.userIds.includes(currentPlayerId));
    if (currentBill) {
      setExpandedPlayerId(currentBill.user.id);
      autoExpandedPlayerRef.current = currentPlayerId;
    }
  }, [currentPlayerId, playerBillsForSession]);

  useEffect(() => {
    if (!highlightMatchId) return;
    const timeoutId = window.setTimeout(() => {
      document.getElementById(`match-history-${highlightMatchId}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [highlightMatchId, expandedPlayerId]);

  function addParticipant() {
    const trimmed = participantName.trim();
    if (!trimmed) return;
    const existingUser = store.state.users.find(
      (user) => user.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    const user: User = existingUser ?? {
      id: `u-${crypto.randomUUID()}`,
      name: trimmed,
      role: "Player",
      type: "Temp",
    };
    store.joinSessionGuest(user, session.id);
    setParticipantName("");
  }

  async function refreshParticipants() {
    if (!store.isRemoteEnabled || store.isSyncing || isParticipantRefreshCoolingDown) return;
    setIsParticipantRefreshCoolingDown(true);
    await store.refreshRemoteNow();
    window.setTimeout(() => setIsParticipantRefreshCoolingDown(false), 3500);
  }

  function scheduleRemovePlayer(userId: string) {
    const bill = playerBillsForSession.find((candidate) => candidate.user.id === userId);
    if (bill?.isHost || pendingRemovedPlayerIds.includes(userId)) return;
    setPendingRemovedPlayerIds((current) => [...current, userId]);
    removePlayerTimersRef.current[userId] = window.setTimeout(() => {
      delete removePlayerTimersRef.current[userId];
      setCollapsingRemovedPlayerIds((current) => [...current, userId]);
      collapsePlayerTimersRef.current[userId] = window.setTimeout(() => {
        store.removeSessionPlayer(session.id, userId);
        setPendingRemovedPlayerIds((current) => current.filter((id) => id !== userId));
        setCollapsingRemovedPlayerIds((current) => current.filter((id) => id !== userId));
        delete collapsePlayerTimersRef.current[userId];
      }, 240);
    }, 5000);
  }

  function undoRemovePlayer(userId: string) {
    const timerId = removePlayerTimersRef.current[userId];
    if (timerId) window.clearTimeout(timerId);
    const collapseTimerId = collapsePlayerTimersRef.current[userId];
    if (collapseTimerId) window.clearTimeout(collapseTimerId);
    delete removePlayerTimersRef.current[userId];
    delete collapsePlayerTimersRef.current[userId];
    setPendingRemovedPlayerIds((current) => current.filter((id) => id !== userId));
    setCollapsingRemovedPlayerIds((current) => current.filter((id) => id !== userId));
  }

  return (
    <div className="table-card leaderboard-card">
      <div className="leaderboard-header">
        <h3>Participants</h3>
        <button
          type="button"
          className="participant-refresh-button"
          onClick={refreshParticipants}
          disabled={!store.isRemoteEnabled || store.isSyncing || isParticipantRefreshCoolingDown}
          aria-label="Refresh participants from database"
          title={store.isRemoteEnabled ? "Refresh participants" : "Database sync is not enabled"}
        >
          <RefreshIcon size={15} />
        </button>
        <div className="participant-stats">
          <span>{activeCount} present</span>
          <span className="participant-share-stat" title={formatVnd(session.billingMethod === "casual" ? fixedPricePerMatch : courtShare)}>
            {session.billingMethod === "casual" ? "Casual (Pooled/Proportional)" : "Standard (Fixed Court + Cock/Match)"}
          </span>
        </div>
      </div>
      {duplicateRosterNames.length > 0 ? (
        <p className="form-error duplicate-roster-warning">
          Duplicate player names in this session: {duplicateRosterNames.join(", ")}. Rename or remove duplicates to avoid merged bills.
        </p>
      ) : null}
      {isHost ? (
        <form
          className="participant-add-row"
          onSubmit={(event) => {
            event.preventDefault();
            addParticipant();
          }}
        >
          <input
            value={participantName}
            onChange={(event) => setParticipantName(event.target.value)}
            placeholder="Add player name"
          />
          <button type="submit" className="secondary-button">
            <Plus size={18} /> Add
          </button>
        </form>
      ) : null}
      {playerBillsForSession.map((bill) => {
        const isPendingRemoval = pendingRemovedPlayerIds.includes(bill.user.id);
        const isCollapsingRemoval = collapsingRemovedPlayerIds.includes(bill.user.id);
        const isCurrentPlayer = Boolean(currentPlayerId && bill.userIds.includes(currentPlayerId));
        return (
          <div
            className={[
              "leaderboard-player",
              bill.isPresent ? "" : "not-present",
              isCurrentPlayer ? "current-player" : "",
              expandedPlayerId === bill.user.id ? "is-expanded" : "",
              isPendingRemoval ? "pending-removal" : "",
              isCollapsingRemoval ? "collapsing-removal" : "",
            ].filter(Boolean).join(" ")}
            key={bill.user.id}
          >
            {isPendingRemoval ? (
              <div className="participant-remove-notice">
                <span>{bill.user.name} has removed.</span>
                <button type="button" onClick={() => undoRemovePlayer(bill.user.id)}>
                  Undo
                </button>
              </div>
            ) : (
              <div
                className="leader-row"
                role="button"
                tabIndex={0}
                onClick={() =>
                  setExpandedPlayerId((current) => (current === bill.user.id ? null : bill.user.id))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedPlayerId((current) => (current === bill.user.id ? null : bill.user.id));
                  }
                }}
              >
                <div className="leader-player-copy">
                  <div className="leader-name-line">
                    <strong>{bill.user.name}</strong>
                    {isCurrentPlayer ? <span className="you-badge">(You)</span> : null}
                    {bill.isHost ? <span className="host-badge">Host</span> : null}
                  </div>
                  <span>
                    {bill.isPresent ? "" : "No-show - "}
                    {bill.matchesPlayed} matches - <strong className="leader-row-amount">{formatVnd(bill.totalDue)}</strong>
                  </span>
                </div>
                {isHost ? (
                  <div className="bill-toggles" onClick={(event) => event.stopPropagation()}>
                    <label className="paid-toggle">
                      <input
                        type="checkbox"
                        checked={bill.isPresent}
                        onChange={() => store.togglePresent(session.id, bill.user.id)}
                      />
                      <span className="toggle-dot" aria-hidden="true" />
                      Present
                    </label>
                    <label className="paid-toggle">
                      <input
                        type="checkbox"
                        checked={bill.paid}
                        onChange={() => store.togglePaid(session.id, bill.user.id)}
                      />
                      <span className="toggle-dot" aria-hidden="true" />
                      Paid
                    </label>
                    <button
                      type="button"
                      className="delete-player-button"
                      aria-label={`Delete ${bill.user.name} from session`}
                      disabled={bill.isHost}
                      title={bill.isHost ? "Host cannot be removed" : undefined}
                      onClick={() => scheduleRemovePlayer(bill.user.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ) : null}
                {expandedPlayerId === bill.user.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
            )}
            {!isPendingRemoval && expandedPlayerId === bill.user.id ? (
              <PlayerMatchHistory
                matches={sessionMatches}
                state={store.state}
                session={session}
                playerId={bill.user.id}
                highlightMatchId={highlightMatchId}
                canManageStake={isHost && session.status === "Active"}
                onToggleStake={store.toggleMatchStake}
                onDeleteMatch={isHost ? store.deleteMatch : undefined}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PlayerMatchHistory({
  matches,
  state,
  session,
  playerId,
  highlightMatchId,
  canManageStake,
  onToggleStake,
  onDeleteMatch,
}: {
  matches: Match[];
  state: TrackerState;
  session: Session;
  playerId: string;
  highlightMatchId?: string;
  canManageStake: boolean;
  onToggleStake: (matchId: string) => void;
  onDeleteMatch?: (matchId: string) => void;
}) {
  const player = state.users.find((user) => user.id === playerId);
  const playerMatches = matches.filter(
    (match) => match.playerAId === playerId || match.playerBId === playerId,
  );

  if (!player) return null;

  return (
    <div className="player-history">
      {playerMatches.length === 0 ? (
        <p className="empty-state">No matches recorded for this player.</p>
      ) : (
        playerMatches.map((match, index) => {
          const opponentId = match.playerAId === player.id ? match.playerBId : match.playerAId;
          const opponent = state.users.find((user) => user.id === opponentId);
          return (
            <RemovableMatchHistoryCard
              match={match}
              number={playerMatches.length - index}
              sessionName={sessionTitle(session)}
              currentPlayerId={player.id}
              currentPlayerName={player.name}
              opponentName={opponent?.name ?? "Opponent"}
              isCurrentPlayerHost={isSessionHost(state.roster, session.id, player.id)}
              isOpponentHost={opponent ? isSessionHost(state.roster, session.id, opponent.id) : false}
              showSessionName={false}
              canToggleStake={canManageStake}
              onToggleStake={() => onToggleStake(match.id)}
              onDelete={onDeleteMatch ? () => onDeleteMatch(match.id) : undefined}
              id={`match-history-${match.id}`}
              key={match.id}
              isHighlighted={highlightMatchId === match.id}
            />
          );
        })
      )}
    </div>
  );
}

function RemovableMatchHistoryCard({
  match,
  number,
  sessionName,
  currentPlayerId,
  currentPlayerName,
  opponentName,
  isCurrentPlayerHost,
  isOpponentHost,
  showSessionName,
  canToggleStake,
  onToggleStake,
  onDelete,
  id,
  isHighlighted,
}: {
  match: Match;
  number: number;
  sessionName: string;
  currentPlayerId: string;
  currentPlayerName: string;
  opponentName: string;
  isCurrentPlayerHost?: boolean;
  isOpponentHost?: boolean;
  showSessionName?: boolean;
  canToggleStake: boolean;
  onToggleStake: () => void;
  onDelete?: () => void;
  id?: string;
  isHighlighted?: boolean;
}) {
  const [isPendingRemoval, setIsPendingRemoval] = useState(false);
  const [isCollapsingRemoval, setIsCollapsingRemoval] = useState(false);
  const removeTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current);
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    },
    [],
  );

  function scheduleRemoveMatch() {
    if (!onDelete || isPendingRemoval) return;
    setIsPendingRemoval(true);
    removeTimerRef.current = window.setTimeout(() => {
      removeTimerRef.current = null;
      setIsCollapsingRemoval(true);
      collapseTimerRef.current = window.setTimeout(() => {
        onDelete();
        collapseTimerRef.current = null;
      }, 240);
    }, 5000);
  }

  function undoRemoveMatch() {
    if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current);
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    removeTimerRef.current = null;
    collapseTimerRef.current = null;
    setIsPendingRemoval(false);
    setIsCollapsingRemoval(false);
  }

  return (
    <div
      className={[
        "match-history-card-shell",
        isPendingRemoval ? "pending-removal" : "",
        isCollapsingRemoval ? "collapsing-removal" : "",
      ].filter(Boolean).join(" ")}
    >
      {isPendingRemoval ? (
        <div className="participant-remove-notice match-remove-notice">
          <span>Match #{number} has removed.</span>
          <button type="button" onClick={undoRemoveMatch}>
            Undo
          </button>
        </div>
      ) : (
        <MatchSummaryCard
          match={match}
          number={number}
          sessionName={sessionName}
          currentPlayerId={currentPlayerId}
          currentPlayerName={currentPlayerName}
          opponentName={opponentName}
          isCurrentPlayerHost={isCurrentPlayerHost}
          isOpponentHost={isOpponentHost}
          showSessionName={showSessionName}
          canToggleStake={canToggleStake}
          onToggleStake={onToggleStake}
          onDelete={onDelete ? scheduleRemoveMatch : undefined}
          id={id}
          isHighlighted={isHighlighted}
        />
      )}
    </div>
  );
}

function sessionTitle(session: Session): string {
  return session.name?.trim() || session.date;
}

function isSessionHost(roster: { sessionId: string; userId: string; isHost?: boolean }[], sessionId: string, userId: string): boolean {
  return roster.some((entry) => entry.sessionId === sessionId && entry.userId === userId && entry.isHost);
}

function duplicateSessionRosterNames(sessionId: string, state: TrackerState): string[] {
  const counts = new Map<string, number>();
  state.roster
    .filter((entry) => entry.sessionId === sessionId)
    .forEach((entry) => {
      const user = state.users.find((candidate) => candidate.id === entry.userId);
      const normalized = user?.name.trim().toLowerCase();
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    });

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
}
