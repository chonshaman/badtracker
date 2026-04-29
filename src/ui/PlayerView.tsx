import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatVnd } from "../lib/money";
import type { Match, Session, User } from "../types";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type PlayerViewProps = {
  slug: string;
  store: Store;
  activeSession?: Session;
};

export function PlayerView({ slug, store, activeSession }: PlayerViewProps) {
  const playerStorageKey = activeSession ? `smash-player-${activeSession.id}` : `smash-player-${slug}`;
  const pinStorageKey = activeSession ? `smash-pin-${activeSession.id}` : `smash-pin-${slug}`;
  const [playerId, setPlayerId] = useState(() => sessionStorage.getItem(playerStorageKey) ?? "");
  const [pinCode, setPinCode] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPinVerified, setIsPinVerified] = useState(() => sessionStorage.getItem(pinStorageKey) === "verified");
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    setPlayerId(sessionStorage.getItem(playerStorageKey) ?? "");
  }, [playerStorageKey]);

  useEffect(() => {
    setIsPinVerified(sessionStorage.getItem(pinStorageKey) === "verified");
    setPinCode("");
    setPinError("");
  }, [pinStorageKey]);

  useEffect(() => {
    if (playerId) sessionStorage.setItem(playerStorageKey, playerId);
  }, [playerId, playerStorageKey]);

  useEffect(() => {
    if (activeSession && isPinVerified && !isHostParticipant(store, activeSession.id)) {
      rememberPlayerJoinedSession(activeSession.id);
    }
  }, [activeSession, isPinVerified, store]);

  if (!activeSession) {
    if (store.isRemoteEnabled && store.isSyncing) {
      return (
        <section className="player-empty">
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

    return (
      <section className="player-empty">
        <p className="eyebrow">Court closed</p>
        <h1>No active session.</h1>
        <p>Ask the host to start a session before recording matches.</p>
      </section>
    );
  }

  if (activeSession.pinCode && !isPinVerified) {
    const verifyPin = () => {
      if (pinCode.trim() !== activeSession.pinCode) {
        setPinError("PIN code does not match this session.");
        return;
      }
      sessionStorage.setItem(pinStorageKey, "verified");
      if (!isHostParticipant(store, activeSession.id)) rememberPlayerJoinedSession(activeSession.id);
      setIsPinVerified(true);
      setPinError("");
    };

    return (
      <section className="login-card">
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
        <button className="primary-button" disabled={pinCode.length !== 4} onClick={verifyPin}>
          Continue
        </button>
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
        <select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
          <option value="">Select your name</option>
          {roster.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <button className="primary-button" disabled={!playerId}>
          Enter court
        </button>
        <div className="guest-join">
          <p className="eyebrow">Not on roster?</p>
          <input
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Add guest name"
          />
          <button className="secondary-button" onClick={addGuest}>
            Add guest and enter
          </button>
        </div>
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
  const opponents = roster.filter((user) => user.id !== currentUser.id);

  return (
    <div className="player-screen">
      <header className="sticky-player-header">
        <p>Hi, {currentUser.name}</p>
        <h1>{formatVnd(myMatches.length * activeSession.feePerPerson)}</h1>
        <span>Matches: {myMatches.length}</span>
      </header>

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
              {opponent.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card-feed">
        <h2>My match cards</h2>
        {myMatches.length === 0 ? (
          <p className="empty-state">Your recorded matches will appear here.</p>
        ) : (
          myMatches.map((match, index) => (
            <MatchCard
              key={match.id}
              match={match}
              number={myMatches.length - index}
              currentUser={currentUser}
              users={store.state.users}
            />
          ))
        )}
      </section>

      {selectedOpponentId && (
        <RecordMatchModal
          currentUser={currentUser}
          opponents={opponents}
          initialOpponentId={selectedOpponentId}
          onClose={() => setSelectedOpponentId(null)}
          onSubmit={(opponentId, score) => {
            store.addMatch({
              id: `m-${crypto.randomUUID()}`,
              sessionId: activeSession.id,
              createdAt: new Date().toISOString(),
              playerAId: currentUser.id,
              playerBId: opponentId,
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
  onSubmit: (opponentId: string, score?: string) => void;
}) {
  const [opponentId, setOpponentId] = useState(initialOpponentId);
  const [score, setScore] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);

  function handleSubmit() {
    if (!opponentId || submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    onSubmit(opponentId, normalizeScore(score));
  }

  const selectedOpponent = opponents.find((opponent) => opponent.id === opponentId);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Record match">
      <div className="match-modal">
        <button className="close-button" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <p className="eyebrow">New match</p>
        <h2>{currentUser.name} vs {selectedOpponent?.name}</h2>
        <select value={opponentId} onChange={(event) => setOpponentId(event.target.value)}>
          {opponents.map((opponent) => (
            <option key={opponent.id} value={opponent.id}>
              {opponent.name}
            </option>
          ))}
        </select>
        <label>
          Score
          <input
            inputMode="numeric"
            placeholder="21-19"
            value={score}
            onChange={(event) => setScore(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={!opponentId || isSubmitting} onClick={handleSubmit}>
          {isSubmitting ? "Submitting..." : "Confirm match"}
        </button>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  number,
  currentUser,
  users,
}: {
  match: Match;
  number: number;
  currentUser: User;
  users: User[];
}) {
  const opponentId = match.playerAId === currentUser.id ? match.playerBId : match.playerAId;
  const opponent = users.find((user) => user.id === opponentId)?.name ?? "Unknown";
  return (
    <article className="match-card">
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
      <small>Status: Recorded</small>
    </article>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeScore(score: string): string | undefined {
  const trimmed = score.trim();
  return trimmed ? trimmed.replace(/\s+/g, "") : undefined;
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

function isHostParticipant(store: Store, sessionId: string): boolean {
  return store.state.participants.some(
    (participant) => participant.sessionId === sessionId && participant.role === "host",
  );
}

function rememberPlayerJoinedSession(sessionId: string) {
  const storageKey = "smash-player-joined-sessions-v1";
  const raw = localStorage.getItem(storageKey);
  let sessionIds: string[] = [];
  try {
    sessionIds = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    sessionIds = [];
  }
  if (!sessionIds.includes(sessionId)) {
    localStorage.setItem(storageKey, JSON.stringify([...sessionIds, sessionId]));
  }
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
