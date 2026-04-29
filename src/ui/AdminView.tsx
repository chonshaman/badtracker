import { ChevronDown, ChevronUp, Copy, Download, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { presets } from "../data/defaults";
import { formatVnd, parseMoneyInput } from "../lib/money";
import { calculateFee, maxMatches, playerBills } from "../lib/sessionMath";
import type { Match, RosterEntry, Session, TrackerState, User } from "../types";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type AdminViewProps = {
  slug: string;
  store: Store;
};

type SetupDraft = {
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
  feePerPerson: number;
};

const initialPreset = presets[0];

export function AdminView({ slug, store }: AdminViewProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const sessionRoles = participantSessionRoles(store.state);
  const activeSession = store.state.sessions.find(
    (session) => sessionRoles.has(session.id) && session.slug === slug && session.status === "Active",
  );
  const selectedSession = selectedSessionId
    ? store.state.sessions.find((session) => sessionRoles.has(session.id) && session.id === selectedSessionId)
    : undefined;
  const selectedRole = selectedSession ? sessionRoles.get(selectedSession.id) : undefined;

  function handleSessionCreated(sessionId: string) {
    setSelectedSessionId(sessionId);
    setIsCreating(false);
  }

  return (
    <div className="screen-stack">
      <HeroCard slug={slug} activeSession={activeSession} />
      {isCreating ? (
        <SessionSetup
          slug={slug}
          store={store}
          onCancel={() => setIsCreating(false)}
          onSessionCreated={handleSessionCreated}
        />
      ) : selectedSession ? (
        <ActiveSessionDashboard
          session={selectedSession}
          role={selectedRole ?? "player"}
          store={store}
          onBack={() => setSelectedSessionId(null)}
        />
      ) : (
        <SessionList
          state={store.state}
          slug={slug}
          sessionRoles={sessionRoles}
          onCreate={() => setIsCreating(true)}
          onSelect={setSelectedSessionId}
        />
      )}
    </div>
  );
}

function HeroCard({ slug, activeSession }: { slug: string; activeSession?: Session }) {
  return (
    <section className="hero-card">
      <p className="eyebrow">Smash Tracker / {slug}</p>
      <h1>Singles billing without the end-night spreadsheet.</h1>
      <p>
        Create one active session, let players record matches, then close with a shareable billing
        summary.
      </p>
      <div className="status-row">
        <span className={activeSession ? "status-dot live" : "status-dot"} />
        {activeSession ? `Active since ${formatTime(activeSession.createdAt)}` : "No active session"}
      </div>
    </section>
  );
}

function SessionList({
  state,
  slug,
  sessionRoles,
  onCreate,
  onSelect,
}: {
  state: TrackerState;
  slug: string;
  sessionRoles: Map<string, "host" | "player">;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
}) {
  const sessions = state.sessions
    .filter((session) => sessionRoles.has(session.id) && session.slug === slug)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="panel session-list-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Sessions</p>
          <h2>All sessions</h2>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={18} /> New session
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="empty-state">No sessions yet.</p>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <button
              type="button"
              className="session-list-row"
              key={session.id}
              onClick={() => onSelect(session.id)}
            >
              <div>
                <strong>{sessionTitle(session)}</strong>
                <span>
                  {session.date} - {formatVnd(session.feePerPerson)} / match
                </span>
              </div>
              <span className={session.status === "Active" ? "session-status active" : "session-status"}>
                {sessionRoles.get(session.id) === "host" ? session.status : "Joined"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SessionSetup({
  slug,
  store,
  onCancel,
  onSessionCreated,
}: AdminViewProps & {
  onCancel: () => void;
  onSessionCreated: (sessionId: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [sessionName, setSessionName] = useState(() => `Session ${new Date().toISOString().slice(0, 10)}`);
  const [selectedPreset, setSelectedPreset] = useState(initialPreset.id);
  const [selectedUsers, setSelectedUsers] = useState<string[]>(
    uniqueUsersByName(
      store.state.users.filter((user) => user.role === "Player" && user.type === "Regular"),
    ).map((u) => u.id),
  );
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [guestName, setGuestName] = useState("");
  const guestAddLock = useRef(false);
  const [draft, setDraft] = useState<SetupDraft>(() => {
    const feePerPerson = calculateFee(initialPreset);
    return { ...initialPreset, feePerPerson };
  });

  const computedFee = calculateFee(draft);
  const setupPlayers = uniqueUsersByName(store.state.users.filter((user) => user.role === "Player")).filter(
    (user) => !hiddenUserIds.includes(user.id),
  );

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId) ?? initialPreset;
    setSelectedPreset(preset.id);
    setDraft({ ...preset, feePerPerson: calculateFee(preset) });
  }

  function updateNumber(field: keyof SetupDraft, value: string) {
    const numeric = field.includes("Price") || field === "feePerPerson" ? parseMoneyInput(value) : Number(value);
    setDraft((current) => ({ ...current, [field]: Number.isFinite(numeric) ? numeric : 0 }));
  }

  function addGuest() {
    const trimmed = guestName.trim();
    if (!trimmed || guestAddLock.current) return;
    guestAddLock.current = true;

    const existingUser = store.state.users.find(
      (user) => user.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existingUser) {
      setSelectedUsers((current) =>
        current.includes(existingUser.id) ? current : [...current, existingUser.id],
      );
      setGuestName("");
      guestAddLock.current = false;
      return;
    }

    const user: User = {
      id: `u-${crypto.randomUUID()}`,
      name: trimmed,
      role: "Player",
      type: "Temp",
    };
    store.addUser(user);
    setSelectedUsers((current) => Array.from(new Set([...current, user.id])));
    setGuestName("");
    window.setTimeout(() => {
      guestAddLock.current = false;
    }, 250);
  }

  function launchSession() {
    const sessionId = `s-${crypto.randomUUID()}`;
    const uniqueSelectedUsers = uniqueUserIdsByName(selectedUsers, store.state.users);
    const trimmedSessionName = sessionName.trim();
    const session: Session = {
      id: sessionId,
      slug,
      name: trimmedSessionName || `Session ${new Date().toISOString().slice(0, 10)}`,
      pinCode: generatePinCode(),
      date: new Date().toISOString().slice(0, 10),
      courtPrice: draft.courtPrice,
      shuttlePrice: draft.shuttlePrice,
      shuttlesPerTube: draft.shuttlesPerTube,
      matchDuration: draft.matchDuration,
      totalCourtTime: draft.totalCourtTime,
      feePerPerson: draft.feePerPerson || computedFee,
      status: "Active",
      createdAt: new Date().toISOString(),
    };
    const roster: RosterEntry[] = uniqueSelectedUsers.map((userId) => ({
      sessionId,
      userId,
      paid: false,
    }));
    store.createSession(session, roster);
    onSessionCreated(sessionId);
  }

  function removeSetupPlayer(userId: string) {
    setSelectedUsers((current) => current.filter((id) => id !== userId));
    setHiddenUserIds((current) => (current.includes(userId) ? current : [...current, userId]));
  }

  return (
    <section className="panel setup-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Session setup</p>
          <h2>Create new session</h2>
        </div>
        <div className="step-badge">Step {step}/3</div>
      </div>

      {step === 1 && (
        <div className="form-grid">
          <label className="full-span">
            Session name
            <input
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              placeholder="Thursday night group"
            />
          </label>
          <label>
            Preset
            <select value={selectedPreset} onChange={(event) => applyPreset(event.target.value)}>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <MoneyField label="Court price" value={draft.courtPrice} onChange={(value) => updateNumber("courtPrice", value)} />
          <MoneyField label="Shuttle tube price" value={draft.shuttlePrice} onChange={(value) => updateNumber("shuttlePrice", value)} />
          <NumberField label="Shuttles per tube" value={draft.shuttlesPerTube} onChange={(value) => updateNumber("shuttlesPerTube", value)} />
          <NumberField label="Match duration (min)" value={draft.matchDuration} onChange={(value) => updateNumber("matchDuration", value)} />
          <NumberField label="Total court time (min)" value={draft.totalCourtTime} onChange={(value) => updateNumber("totalCourtTime", value)} />
          <MoneyField label="Fee per person override" value={draft.feePerPerson} onChange={(value) => updateNumber("feePerPerson", value)} />
          <div className="formula-card">
            <strong>{formatVnd(computedFee)}</strong>
            <span>Calculated fee per person per match</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="roster-list">
          {setupPlayers.map((user) => {
            const isSelected = selectedUsers.includes(user.id);
            return (
              <div className="roster-row" key={user.id}>
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setSelectedUsers((current) =>
                        current.includes(user.id)
                          ? current.filter((id) => id !== user.id)
                          : Array.from(new Set([...current, user.id])),
                      )
                    }
                  />
                  <span>{user.name}</span>
                  <small>{user.type}</small>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${user.name} from this session`}
                  onClick={() => removeSetupPlayer(user.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            );
          })}
          <div className="inline-action">
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Guest player name"
            />
            <button type="button" className="secondary-button" onClick={addGuest}>
              <Plus size={18} /> Add
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="launch-card">
          <p>{uniqueUserIdsByName(selectedUsers, store.state.users).length} players selected</p>
          <strong>{formatVnd(draft.feePerPerson || computedFee)} per person / match</strong>
          <span>
            Max matches: {Math.floor(draft.totalCourtTime / draft.matchDuration)} from{" "}
            {draft.totalCourtTime} court-minutes.
          </span>
        </div>
      )}

      <div className="button-row">
        <button
          className="secondary-button"
          onClick={() => (step === 1 ? onCancel() : setStep((current) => current - 1))}
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < 3 ? (
          <button className="primary-button" onClick={() => setStep((current) => current + 1)}>
            Continue
          </button>
        ) : (
          <button className="primary-button" disabled={selectedUsers.length < 2} onClick={launchSession}>
            Start session
          </button>
        )}
      </div>
    </section>
  );
}

function ActiveSessionDashboard({
  session,
  role,
  store,
  onBack,
}: {
  session: Session;
  role: "host" | "player";
  store: Store;
  onBack: () => void;
}) {
  const isHost = role === "host";
  const shareLink = `${window.location.origin}/${session.slug}/session/${session.id}`;
  const shareText = session.pinCode ? `${shareLink}\nPIN: ${session.pinCode}` : shareLink;
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const bills = playerBills({
    session,
    users: store.state.users,
    roster: store.state.roster,
    matches: store.state.matches,
  });
  const sessionMatches = store.state.matches
    .filter((match) => match.sessionId === session.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalDue = bills.reduce((sum, bill) => sum + bill.totalDue, 0);
  const collected = bills.filter((bill) => bill.paid).reduce((sum, bill) => sum + bill.totalDue, 0);
  const sessionCost = session.courtPrice + (sessionMatches.length * session.shuttlePrice) / session.shuttlesPerTube;

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">{session.status} session</p>
          <h2>{sessionTitle(session)}</h2>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={onBack}>
            Back to sessions
          </button>
          {isHost && session.status === "Active" ? (
            <button className="danger-button" onClick={() => store.endSession(session.id)}>
              End session
            </button>
          ) : null}
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Fee / match / person" value={formatVnd(session.feePerPerson)} />
        <Metric label="Matches logged" value={`${sessionMatches.length}/${Math.floor(maxMatches(session))}`} />
        <Metric label="Collected" value={formatVnd(collected)} />
        <Metric label="Profit / loss" value={formatVnd(totalDue - sessionCost)} />
      </div>

      {session.status === "Active" ? (
        <div className="share-card">
          <div>
            <p className="eyebrow">Share session</p>
            <h3>Player join link</h3>
            <p>{shareLink}</p>
            {session.pinCode ? <div className="pin-chip">PIN {session.pinCode}</div> : null}
            <small>{store.isRemoteEnabled ? "Supabase sync enabled." : "Local mode only."}</small>
            {store.syncError ? <small>Sync issue: {store.syncError}</small> : null}
          </div>
          <img
            alt="Session QR code"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareLink)}`}
          />
          <button className="secondary-button" onClick={() => navigator.clipboard.writeText(shareText)}>
            <Copy size={18} /> Copy link
          </button>
        </div>
      ) : null}

      <div className="table-card">
        <h3>Leaderboard</h3>
        {bills.map((bill) => (
          <div className="leaderboard-player" key={bill.user.id}>
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
              <div>
                <strong>{bill.user.name}</strong>
                <span>{bill.matchesPlayed} matches</span>
              </div>
              <strong>{formatVnd(bill.totalDue)}</strong>
              {isHost ? (
                <label className="paid-toggle" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={bill.paid}
                    onChange={() => store.togglePaid(session.id, bill.user.id)}
                  />
                  Paid
                </label>
              ) : null}
              {expandedPlayerId === bill.user.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
            {expandedPlayerId === bill.user.id ? (
              <PlayerMatchHistory matches={sessionMatches} state={store.state} playerId={bill.user.id} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="table-card">
        <div className="section-header compact">
          <h3>Master log</h3>
          <button className="secondary-button" onClick={() => downloadSummary(session, store.state)}>
            <Download size={18} /> Billing image
          </button>
        </div>
        {sessionMatches.length === 0 ? (
          <p className="empty-state">No matches recorded yet.</p>
        ) : (
          sessionMatches.map((match, index) => (
            <MatchLogRow
              key={match.id}
              match={match}
              number={sessionMatches.length - index}
              state={store.state}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MatchLogRow({
  match,
  number,
  state,
}: {
  match: Match;
  number: number;
  state: TrackerState;
}) {
  const playerA = state.users.find((user) => user.id === match.playerAId)?.name ?? "Unknown";
  const playerB = state.users.find((user) => user.id === match.playerBId)?.name ?? "Unknown";
  return (
    <div className="match-log-row">
      <div>
        <strong>Match #{String(number).padStart(2, "0")}</strong>
        <span>
          {formatTime(match.createdAt)} - {playerA} vs {playerB}
          {match.score ? ` (${match.score})` : ""}
        </span>
      </div>
    </div>
  );
}

function PlayerMatchHistory({
  matches,
  state,
  playerId,
}: {
  matches: Match[];
  state: TrackerState;
  playerId: string;
}) {
  const player = state.users.find((user) => user.id === playerId);
  const playerMatches = matches.filter(
    (match) => match.playerAId === playerId || match.playerBId === playerId,
  );

  if (!player || playerMatches.length === 0) {
    return <p className="empty-state player-history-empty">No matches recorded for this player.</p>;
  }

  return (
    <div className="player-history">
      {playerMatches.map((match, index) => {
        const isPlayerA = match.playerAId === playerId;
        const opponentId = isPlayerA ? match.playerBId : match.playerAId;
        const opponent = state.users.find((user) => user.id === opponentId)?.name ?? "Unknown";
        const result = matchResult(match.score, isPlayerA);

        return (
          <article className="player-history-card" key={match.id}>
            <div className="match-card-top">
              <strong>Match #{String(playerMatches.length - index).padStart(2, "0")}</strong>
              <span>{formatTime(match.createdAt)}</span>
            </div>
            <p>
              <span>{player.name}</span>
              <b>{result}</b>
              <span>{opponent}</span>
            </p>
            <div className="history-meta">
              <span>Opponent: {opponent}</span>
              <span>Score: {match.score || "No score"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input inputMode="numeric" value={value ? value.toLocaleString("vi-VN") : ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function participantSessionRoles(state: TrackerState): Map<string, "host" | "player"> {
  return new Map(
    state.participants.map((participant) => [participant.sessionId, participant.role]),
  );
}

function generatePinCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function matchResult(score: string | undefined, isPlayerA: boolean): string {
  if (!score) return "Recorded";
  const [firstScore, secondScore] = score.split(/[-:]/).map((value) => Number(value.trim()));
  if (!Number.isFinite(firstScore) || !Number.isFinite(secondScore) || firstScore === secondScore) {
    return "Recorded";
  }
  const playerWon = isPlayerA ? firstScore > secondScore : secondScore > firstScore;
  return playerWon ? "Won" : "Lost";
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

function uniqueUserIdsByName(userIds: string[], users: User[]): string[] {
  const seenNames = new Set<string>();
  return userIds.filter((userId) => {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) return false;
    const key = user.name.trim().toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
}

function downloadSummary(session: Session, state: TrackerState) {
  const bills = playerBills({ session, users: state.users, roster: state.roster, matches: state.matches });
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 140 + bills.length * 74;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#f5efe3";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#14342b";
  context.font = "700 48px Georgia";
  context.fillText("Smash Tracker Billing", 48, 72);
  context.font = "28px Georgia";
  context.fillText(`${session.date} - ${formatVnd(session.feePerPerson)} / match`, 48, 116);

  bills.forEach((bill, index) => {
    const y = 188 + index * 74;
    context.fillStyle = index % 2 ? "#efe5d3" : "#fff8ea";
    context.fillRect(48, y - 42, 984, 58);
    context.fillStyle = "#14342b";
    context.font = "700 30px Georgia";
    context.fillText(bill.user.name, 72, y);
    context.font = "26px Georgia";
    context.fillText(`${bill.matchesPlayed} matches`, 420, y);
    context.fillText(formatVnd(bill.totalDue), 680, y);
    context.fillText(bill.paid ? "Paid" : "Unpaid", 900, y);
  });

  const link = document.createElement("a");
  link.download = `smash-tracker-${session.date}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
