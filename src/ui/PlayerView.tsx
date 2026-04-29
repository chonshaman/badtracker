import { Check, ChevronDown, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { formatVnd } from "../lib/money";
import type { Match, Session, User } from "../types";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type PlayerViewProps = {
  slug: string;
  sessionId?: string;
  store: Store;
  activeSession?: Session;
};

export function PlayerView({ slug, sessionId, store, activeSession }: PlayerViewProps) {
  const playerStorageKey = activeSession ? `smash-player-${activeSession.id}` : `smash-player-${slug}`;
  const [playerId, setPlayerId] = useState(() => sessionStorage.getItem(playerStorageKey) ?? "");
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    setPlayerId(sessionStorage.getItem(playerStorageKey) ?? "");
  }, [playerStorageKey]);

  useEffect(() => {
    if (playerId) sessionStorage.setItem(playerStorageKey, playerId);
  }, [playerId, playerStorageKey]);

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

    if (sessionId && store.isRemoteEnabled) {
      return <SessionPinGate sessionId={sessionId} store={store} />;
    }

    return (
      <section className="player-empty">
        <p className="eyebrow">Court closed</p>
        <h1>No active session.</h1>
        <p>Ask the host to start a session before recording matches.</p>
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
  const [isOpponentListOpen, setIsOpponentListOpen] = useState(false);
  const submitLock = useRef(false);
  const opponentDropdownRef = useRef<HTMLDivElement>(null);

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

  function handleSubmit() {
    if (!opponentId || submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    onSubmit(opponentId, normalizeScore(score));
  }

  function updateScore(value: string) {
    setScore(formatScoreInput(value));
  }

  const selectedOpponent = opponents.find((opponent) => opponent.id === opponentId);

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
            inputMode="numeric"
            placeholder="21-19"
            value={score}
            onChange={(event) => updateScore(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button" disabled={!opponentId || isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>,
    document.body,
  );
}

function SessionPinGate({ sessionId, store }: { sessionId: string; store: Store }) {
  const [pinCode, setPinCode] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  async function verifyPin() {
    if (pinCode.length !== 4 || isVerifying) return;
    setIsVerifying(true);
    const isValid = await store.verifySessionPin(sessionId, pinCode);
    setIsVerifying(false);

    if (!isValid) {
      setPinError("PIN code does not match this session.");
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
    </form>
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
