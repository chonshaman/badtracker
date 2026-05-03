import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { formatVnd } from "../lib/money";
import { formatScorePart, hasRecordedScore } from "../lib/scoreFlow";
import { useStore } from "../lib/storeContext";
import { shuttleFeePerMatch } from "../lib/sessionMath";
import { getSessionBills, getUserBillForSession } from "../lib/selectors";
import { runViewTransition } from "../lib/viewTransition";
import type { Match, Session, SessionPublicInfo, TrackerState, User } from "../types";
import { Check, ChevronDown, ChevronRight, Copy, Plus, ShuttleIcon } from "./icons";
import { MatchSummaryCard } from "./MatchSummaryCard";
import { EditScoreModal, RecordMatchModal } from "./player/MatchModals";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type PlayerViewProps = {
  slug: string;
  sessionId?: string;
  activeSession?: Session;
};

export function PlayerView({ slug, sessionId, activeSession }: PlayerViewProps) {
  const store = useStore();
  const linkedSession = sessionId ? store.state.sessions.find((session) => session.id === sessionId) : undefined;
  const sessionForPlayer = activeSession ?? linkedSession;
  const playerStorageKey = sessionForPlayer ? `smash-player-${sessionForPlayer.id}` : `smash-player-${slug}`;
  const [playerId, setPlayerId] = useState(() => sessionStorage.getItem(playerStorageKey) ?? "");
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [editingScoreMatchId, setEditingScoreMatchId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [selectedHomeSessionId, setSelectedHomeSessionId] = useState("");
  const [sessionLinkStatus, setSessionLinkStatus] = useState<"checking" | "active" | "closed" | "missing" | "unknown">(
    sessionId && store.isRemoteEnabled ? "checking" : "unknown",
  );

  useEffect(() => {
    setPlayerId(sessionStorage.getItem(playerStorageKey) ?? "");
  }, [playerStorageKey]);

  useEffect(() => {
    if (playerId) sessionStorage.setItem(playerStorageKey, playerId);
  }, [playerId, playerStorageKey]);

  const selectPlayerId = (nextPlayerId: string) => {
    runViewTransition(() => setPlayerId(nextPlayerId));
  };

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
        onPlayerChange={selectPlayerId}
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
  const roster = usersForRosterIds(store.state.users, rosterIds);
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
        selectPlayerId(existingUser.id);
        return;
      }

      const guest: User = {
        id: `u-${crypto.randomUUID()}`,
        name: trimmed,
        role: "Player",
        type: "Temp",
      };
      store.joinSessionGuest(guest, activeSession.id);
      selectPlayerId(guest.id);
      setGuestName("");
    };

    return (
      <section className="login-card player-flow-surface">
        <p className="eyebrow">Active session</p>
        <h1>Who are you?</h1>
        <UserDropdown
          users={roster}
          value={playerId}
          placeholder="Select your name"
          sessionId={activeSession.id}
          roster={store.state.roster}
          onChange={selectPlayerId}
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
            JOIN AS GUEST
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
  const currentUserIds = [currentUser.id];
  const joinedSessions = store.state.sessions
    .filter((session) =>
      store.state.roster.some(
        (entry) => entry.sessionId === session.id && currentUserIds.includes(entry.userId),
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedHomeSession = joinedSessions.find((session) => session.id === selectedHomeSessionId) ?? joinedSessions[0] ?? activeSession;
  const selectedHomeBill = getUserBillForSession(store.state, selectedHomeSession, currentUser.id);
  const courtFee = selectedHomeBill?.courtShare ?? 0;
  const playerFeeMetric = selectedHomeSession.billingMethod === "casual" ? selectedHomeBill?.courtShare ?? 0 : courtFee;
  const totalDue = selectedHomeBill?.totalDue ?? 0;
  const selectedShuttleCostPerMatch = shuttleFeePerMatch(selectedHomeSession);
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
    <div className="player-screen player-flow-surface">
      <PlayerDebtHeader
        session={selectedHomeSession}
        sessions={joinedSessions}
        selectedSessionId={selectedHomeSession.id}
        onSessionChange={setSelectedHomeSessionId}
        playerId={currentUser.id}
        playerName={currentUser.name}
        totalDue={totalDue}
        playerFeeMetric={playerFeeMetric}
        shuttleCostPerMatch={selectedShuttleCostPerMatch}
        matchesPlayed={selectedHomeBill?.matchesPlayed ?? 0}
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
              roster={store.state.roster}
              backTo={playerReturnPath}
              onAddScore={() => setEditingScoreMatchId(match.id)}
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

      {editingScoreMatchId ? (
        <EditScoreModal
          match={myMatches.find((match) => match.id === editingScoreMatchId)}
          currentUser={currentUser}
          users={store.state.users}
          onClose={() => setEditingScoreMatchId(null)}
          onSubmit={(score) => {
            store.updateMatchScore(editingScoreMatchId, score);
            setEditingScoreMatchId(null);
          }}
        />
      ) : null}
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
  const [copiedField, setCopiedField] = useState<"bankAccount" | "bankName" | null>(null);
  const rosterIds = store.state.roster
    .filter((entry) => entry.sessionId === session.id)
    .map((entry) => entry.userId);
  const roster = usersForRosterIds(store.state.users, rosterIds);
  const currentUser = roster.find((user) => user.id === playerId);
  const hostEntry = store.state.roster.find((entry) => entry.sessionId === session.id && entry.isHost);
  const hostName = hostEntry ? store.state.users.find((user) => user.id === hostEntry.userId)?.name : undefined;
  const sessionMatches = store.state.matches.filter((match) => match.sessionId === session.id);
  const bill = currentUser
    ? getUserBillForSession(store.state, session, currentUser.id)
    : undefined;
  const opponentCount = currentUser
    ? new Set(
        sessionMatches.flatMap((match) => {
          if (match.playerAId === currentUser.id) return [match.playerBId];
          if (match.playerBId === currentUser.id) return [match.playerAId];
          return [];
        }),
      ).size
    : 0;

  async function copyPaymentField(value: string, field: "bankAccount" | "bankName") {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1800);
  }

  return (
    <section className="closed-session-summary-card">
      <div className="closed-session-overview-card">
        <div className="closed-session-top">
          <p className="eyebrow">Session ended</p>
          <p className="closed-session-status">
            <span className="closed-session-name">“{sessionTitle(session)}”</span> is now closed.
          </p>
        </div>

        <div className="closed-session-summary-block">
          {currentUser ? (
            <>
              <h1>Hi {currentUser.name},</h1>
              <p className="closed-session-summary-copy">
                You played <strong>{bill?.matchesPlayed ?? 0} {(bill?.matchesPlayed ?? 0) === 1 ? "match" : "matches"}</strong> today with{" "}
                <strong>{opponentCount} {opponentCount === 1 ? "opponent" : "opponents"}</strong>.
              </p>
              <Link
                className="closed-session-report-link"
                to={`/${session.slug}/admin/${session.id}`}
                state={{ backTo: `/${session.slug}`, playerId }}
              >
                <span>View session report</span>
                <ChevronRight size={18} />
              </Link>
              <div className="closed-session-total-row">
                <span>Total fee:</span>
                <strong>{formatVnd(bill?.totalDue ?? 0)}</strong>
              </div>
            </>
          ) : roster.length > 0 ? (
            <>
              <h1>Session wrapped up.</h1>
              <p className="closed-session-summary-copy">Pick your name to see your final total and payment details.</p>
              <UserDropdown
                users={roster}
                value={playerId}
                placeholder="Select your name"
                onChange={onPlayerChange}
              />
              <Link
                className="closed-session-report-link"
                to={`/${session.slug}/admin/${session.id}`}
                state={{ backTo: `/${session.slug}`, playerId }}
              >
                <span>View session report</span>
                <ChevronRight size={18} />
              </Link>
            </>
          ) : (
            <>
              <h1>Session wrapped up.</h1>
              <p className="closed-session-summary-copy">The final report is ready, and payment details will appear here once your host adds them.</p>
              <Link
                className="closed-session-report-link"
                to={`/${session.slug}/admin/${session.id}`}
                state={{ backTo: `/${session.slug}`, playerId }}
              >
                <span>View session report</span>
                <ChevronRight size={18} />
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="closed-session-payment-card">
        <div className="closed-session-payment-fields">
          <CopyPaymentField
            label="Bank account:"
            value={session.paymentBankAccount}
            copied={copiedField === "bankAccount"}
            onCopy={() => session.paymentBankAccount ? copyPaymentField(session.paymentBankAccount, "bankAccount") : undefined}
          />
          <CopyPaymentField
            label="Bank name:"
            value={session.paymentBankName}
            copied={copiedField === "bankName"}
            onCopy={() => session.paymentBankName ? copyPaymentField(session.paymentBankName, "bankName") : undefined}
          />
        </div>
        {session.paymentQrCodeUrl ? (
          <div className="closed-session-payment-qr-frame">
            <img className="closed-session-payment-qr" src={session.paymentQrCodeUrl} alt="Payment QR code" />
          </div>
        ) : (
          <div className="closed-session-payment-qr-frame closed-session-payment-qr-empty">
            <span>QR code will appear here</span>
          </div>
        )}
        <p className="closed-session-payment-note">
          Please settle up with <strong>@{hostName ?? "host"}</strong> to keep the court lights burning! Thanks! 🙏
        </p>
      </div>
    </section>
  );
}

function CopyPaymentField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="closed-session-payment-field">
      <span>{label}</span>
      <button type="button" className="closed-session-payment-copy" onClick={onCopy} disabled={!value}>
        <span>{value ?? "Your host will add this soon"}</span>
        <Copy size={18} />
        {copied ? <em className="copy-tooltip inline-copy-tooltip">Copied</em> : null}
      </button>
    </div>
  );
}

function PlayerDebtHeader({
  session,
  sessions,
  selectedSessionId,
  onSessionChange,
  playerId,
  playerName,
  totalDue,
  playerFeeMetric,
  shuttleCostPerMatch,
  matchesPlayed,
  backTo,
}: {
  session: Session;
  sessions: Session[];
  selectedSessionId: string;
  onSessionChange: (sessionId: string) => void;
  playerId: string;
  playerName: string;
  totalDue: number;
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
      </div>
      <Link className="player-money-link" to={`/${session.slug}/admin/${session.id}`} state={{ backTo, playerId }}>
        <h1>{formatVnd(totalDue)}</h1>
        <ChevronRight size={18} />
      </Link>
      <div className="debt-breakdown" aria-label="Debt breakdown">
        <span>
          {playerFeeLabel(session)}: {formatVnd(playerFeeMetric)}
        </span>
        <span>Shuttle/match: {formatVnd(shuttleCostPerMatch)}</span>
      </div>
      <HomeSessionDropdown
        sessions={sessions}
        value={selectedSessionId}
        matchesPlayed={matchesPlayed}
        onChange={onSessionChange}
      />
    </header>
  );
}

function HomeSessionDropdown({
  sessions,
  value,
  matchesPlayed,
  onChange,
}: {
  sessions: Session[];
  value: string;
  matchesPlayed: number;
  onChange: (sessionId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedSession = sessions.find((session) => session.id === value) ?? sessions[0];

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  if (!selectedSession) return null;

  return (
    <div className="home-session-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className="home-session-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="home-session-copy">
          <strong className="session-name-with-icon">
            <ShuttleIcon className="shuttle-icon" size={18} />
            <span>{sessionTitle(selectedSession)}</span>
          </strong>
          <small>{matchesPlayed} {matchesPlayed === 1 ? "match" : "matches"} played</small>
        </span>
        <ChevronDown className="home-session-chevron" size={18} />
      </button>
      {isOpen ? (
        <div className="home-session-menu" role="listbox" aria-label="Select session">
          {sessions.map((session) => (
            <button
              type="button"
              className={session.id === selectedSession.id ? "home-session-option selected" : "home-session-option"}
              key={session.id}
              role="option"
              aria-selected={session.id === selectedSession.id}
              onClick={() => {
                onChange(session.id);
                setIsOpen(false);
              }}
            >
              <span className="session-name-with-icon">
                <ShuttleIcon className="shuttle-icon" size={17} />
                <span>{sessionTitle(session)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
        const bill = getSessionBills(store.state, session).find((candidate) =>
          candidate.userIds.some((userId) => currentUserIds.includes(userId)),
        );

        return (
          <Link className="previous-session-card" key={session.id} to={`/${session.slug}/admin/${session.id}`} state={{ backTo, playerId }}>
            <div>
              <strong className="session-name-with-icon">
                <ShuttleIcon className="shuttle-icon" size={17} />
                <span>{sessionTitle(session)}</span>
              </strong>
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

function SessionPinGate({ sessionId, session, store }: { sessionId: string; session?: Session; store: Store }) {
  const [pinCode, setPinCode] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const pinInputRefs = useRef<Array<HTMLInputElement | null>>([]);
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

  function updatePinDigit(index: number, value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    if (!digits) {
      setPinCode((current) => {
        const next = current.padEnd(4, " ").split("");
        next[index] = " ";
        return next.join("").replace(/\s/g, "").slice(0, 4);
      });
      setPinError("");
      return;
    }

    setPinCode((current) => {
      const next = current.padEnd(4, " ").split("");
      digits.split("").forEach((digit, offset) => {
        if (index + offset < 4) next[index + offset] = digit;
      });
      return next.join("").replace(/\s/g, "").slice(0, 4);
    });
    const nextIndex = Math.min(3, index + digits.length);
    pinInputRefs.current[nextIndex]?.focus();
    setPinError("");
  }

  function handlePinKeyDown(index: number, key: string) {
    if (key !== "Backspace" || pinCode[index]) return;
    pinInputRefs.current[Math.max(0, index - 1)]?.focus();
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
        <div className="pin-code-grid" aria-label="4 digit session PIN">
          {Array.from({ length: 4 }).map((_, index) => (
            <input
              key={index}
              ref={(element) => {
                pinInputRefs.current[index] = element;
              }}
              inputMode="numeric"
              maxLength={1}
              value={pinCode[index] ?? ""}
              onChange={(event) => updatePinDigit(index, event.target.value)}
              onPaste={(event) => {
                event.preventDefault();
                updatePinDigit(index, event.clipboardData.getData("text"));
              }}
              onKeyDown={(event) => handlePinKeyDown(index, event.key)}
              aria-label={`PIN digit ${index + 1}`}
            />
          ))}
        </div>
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
        <p>You are joining this session. Host info appears after the latest Supabase schema is applied.</p>
        <p>Run the latest Supabase schema so shared links can show session and host before PIN entry.</p>
      </div>
    );
  }

  const sessionName = info.sessionName || info.sessionDate || "this session";
  const hostName = info.hostName ? `@${info.hostName}` : "the host";

  return (
    <div className="session-entry-info">
      <p>
        You are joining session{" "}
        <strong className="session-name-with-icon inline-session-name">
          <ShuttleIcon className="shuttle-icon" size={16} />
          <span>{sessionName}</span>
        </strong>{" "}
        hosted by <strong>{hostName}</strong>.
      </p>
    </div>
  );
}

function UserDropdown({
  users,
  value,
  placeholder,
  sessionId,
  roster,
  onChange,
}: {
  users: User[];
  value: string;
  placeholder: string;
  sessionId?: string;
  roster?: { sessionId: string; userId: string; isHost?: boolean }[];
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
        <span className="user-option-name">
          <span>{selectedUser?.name ?? placeholder}</span>
          {selectedUser && sessionId && roster && isSessionHost(roster, sessionId, selectedUser.id) ? (
            <span className="host-badge dropdown-host-badge">Host</span>
          ) : null}
        </span>
        <ChevronDown size={18} />
      </button>
      {isOpen ? (
        <div className="custom-select-menu" role="listbox" aria-label={placeholder}>
          {users.map((user) => {
            const isSelected = user.id === value;
            const isHost = Boolean(sessionId && roster && isSessionHost(roster, sessionId, user.id));
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
                <span className="user-option-name">
                  <span>{user.name}</span>
                  {isHost ? <span className="host-badge dropdown-host-badge">Host</span> : null}
                </span>
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
  roster,
  backTo,
  onAddScore,
}: {
  match: Match;
  number: number;
  session: Session;
  currentUser: User;
  users: User[];
  roster: { sessionId: string; userId: string; isHost?: boolean }[];
  backTo: string;
  onAddScore: () => void;
}) {
  const opponentId = match.playerAId === currentUser.id ? match.playerBId : match.playerAId;
  const opponent = users.find((user) => user.id === opponentId)?.name ?? "Unknown";
  const isCurrentUserHost = isSessionHost(roster, session.id, currentUser.id);
  const isOpponentHost = isSessionHost(roster, session.id, opponentId);
  return (
    <MatchSummaryCard
      match={match}
      number={number}
      sessionName={sessionTitle(session)}
      currentPlayerId={currentUser.id}
      currentPlayerName={currentUser.name}
      opponentName={opponent}
      isCurrentPlayerHost={isCurrentUserHost}
      isOpponentHost={isOpponentHost}
      to={`/${session.slug}/admin/${session.id}`}
      state={{ backTo, playerId: currentUser.id, highlightMatchId: match.id }}
      onAddScore={!hasRecordedScore(match.score) ? onAddScore : undefined}
    />
  );
}

export function PlayerBillingCard({
  session,
  playerFeeMetric,
  shuttleCostPerMatch,
}: {
  session: Session;
  playerFeeMetric: number;
  shuttleCostPerMatch: number;
}) {
  const isCasual = session.billingMethod === "casual";
  const methodLabel = isCasual ? "Casual (Pooled/Proportional)" : "Standard (Fixed Court + Per Match)";
  return (
    <section className="player-billing-card" aria-label="Billing settings">
      <p>Billing settings</p>
      <div className="player-billing-card-body">
        <h3>{methodLabel}</h3>
        <span className="player-billing-description">
          {isCasual
            ? "All court and shuttle costs are pooled, then split by each player match."
            : "Court is split by present players + Shuttle is split only by players in each match."}
        </span>
        <strong className="player-billing-summary">
          {isCasual
            ? `Fee/match: ${formatVnd(playerFeeMetric)}`
            : `Court share: ${formatVnd(playerFeeMetric)} + Shuttle/match: ${formatVnd(shuttleCostPerMatch)}`}
        </strong>
      </div>
    </section>
  );
}

/*
      <div className="match-card-scoreboard">
        <div className="match-player-line with-divider">
          <span className="match-player-name">
            {!match.score ? <BadmintonIcon size={16} /> : null}
            {currentUser.name}
            {isCurrentUserHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-bubble score-primary">{scoreParts.current}</span>
        </div>
        <div className="match-player-line">
          <span className="match-player-name">
            {!match.score ? <BadmintonIcon size={16} /> : null}
            {opponent}
            {isOpponentHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-bubble score-secondary">{scoreParts.opponent}</span>
        </div>
      </div>
      <div className="match-card-footer">
        <span>#{number} - {formatTime(match.createdAt)}</span>
        <span className="match-card-session">
          <span className="session-name-with-icon">
            <ShuttleIcon className="shuttle-icon" size={16} />
            <span>{sessionTitle(session)}</span>
          </span>
          <ChevronRight size={18} />
        </span>
      </div>
      {match.isStake ? (
        <small>{isStakeWinner ? "🏆 Won the stakes! Fee: 0 VND" : "🔥 Lost the stakes. Total charged: 2x"}</small>
      ) : (
        <small>Status: Recorded · {sessionTitle(session)}</small>
      )}
    </Link>
*/

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
  return session.billingMethod === "casual" ? "Fee/match" : "Court share";
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

function usersForRosterIds(users: User[], rosterIds: string[]): User[] {
  return rosterIds
    .map((userId) => users.find((user) => user.id === userId))
    .filter((user): user is User => Boolean(user));
}


