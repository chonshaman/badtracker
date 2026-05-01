import { Check, ChevronDown, ChevronRight, Plus, ToggleLeft, ToggleRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { formatVnd } from "../lib/money";
import { casualUnitPrice, playerBills, shuttleFeePerMatch } from "../lib/sessionMath";
import type { Match, Session, SessionPublicInfo, TrackerState, User } from "../types";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type PlayerViewProps = {
  slug: string;
  sessionId?: string;
  store: Store;
  activeSession?: Session;
};

export function PlayerView({ slug, sessionId, store, activeSession }: PlayerViewProps) {
  const linkedSession = sessionId ? store.state.sessions.find((session) => session.id === sessionId) : undefined;
  const sessionForPlayer = activeSession ?? linkedSession;
  const playerStorageKey = sessionForPlayer ? `smash-player-${sessionForPlayer.id}` : `smash-player-${slug}`;
  const [playerId, setPlayerId] = useState(() => sessionStorage.getItem(playerStorageKey) ?? "");
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [sessionLinkStatus, setSessionLinkStatus] = useState<"checking" | "active" | "closed" | "missing" | "unknown">(
    sessionId && store.isRemoteEnabled ? "checking" : "unknown",
  );

  useEffect(() => {
    setPlayerId(sessionStorage.getItem(playerStorageKey) ?? "");
  }, [playerStorageKey]);

  useEffect(() => {
    if (playerId) sessionStorage.setItem(playerStorageKey, playerId);
  }, [playerId, playerStorageKey]);

  useEffect(() => {
    if (!sessionId || !store.isRemoteEnabled) {
      setSessionLinkStatus("unknown");
      return;
    }

    let isMounted = true;
    setSessionLinkStatus("checking");
    void store.getSessionLinkStatus(sessionId).then((status) => {
      if (isMounted) setSessionLinkStatus(status);
    });

    return () => {
      isMounted = false;
    };
  }, [sessionId, store.isRemoteEnabled]);

  if (sessionId && store.isRemoteEnabled && sessionLinkStatus === "missing") {
    return (
      <SessionMissingState
        title="Session no longer exists."
        message="This session is no longer in the database. It may have been deleted by the host."
        slug={slug}
      />
    );
  }

  if (!activeSession && linkedSession?.status === "Closed") {
    return (
      <ClosedSessionSummary
        session={linkedSession}
        playerId={playerId}
        onPlayerChange={setPlayerId}
        store={store}
      />
    );
  }

  if (!activeSession) {
    if (store.isRemoteEnabled && store.isSyncing) {
      return (
        <section className="player-empty syncing-state">
          <span className="sync-loader" aria-hidden="true" />
          <p className="eyebrow">Loading session</p>
          <h1>Syncing court.</h1>
          <p>Fetching the shared session from Supabase.</p>
        </section>
      );
    }

    if (store.syncError) {
      return (
        <section className="player-empty">
          <p className="eyebrow">Sync issue</p>
          <h1>Session unavailable.</h1>
          <p>{store.syncError}</p>
          <p>{syncErrorGuidance(store.syncError)}</p>
        </section>
      );
    }

    if (sessionId && store.isRemoteEnabled) {
      if (sessionLinkStatus === "checking") {
        return (
          <section className="player-empty syncing-state">
            <span className="sync-loader" aria-hidden="true" />
            <p className="eyebrow">Checking session</p>
            <h1>Looking up court.</h1>
            <p>Confirming this shared link with Supabase.</p>
          </section>
        );
      }

      return <SessionPinGate sessionId={sessionId} session={linkedSession} store={store} />;
    }

    return (
      <section className="player-empty">
        <p className="eyebrow">Court closed</p>
        <h1>No active session.</h1>
        <p>Ask your host to join a session, or create your own.</p>
        <Link className="primary-button empty-session-action" to={`/${slug}/admin?create=1`}>
          <Plus size={18} /> New session
        </Link>
      </section>
    );
  }

  const rosterIds = store.state.roster
    .filter((entry) => entry.sessionId === activeSession.id)
    .map((entry) => entry.userId);
  const roster = uniqueUsersByName(store.state.users.filter((user) => rosterIds.includes(user.id)));
  const currentUser = roster.find((user) => user.id === playerId);

  if (rosterIds.length > 0 && roster.length === 0) {
    return (
      <section className="player-empty">
        <p className="eyebrow">Roster syncing</p>
        <h1>Loading names.</h1>
        <p>Refreshing the player list from Supabase. If this stays empty, recreate the session after this fix deploys.</p>
      </section>
    );
  }

  if (!currentUser) {
    const addGuest = () => {
      const trimmed = guestName.trim();
      if (!trimmed) return;
      const existingUser = roster.find(
        (user) => user.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (existingUser) {
        setPlayerId(existingUser.id);
        return;
      }

      const guest: User = {
        id: `u-${crypto.randomUUID()}`,
        name: trimmed,
        role: "Player",
        type: "Temp",
      };
      store.joinSessionGuest(guest, activeSession.id);
      setPlayerId(guest.id);
      setGuestName("");
    };

    return (
      <section className="login-card">
        <p className="eyebrow">Active session</p>
        <h1>Who are you?</h1>
        <UserDropdown
          users={roster}
          value={playerId}
          placeholder="Select your name"
          onChange={setPlayerId}
        />
        <button className="primary-button" disabled={!playerId}>
          Enter court
        </button>
        <form
          className="guest-join"
          onSubmit={(event) => {
            event.preventDefault();
            addGuest();
          }}
        >
          <p className="eyebrow">Not on roster?</p>
          <input
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Add guest name"
          />
          <button type="submit" className="secondary-button">
            Add guest and enter
          </button>
        </form>
        <SessionEntryInfo info={sessionEntryInfo(activeSession, store.state)} />
      </section>
    );
  }

  const myMatches = store.state.matches
    .filter(
      (match) =>
        match.sessionId === activeSession.id &&
        (match.playerAId === currentUser.id || match.playerBId === currentUser.id),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeRosterIds = store.state.roster
    .filter((entry) => entry.sessionId === activeSession.id && entry.isPresent)
    .map((entry) => entry.userId);
  const opponents = roster.filter((user) => user.id !== currentUser.id && activeRosterIds.includes(user.id));
  const myBill = playerBills({
    session: activeSession,
    users: store.state.users,
    roster: store.state.roster,
    matches: store.state.matches,
  }).find((bill) => bill.userIds.includes(currentUser.id));
  const courtFee = myBill?.courtShare ?? 0;
  const playerFeeMetric = activeSession.billingMethod === "casual"
    ? casualUnitPrice(activeSession, store.state.matches)
    : courtFee;
  const totalDue = myBill?.totalDue ?? 0;
  const currentUserIds = store.state.users
    .filter((user) => user.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase())
    .map((user) => user.id);
  const joinedSessions = store.state.sessions
    .filter((session) =>
      store.state.roster.some(
        (entry) => entry.sessionId === session.id && currentUserIds.includes(entry.userId),
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestJoinedSession = joinedSessions[0] ?? activeSession;
  const latestShuttleCostPerMatch = shuttleFeePerMatch(latestJoinedSession);
  const playerReturnPath = `/${activeSession.slug}/session/${activeSession.id}`;
  const previousSessions = store.state.sessions
    .filter(
      (session) =>
        session.id !== activeSession.id &&
        store.state.roster.some(
          (entry) => entry.sessionId === session.id && currentUserIds.includes(entry.userId),
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="player-screen">
      <PlayerDebtHeader
        session={latestJoinedSession}
        playerId={currentUser.id}
        playerName={currentUser.name}
        totalDue={totalDue}
        courtFee={courtFee}
        playerFeeMetric={playerFeeMetric}
        shuttleCostPerMatch={latestShuttleCostPerMatch}
        matchesPlayed={myMatches.length}
        backTo={playerReturnPath}
      />

      <section className="opponent-panel">
        <p className="eyebrow">Tap opponent to record</p>
        <div className="opponent-grid">
          {opponents.map((opponent) => (
            <button
              type="button"
              className="opponent-button"
              key={opponent.id}
              onClick={() => setSelectedOpponentId(opponent.id)}
            >
              <span>{opponent.name}</span>
              {isSessionHost(store.state.roster, activeSession.id, opponent.id) ? (
                <span className="host-badge opponent-host-badge">Host</span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="card-feed">
        <h2>My Matches</h2>
        {myMatches.length === 0 ? (
          <p className="empty-state session-row-empty">Your recorded matches will appear here.</p>
        ) : (
          myMatches.map((match, index) => (
            <MatchCard
              key={match.id}
              match={match}
              number={myMatches.length - index}
              session={activeSession}
              currentUser={currentUser}
              users={store.state.users}
            />
          ))
        )}
      </section>

      <PreviousSessions
        currentUserIds={currentUserIds}
        sessions={previousSessions}
        store={store}
        backTo={playerReturnPath}
        playerId={currentUser.id}
      />

      {selectedOpponentId && (
        <RecordMatchModal
          currentUser={currentUser}
          opponents={opponents}
          initialOpponentId={selectedOpponentId}
          onClose={() => setSelectedOpponentId(null)}
          onSubmit={(opponentId, score, isStake, winnerId) => {
            store.addMatch({
              id: `m-${crypto.randomUUID()}`,
              sessionId: activeSession.id,
              createdAt: new Date().toISOString(),
              playerAId: currentUser.id,
              playerBId: opponentId,
              isStake,
              winnerId,
              score,
              status: "Valid",
            });
            setSelectedOpponentId(null);
          }}
        />
      )}
    </div>
  );
}

function SessionMissingState({
  title,
  message,
  slug,
}: {
  title: string;
  message: string;
  slug: string;
}) {
  return (
    <section className="player-empty missing-session-state">
      <p className="eyebrow">Session unavailable</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <Link className="primary-button empty-session-action" to={`/${slug}/admin?create=1`}>
        <Plus size={18} /> New session
      </Link>
    </section>
  );
}

function ClosedSessionSummary({
  session,
  playerId,
  onPlayerChange,
  store,
}: {
  session: Session;
  playerId: string;
  onPlayerChange: (playerId: string) => void;
  store: Store;
}) {
  const rosterIds = store.state.roster
    .filter((entry) => entry.sessionId === session.id)
    .map((entry) => entry.userId);
  const roster = uniqueUsersByName(store.state.users.filter((user) => rosterIds.includes(user.id)));
  const currentUser = roster.find((user) => user.id === playerId);
  const bill = currentUser
    ? playerBills({
        session,
        users: store.state.users,
        roster: store.state.roster,
        matches: store.state.matches,
      }).find((candidate) => candidate.userIds.includes(currentUser.id))
    : undefined;
  const playerFeeMetric = session.billingMethod === "casual"
    ? casualUnitPrice(session, store.state.matches)
    : bill?.courtShare ?? 0;

  return (
    <section className="player-empty closed-session-summary">
      <p className="eyebrow">Session closed</p>
      <h1>{currentUser ? formatVnd(bill?.totalDue ?? 0) : "Final report ready."}</h1>
      {currentUser ? (
        <div className="closed-session-meta">
          <span>Hi, {currentUser.name}</span>
          <span>{bill?.matchesPlayed ?? 0} {(bill?.matchesPlayed ?? 0) === 1 ? "match" : "matches"} played</span>
          <span>{playerFeeLabel(session)}: {formatVnd(playerFeeMetric)}</span>
        </div>
      ) : roster.length > 0 ? (
        <UserDropdown
          users={roster}
          value={playerId}
          placeholder="Select your name"
          onChange={onPlayerChange}
        />
      ) : (
        <p>This session has ended. The final report is still available.</p>
      )}
      <Link className="primary-button" to={`/${session.slug}/admin/${session.id}`} state={{ backTo: `/${session.slug}`, playerId }}>
        View report
      </Link>
    </section>
  );
}

function PlayerDebtHeader({
  session,
  playerId,
  playerName,
  totalDue,
  courtFee,
  playerFeeMetric,
  shuttleCostPerMatch,
  matchesPlayed,
  backTo,
}: {
  session: Session;
  playerId: string;
  playerName: string;
  totalDue: number;
  courtFee: number;
  playerFeeMetric: number;
  shuttleCostPerMatch: number;
  matchesPlayed: number;
  backTo: string;
}) {
  const previousTotalDue = useRef(totalDue);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (previousTotalDue.current === totalDue) return;
    setFlash(totalDue > previousTotalDue.current ? "up" : "down");
    previousTotalDue.current = totalDue;
    const timeoutId = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timeoutId);
  }, [totalDue]);

  return (
    <header className={`sticky-player-header debt-header ${flash ? `debt-flash-${flash}` : ""}`}>
      <div className="player-card-greeting">
        <p>Hi, {playerName}</p>
        <span>{matchesPlayed} {matchesPlayed === 1 ? "match" : "matches"} played</span>
      </div>
      <h1>{formatVnd(totalDue)}</h1>
      <div className="debt-breakdown" aria-label="Debt breakdown">
        <span>{playerFeeLabel(session)}: {formatVnd(playerFeeMetric)}</span>
        <span>Shuttle cost: {formatVnd(shuttleCostPerMatch)}</span>
      </div>
      <Link className="session-detail-link" to={`/${session.slug}/admin/${session.id}`} state={{ backTo, playerId }}>
        <span>
          <strong>{sessionTitle(session)}</strong>
          <small>{session.date}</small>
        </span>
        <ChevronRight size={18} />
      </Link>
    </header>
  );
}

function PreviousSessions({
  currentUserIds,
  sessions,
  store,
  backTo,
  playerId,
}: {
  currentUserIds: string[];
  sessions: Session[];
  store: Store;
  backTo: string;
  playerId: string;
}) {
  if (sessions.length === 0) return null;

  return (
    <section className="previous-sessions">
      <h2>Previous sessions</h2>
      {sessions.map((session) => {
        const bill = playerBills({
          session,
          users: store.state.users,
          roster: store.state.roster,
          matches: store.state.matches,
        }).find((candidate) => candidate.userIds.some((userId) => currentUserIds.includes(userId)));

        return (
          <Link className="previous-session-card" key={session.id} to={`/${session.slug}/admin/${session.id}`} state={{ backTo, playerId }}>
            <div>
              <strong>{sessionTitle(session)}</strong>
              <span>{session.date}</span>
            </div>
            <div>
              <strong>{formatVnd(bill?.totalDue ?? 0)}</strong>
              <span>{bill?.matchesPlayed ?? 0} matches</span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

function RecordMatchModal({
  currentUser,
  opponents,
  initialOpponentId,
  onClose,
  onSubmit,
}: {
  currentUser: User;
  opponents: User[];
  initialOpponentId: string;
  onClose: () => void;
  onSubmit: (opponentId: string, score: string | undefined, isStake: boolean, winnerId?: string) => void;
}) {
  const [opponentId, setOpponentId] = useState(initialOpponentId);
  const [score, setScore] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpponentListOpen, setIsOpponentListOpen] = useState(false);
  const [isStake, setIsStake] = useState(false);
  const submitLock = useRef(false);
  const opponentDropdownRef = useRef<HTMLDivElement>(null);
  const scoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpponentListOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!opponentDropdownRef.current?.contains(event.target as Node)) {
        setIsOpponentListOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpponentListOpen]);

  useEffect(() => {
    scoreInputRef.current?.focus();
  }, []);

  function handleSubmit() {
    if (!opponentId || submitLock.current) return;
    if (isStake && !inferredWinnerId) return;
    submitLock.current = true;
    setIsSubmitting(true);
    onSubmit(opponentId, normalizeScore(score), isStake, isStake ? inferredWinnerId : undefined);
  }

  function updateScore(value: string) {
    setScore(formatScoreInput(value));
  }

  const selectedOpponent = opponents.find((opponent) => opponent.id === opponentId);
  const scoreResult = readScoreResult(score);
  const inferredWinnerId = scoreResult
    ? scoreResult.playerWon
      ? currentUser.id
      : selectedOpponent?.id
    : undefined;
  const stakeCaption = scoreResult ? (
    scoreResult.playerWon ? (
      <>
        {scoreResult.formattedScore}:{" "}
        <span className="stake-caption-win">{currentUser.name} (You) wins</span>
        {", "}
        <span className="stake-caption-loss">{selectedOpponent?.name ?? "Opponent"} loses.</span>
      </>
    ) : (
      <>
        {scoreResult.formattedScore}:{" "}
        <span className="stake-caption-loss">{currentUser.name} (You) loses</span>
        {", "}
        <span className="stake-caption-win">{selectedOpponent?.name ?? "Opponent"} wins.</span>
      </>
    )
  ) : null;

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Record match">
      <form
        className="match-modal"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <button type="button" className="close-button" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <p className="eyebrow">New match</p>
        <h2>{currentUser.name} vs {selectedOpponent?.name}</h2>
        <div className="custom-select" ref={opponentDropdownRef}>
          <button
            type="button"
            className="custom-select-trigger"
            aria-haspopup="listbox"
            aria-expanded={isOpponentListOpen}
            onClick={() => setIsOpponentListOpen((current) => !current)}
          >
            <span>{selectedOpponent?.name ?? "Select opponent"}</span>
            <ChevronDown size={18} />
          </button>
          {isOpponentListOpen ? (
            <div className="custom-select-menu" role="listbox" aria-label="Opponent">
              {opponents.map((opponent) => {
                const isSelected = opponent.id === opponentId;
                return (
                  <button
                    type="button"
                    className={isSelected ? "custom-select-option selected" : "custom-select-option"}
                    key={opponent.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setOpponentId(opponent.id);
                      setIsOpponentListOpen(false);
                    }}
                  >
                    <span>{opponent.name}</span>
                    {isSelected ? <Check size={17} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <label>
          Score
          <input
            ref={scoreInputRef}
            inputMode="numeric"
            placeholder="21-19"
            value={score}
            onChange={(event) => updateScore(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="stake-control"
          aria-pressed={isStake}
          onClick={() => setIsStake((current) => !current)}
        >
          <div className="stake-control-copy">
            <span>Loser pay all (kèo độ)</span>
            <p
              className={[
                "stake-caption",
                stakeCaption ? "visible" : "",
              ].filter(Boolean).join(" ")}
              aria-live="polite"
            >
              {stakeCaption || "Score decides who pays."}
            </p>
          </div>
          <span className="stake-icon-toggle" aria-hidden="true">
            {isStake ? <ToggleRight size={34} /> : <ToggleLeft size={34} />}
          </span>
        </button>
        {isStake && !scoreResult ? (
          <p className="stake-warning">
            Enter a score first. Example: 2119 means {currentUser.name} wins, 1721 means {currentUser.name} loses.
          </p>
        ) : null}
        <button type="submit" className="primary-button" disabled={!opponentId || isSubmitting || (isStake && !scoreResult)}>
          {isSubmitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>,
    document.body,
  );
}

function SessionPinGate({ sessionId, session, store }: { sessionId: string; session?: Session; store: Store }) {
  const [pinCode, setPinCode] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [publicInfo, setPublicInfo] = useState<SessionPublicInfo | undefined>(() =>
    session ? sessionEntryInfo(session, store.state) : undefined,
  );

  useEffect(() => {
    if (session || !store.isRemoteEnabled) return;
    let isMounted = true;
    void store.getSessionPublicInfo(sessionId).then((info) => {
      if (isMounted) setPublicInfo(info);
    });
    return () => {
      isMounted = false;
    };
  }, [sessionId, session, store.isRemoteEnabled]);

  async function verifyPin() {
    if (pinCode.length !== 4 || isVerifying) return;
    setIsVerifying(true);
    const isValid = await store.verifySessionPin(sessionId, pinCode);
    setIsVerifying(false);

    if (!isValid) {
      setPinError("PIN code does not match this session, or this session is no longer in the database.");
      return;
    }
  }

  return (
    <form
      className="login-card"
      onSubmit={(event) => {
        event.preventDefault();
        void verifyPin();
      }}
    >
      <p className="eyebrow">Player access</p>
      <h1>Enter PIN.</h1>
      <label>
        Session PIN
        <input
          inputMode="numeric"
          maxLength={4}
          value={pinCode}
          onChange={(event) => {
            setPinCode(event.target.value.replace(/\D/g, "").slice(0, 4));
            setPinError("");
          }}
          placeholder="4 digits"
        />
      </label>
      {pinError ? <p className="form-error">{pinError}</p> : null}
      <button type="submit" className="primary-button" disabled={pinCode.length !== 4 || isVerifying}>
        {isVerifying ? "Verifying..." : "Continue"}
      </button>
      <SessionEntryInfo info={publicInfo} showUnavailableHint={store.isRemoteEnabled} />
    </form>
  );
}

function SessionEntryInfo({ info, showUnavailableHint = false }: { info?: SessionPublicInfo; showUnavailableHint?: boolean }) {
  if (!info?.sessionName && !info?.sessionDate && !info?.hostName) {
    if (!showUnavailableHint) return null;
    return (
      <div className="session-entry-info unavailable">
        <div>
          <span>Session</span>
          <strong>Info unavailable</strong>
        </div>
        <p>Run the latest Supabase schema so shared links can show session and host before PIN entry.</p>
      </div>
    );
  }

  return (
    <div className="session-entry-info">
      <div>
        <span>Session</span>
        <strong>{info.sessionName || info.sessionDate || "Active session"}</strong>
      </div>
      <div>
        <span>Host</span>
        <strong>{info.hostName || "Not selected"}</strong>
      </div>
    </div>
  );
}

function UserDropdown({
  users,
  value,
  placeholder,
  onChange,
}: {
  users: User[];
  value: string;
  placeholder: string;
  onChange: (userId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedUser = users.find((user) => user.id === value);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className="custom-select" ref={dropdownRef}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedUser?.name ?? placeholder}</span>
        <ChevronDown size={18} />
      </button>
      {isOpen ? (
        <div className="custom-select-menu" role="listbox" aria-label={placeholder}>
          {users.map((user) => {
            const isSelected = user.id === value;
            return (
              <button
                type="button"
                className={isSelected ? "custom-select-option selected" : "custom-select-option"}
                key={user.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(user.id);
                  setIsOpen(false);
                }}
              >
                <span>{user.name}</span>
                {isSelected ? <Check size={17} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MatchCard({
  match,
  number,
  session,
  currentUser,
  users,
}: {
  match: Match;
  number: number;
  session: Session;
  currentUser: User;
  users: User[];
}) {
  const opponentId = match.playerAId === currentUser.id ? match.playerBId : match.playerAId;
  const opponent = users.find((user) => user.id === opponentId)?.name ?? "Unknown";
  const isStakeWinner = match.isStake && match.winnerId === currentUser.id;
  const isStakeLoser = match.isStake && !isStakeWinner;
  return (
    <article className={`match-card ${match.isStake ? (isStakeWinner ? "stake-win" : "stake-loss") : ""}`}>
      <div className="match-card-top">
        <strong>Match: #{String(number).padStart(2, "0")}</strong>
        <span>{formatTime(match.createdAt)}</span>
      </div>
      <p>
        <span>{currentUser.name}</span>
        <b>VS</b>
        <span>{opponent}</span>
      </p>
      {match.score ? <div className="score-pill">Score {match.score}</div> : null}
      {match.isStake ? (
        <small>{isStakeWinner ? "🏆 Won the stakes! Fee: 0 VND" : "🔥 Lost the stakes. Total charged: 2x"}</small>
      ) : (
        <small>Status: Recorded · {sessionTitle(session)}</small>
      )}
    </article>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sessionTitle(session: Session): string {
  return session.name?.trim() || session.date;
}

function playerFeeLabel(session: Session): string {
  return session.billingMethod === "casual" ? "Match Price" : "Court share";
}

function normalizeScore(score: string): string | undefined {
  const trimmed = score.trim();
  return trimmed ? trimmed.replace(/\s+/g, "") : undefined;
}

function formatScoreInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;

  if (digits.length === 3) {
    const firstTwo = Number(digits.slice(0, 2));
    return firstTwo >= 21 && firstTwo <= 32
      ? `${digits.slice(0, 2)}-${digits.slice(2)}`
      : `${digits.slice(0, 1)}-${digits.slice(1)}`;
  }

  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function isSessionHost(roster: { sessionId: string; userId: string; isHost?: boolean }[], sessionId: string, userId: string): boolean {
  return roster.some((entry) => entry.sessionId === sessionId && entry.userId === userId && entry.isHost);
}

function sessionEntryInfo(session: Session, state: TrackerState): SessionPublicInfo {
  const hostEntry = state.roster.find((entry) => entry.sessionId === session.id && entry.isHost);
  const hostName = hostEntry
    ? state.users.find((user) => user.id === hostEntry.userId)?.name
    : undefined;

  return {
    sessionName: sessionTitle(session),
    sessionDate: session.date,
    hostName,
  };
}

function readScoreResult(score: string): { formattedScore: string; playerWon: boolean } | null {
  const digits = score.replace(/\D/g, "");
  if (digits.length !== 4) return null;

  const playerScore = Number(digits.slice(0, 2));
  const opponentScore = Number(digits.slice(2));
  if (!Number.isFinite(playerScore) || !Number.isFinite(opponentScore) || playerScore === opponentScore) return null;

  return {
    formattedScore: `${digits.slice(0, 2)}-${digits.slice(2)}`,
    playerWon: playerScore > opponentScore,
  };
}

function syncErrorGuidance(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes("rate limit")) {
    return "Supabase temporarily throttled anonymous sign-ins. Wait a minute, then refresh the shared link.";
  }
  if (normalized.includes("anonymous sign-ins are disabled")) {
    return "Enable Anonymous Sign-ins in Supabase Authentication Providers, then refresh.";
  }
  return "If this persists, run the latest supabase-schema.sql in your Supabase project, then refresh.";
}

function uniqueUsersByName(users: User[]): User[] {
  const seenNames = new Set<string>();
  return users.filter((user) => {
    const key = user.name.trim().toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
}
