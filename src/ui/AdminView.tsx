import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { presets } from "../data/defaults";
import { formatVnd, parseMoneyInput } from "../lib/money";
import type { DeletedSessionSnapshot } from "../lib/store";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, Info, Plus, ShuttleIcon, Trash2, X } from "./icons";
import {
  activeRosterCount,
  courtSharePerPlayer,
  playerBills,
  shuttleFeePerMatch,
} from "../lib/sessionMath";
import type { BillingMethod, Match, RosterEntry, Session, TrackerState, User } from "../types";
import { BillingStats } from "./admin/BillingStats";
import { ParticipantPanel } from "./admin/ParticipantPanel";
import { SessionInviteCard } from "./admin/SessionInviteCard";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type AdminViewProps = {
  slug: string;
  store: Store;
  initialSessionId?: string;
  initialCreate?: boolean;
  detailBackTo?: string;
  detailPlayerId?: string;
  detailHighlightMatchId?: string;
};

type SetupDraft = {
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
  billingMethod: BillingMethod;
};

const initialPreset = presets[0];
const setupPlayersStorageKey = "smash-tracker-setup-players-v1";
const setupRosterPrefsStorageKey = "smash-tracker-setup-roster-prefs-v1";
const setupMockUsers: User[] = [
  { id: "u-nhat", name: "Nhat", role: "Player", type: "Regular" },
  { id: "u-hung", name: "Hung", role: "Player", type: "Regular" },
  { id: "u-tuan", name: "Tuan", role: "Player", type: "Regular" },
  { id: "u-minh", name: "Minh", role: "Player", type: "Regular" },
  { id: "u-linh", name: "Linh", role: "Player", type: "Regular" },
];

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function runViewTransition(update: () => void) {
  const transition = (document as ViewTransitionDocument).startViewTransition?.(update);
  if (!transition) update();
}

export function AdminView({ slug, store, initialSessionId, initialCreate = false, detailBackTo, detailPlayerId, detailHighlightMatchId }: AdminViewProps) {
  const navigate = useNavigate();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId ?? null);
  const [isCreating, setIsCreating] = useState(initialCreate);
  const [transitionDirection, setTransitionDirection] = useState<"to-detail" | "to-list">("to-detail");
  const [deleteToast, setDeleteToast] = useState<DeletedSessionSnapshot | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(7);
  const deleteTimerRef = useRef<number | null>(null);
  const sessionRoles = participantSessionRoles(store.state);
  const activeSession = store.state.sessions.find(
    (session) => sessionRoles.has(session.id) && session.slug === slug && session.status === "Active",
  );
  const selectedSession = selectedSessionId
    ? store.state.sessions.find((session) => sessionRoles.has(session.id) && session.id === selectedSessionId)
    : undefined;
  const selectedRole = selectedSession ? sessionRoles.get(selectedSession.id) : undefined;

  useEffect(() => {
    setSelectedSessionId(initialSessionId ?? null);
  }, [initialSessionId]);

  useEffect(() => {
    if (initialCreate) setIsCreating(true);
  }, [initialCreate]);

  useEffect(
    () => () => {
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!deleteToast) return undefined;
    setDeleteCountdown(7);
    const intervalId = window.setInterval(() => {
      setDeleteCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [deleteToast]);

  function handleSessionCreated(sessionId: string) {
    setSelectedSessionId(sessionId);
    setIsCreating(false);
  }

  function openSession(sessionId: string) {
    setTransitionDirection("to-detail");
    runViewTransition(() => setSelectedSessionId(sessionId));
  }

  function closeSession() {
    if (detailBackTo) {
      navigate(detailBackTo);
      return;
    }
    setTransitionDirection("to-list");
    runViewTransition(() => setSelectedSessionId(null));
  }

  function scheduleSessionDelete(snapshot: DeletedSessionSnapshot) {
    if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    store.deleteSessionLocal(snapshot.session.id);
    setDeleteCountdown(7);
    setDeleteToast(snapshot);
    closeSession();
    deleteTimerRef.current = window.setTimeout(() => {
      store.deleteSessionRemote(snapshot.session.id);
      setDeleteToast(null);
      deleteTimerRef.current = null;
    }, 7000);
  }

  function undoSessionDelete() {
    if (!deleteToast) return;
    if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    store.restoreSession(deleteToast);
    openSession(deleteToast.session.id);
    setDeleteToast(null);
    deleteTimerRef.current = null;
  }

  const viewKey = selectedSession ? `detail-${selectedSession.id}` : "list";

  return (
    <>
      <div className={`screen-stack reports-${transitionDirection}`} key={viewKey}>
        {selectedSession ? (
          <div className="reports-detail-view">
            <button className="secondary-button detail-back-button" onClick={closeSession}>
              <ArrowLeft size={18} /> Back
            </button>
            <ActiveSessionDashboard
              session={selectedSession}
              role={selectedRole ?? "player"}
              store={store}
              onDeleted={scheduleSessionDelete}
              currentPlayerId={detailPlayerId}
              highlightMatchId={detailHighlightMatchId}
            />
          </div>
        ) : selectedSessionId && !store.isSyncing ? (
          <MissingAdminSessionState slug={slug} onBack={closeSession} />
        ) : (
          <div className="reports-list-view">
            <HeroCard slug={slug} activeSession={activeSession} />
            <SessionList
              state={store.state}
              slug={slug}
              sessionRoles={sessionRoles}
              isRemoteEnabled={store.isRemoteEnabled}
              onCreate={() => setIsCreating(true)}
              onSeedDefaultUsers={store.seedDefaultUsers}
              onSelect={openSession}
            />
          </div>
        )}
      </div>
      {isCreating ? (
        <SessionSetup
          slug={slug}
          store={store}
          onCancel={() => setIsCreating(false)}
          onSessionCreated={handleSessionCreated}
        />
      ) : null}
      {deleteToast ? (
        <DeletedSessionToast
          sessionName={sessionTitle(deleteToast.session)}
          remainingSeconds={deleteCountdown}
          onUndo={undoSessionDelete}
        />
      ) : null}
    </>
  );
}

function MissingAdminSessionState({ slug, onBack }: { slug: string; onBack: () => void }) {
  return (
    <div className="reports-detail-view">
      <button className="secondary-button detail-back-button" onClick={onBack}>
        <ArrowLeft size={18} /> Back
      </button>
      <section className="player-empty missing-session-state">
        <p className="eyebrow">Session unavailable</p>
        <h1>Session no longer exists.</h1>
        <p>This session is no longer in the database. It may have been deleted by the host.</p>
        <a className="secondary-button" href={`/${slug}/admin`}>
          Back to reports
        </a>
      </section>
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
  isRemoteEnabled,
  onCreate,
  onSeedDefaultUsers,
  onSelect,
}: {
  state: TrackerState;
  slug: string;
  sessionRoles: Map<string, "host" | "player">;
  isRemoteEnabled: boolean;
  onCreate: () => void;
  onSeedDefaultUsers: () => void;
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

      {isRemoteEnabled && state.users.length === 0 ? (
        <div className="seed-users-callout">
          <div>
            <strong>No players in this Supabase project yet.</strong>
            <span>Add the default player list only if this is your own project.</span>
          </div>
          <button type="button" className="secondary-button" onClick={onSeedDefaultUsers}>
            <Plus size={18} /> Seed players
          </button>
        </div>
      ) : null}

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
                <strong className="session-name-with-icon">
                  <ShuttleIcon className="shuttle-icon" size={17} />
                  <span>{sessionTitle(session)}</span>
                </strong>
                <span>
                  {session.date} - {formatVnd(shuttleFeePerMatch(session))} / match
                </span>
              </div>
              <span className="session-row-action">
                <span className={session.status === "Active" ? "session-status active" : "session-status"}>
                  {sessionRoles.get(session.id) === "host" ? session.status : "Joined"}
                </span>
                <ChevronRight size={18} aria-hidden="true" />
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
  const [selectedUsers, setSelectedUsers] = useState<string[]>(setupMockUsers.map((user) => user.id));
  const [hostUserIds, setHostUserIds] = useState<string[]>([]);
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [setupAddedUsers, setSetupAddedUsers] = useState<User[]>(() => readLocalSetupPlayers());
  const [guestName, setGuestName] = useState("");
  const [setupError, setSetupError] = useState("");
  const guestAddLock = useRef(false);
  const skipRosterPrefsWrite = useRef(true);
  const [draft, setDraft] = useState<SetupDraft>(() => ({ ...initialPreset, billingMethod: "standard" }));

  const setupUsers = uniqueUsersByName([...setupMockUsers, ...setupAddedUsers]);
  const setupPlayers = setupUsers.filter(
    (user) => !hiddenUserIds.includes(user.id) && !isHostPlaceholderUser(user),
  );

  useEffect(() => {
    const prefs = readSetupRosterPrefs(setupUsers);
    if (!prefs) return;
    setSelectedUsers(prefs.selectedUsers);
    setHostUserIds(prefs.hostUserIds);
    setHiddenUserIds(prefs.hiddenUserIds);
  }, []);

  useEffect(() => {
    if (skipRosterPrefsWrite.current) {
      skipRosterPrefsWrite.current = false;
      return;
    }
    writeSetupRosterPrefs({ selectedUsers, hostUserIds, hiddenUserIds });
  }, [selectedUsers, hostUserIds, hiddenUserIds]);

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId) ?? initialPreset;
    setSelectedPreset(preset.id);
    setDraft((current) => ({ ...preset, billingMethod: current.billingMethod }));
  }

  function updateNumber(field: keyof SetupDraft, value: string) {
    const numeric = field.includes("Price") ? parseMoneyInput(value) : Number(value);
    setDraft((current) => ({ ...current, [field]: Number.isFinite(numeric) ? numeric : 0 }));
  }

  function addGuest() {
    const trimmed = guestName.trim();
    if (!trimmed || guestAddLock.current) return;
    guestAddLock.current = true;

    const existingUser = setupUsers.find(
      (user) => user.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existingUser) {
      if (selectedUsers.includes(existingUser.id)) {
        setSetupError(`A player named ${existingUser.name} is already in this session.`);
        setGuestName("");
        guestAddLock.current = false;
        return;
      }
      setSelectedUsers((current) =>
        current.includes(existingUser.id) ? current : [...current, existingUser.id],
      );
      setHiddenUserIds((current) => current.filter((id) => id !== existingUser.id));
      setGuestName("");
      setSetupError("");
      guestAddLock.current = false;
      return;
    }

    const user: User = {
      id: `u-${crypto.randomUUID()}`,
      name: trimmed,
      role: "Player",
      type: "Temp",
    };
    setSetupAddedUsers((current) => {
      const next = uniqueUsersByName([...current, user]);
      writeLocalSetupPlayers(next);
      return next;
    });
    setSelectedUsers((current) => Array.from(new Set([...current, user.id])));
    setHiddenUserIds((current) => current.filter((id) => id !== user.id));
    setGuestName("");
    setSetupError("");
    window.setTimeout(() => {
      guestAddLock.current = false;
    }, 250);
  }

  function launchSession() {
    const sessionId = `s-${crypto.randomUUID()}`;
    const duplicateName = duplicateSelectedUserName(selectedUsers, setupUsers);
    if (duplicateName) {
      setSetupError(`A player named ${duplicateName} is already in this session.`);
      return;
    }
    const uniqueSelectedUsers = uniqueUserIdsByName(selectedUsers, setupUsers);
    const resolvedSetupUsers = resolveSetupUsersForSession(setupUsers, store.state.users);
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
      billingMethod: draft.billingMethod,
      status: "Active",
      createdAt: new Date().toISOString(),
    };
    const roster: RosterEntry[] = uniqueSelectedUsers.map((userId) => ({
      sessionId,
      userId: resolvedSetupUsers.get(userId)?.id ?? userId,
      paid: false,
      isPresent: true,
      isHost: hostUserIds.includes(userId),
    }));
    store.createSession(session, roster, uniqueUsersByName([...store.state.users, ...Array.from(resolvedSetupUsers.values())]));
    onSessionCreated(sessionId);
  }

  function removeSetupPlayer(userId: string) {
    setSelectedUsers((current) => current.filter((id) => id !== userId));
    setHostUserIds((current) => current.filter((id) => id !== userId));
    setSetupAddedUsers((current) => {
      const next = current.filter((user) => user.id !== userId);
      if (next.length !== current.length) writeLocalSetupPlayers(next);
      return next;
    });
    setHiddenUserIds((current) => (current.includes(userId) ? current : [...current, userId]));
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create new session">
      <section className="match-modal session-setup-modal panel setup-panel">
        <button type="button" className="close-button" onClick={onCancel} aria-label="Close">
          <X size={22} />
        </button>
      <div className="section-header">
        <div>
          <p className="eyebrow setup-eyebrow">
            Session setup <span className="step-badge">Step {step}/3</span>
          </p>
          <h2>Create new session</h2>
        </div>
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
          <MoneyField label="Court price" value={draft.courtPrice} onChange={(value) => updateNumber("courtPrice", value)} />
          <PresetDropdown value={selectedPreset} onChange={applyPreset} />
          <MoneyField label="Shuttle tube price" value={draft.shuttlePrice} onChange={(value) => updateNumber("shuttlePrice", value)} />
          <NumberField label="Shuttles per tube" value={draft.shuttlesPerTube} onChange={(value) => updateNumber("shuttlesPerTube", value)} />
          <NumberField label="Match duration" suffix="min" value={draft.matchDuration} onChange={(value) => updateNumber("matchDuration", value)} />
          <NumberField label="Total court time" suffix="min" value={draft.totalCourtTime} onChange={(value) => updateNumber("totalCourtTime", value)} />
          <label className="full-span">
            Billing method
            <BillingMethodDropdown
              value={draft.billingMethod}
              onChange={(billingMethod) => setDraft((current) => ({ ...current, billingMethod }))}
            />
          </label>
          <div className="billing-method-note full-span">
            <Info size={16} />
            <span>Standard splits court by present players and shuttle by each match. Casual pools all costs by matches played.</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="roster-list">
          {setupError ? <p className="form-error">{setupError}</p> : null}
          {setupPlayers.map((user) => {
            const isSelected = selectedUsers.includes(user.id);
            return (
              <div className="roster-row" key={user.id}>
                <div
                  className={isSelected ? "roster-check selected" : "roster-check"}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setSelectedUsers((current) => {
                      if (current.includes(user.id)) {
                        setHostUserIds((hosts) => hosts.filter((id) => id !== user.id));
                        return current.filter((id) => id !== user.id);
                      }
                      return Array.from(new Set([...current, user.id]));
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedUsers((current) => {
                        if (current.includes(user.id)) {
                          setHostUserIds((hosts) => hosts.filter((id) => id !== user.id));
                          return current.filter((id) => id !== user.id);
                        }
                        return Array.from(new Set([...current, user.id]));
                      });
                    }
                  }}
                >
                  <div className="roster-card-content">
                    <div className="roster-name-cell">
                      <span className="setup-player-check" aria-hidden="true">
                        {isSelected ? <Check size={16} /> : null}
                      </span>
                      <span>{user.name}</span>
                    </div>
                    <label className="setup-host-toggle setup-host-radio" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="radio"
                        name="session-host"
                        checked={hostUserIds.includes(user.id)}
                        disabled={!isSelected}
                        onChange={() =>
                          setHostUserIds([user.id])
                        }
                      />
                      <span className="radio-dot" aria-hidden="true" />
                      Host
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button roster-remove-button"
                  aria-label={`Remove ${user.name} from this session`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeSetupPlayer(user.id);
                  }}
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
          <p>{uniqueUserIdsByName(selectedUsers, setupUsers).length} players selected</p>
          <strong>{formatVnd(draft.courtPrice)} total court money</strong>
          <span>
            Max matches: {Math.floor(draft.totalCourtTime / draft.matchDuration)} from{" "}
            {draft.totalCourtTime} court-minutes.
          </span>
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => (step === 1 ? onCancel() : setStep((current) => current - 1))}
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < 3 ? (
          <button type="button" className="primary-button" onClick={() => setStep((current) => current + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={selectedUsers.length < 2} onClick={launchSession}>
            Start session
          </button>
        )}
      </div>
      </section>
    </div>,
    document.body,
  );
}

function ActiveSessionDashboard({
  session,
  role,
  store,
  onDeleted,
  currentPlayerId,
  highlightMatchId,
}: {
  session: Session;
  role: "host" | "player";
  store: Store;
  onDeleted: (snapshot: DeletedSessionSnapshot) => void;
  currentPlayerId?: string;
  highlightMatchId?: string;
}) {
  const isHost = role === "host";
  const [isEndConfirmOpen, setIsEndConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
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

  return (
    <section className="panel report-detail-panel">
      <div className="section-header">
        <div>
          <h2 className="session-name-with-icon">
            <ShuttleIcon className="shuttle-icon" size={20} />
            <span>{sessionTitle(session)}</span>
          </h2>
        </div>
        <div className="header-actions">
          {isHost && session.status === "Active" ? (
            <button className="danger-button" onClick={() => setIsEndConfirmOpen(true)}>
              End session
            </button>
          ) : null}
        </div>
      </div>

      {session.status === "Active" ? <SessionInviteCard session={session} store={store} /> : null}

      <ParticipantPanel
        session={session}
        store={store}
        sessionMatches={sessionMatches}
        isHost={isHost}
        currentPlayerId={currentPlayerId}
        highlightMatchId={highlightMatchId}
      />
      <BillingSettings
        isHost={isHost}
        method={session.billingMethod ?? "standard"}
        onChange={(billingMethod) => store.updateBillingMethod(session.id, billingMethod)}
      />

      <BillingStats
        session={session}
        state={store.state}
        store={store}
        isHost={isHost}
        sessionMatches={sessionMatches}
        totalDue={totalDue}
        collected={collected}
      />
      <div className="table-card master-log-card">
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

      {isHost ? (
        <div className="table-card delete-session-zone">
          <div>
            <h3>Delete session</h3>
            <p>This removes the session, participants, and match records from Supabase.</p>
          </div>
          <button type="button" className="danger-button" onClick={() => setIsDeleteConfirmOpen(true)}>
            <Trash2 size={18} /> Delete session
          </button>
        </div>
      ) : null}

      {isEndConfirmOpen ? (
        <ConfirmEndSessionModal
          sessionName={sessionTitle(session)}
          onCancel={() => setIsEndConfirmOpen(false)}
          onConfirm={() => {
            store.endSession(session.id);
            setIsEndConfirmOpen(false);
          }}
        />
      ) : null}
      {isDeleteConfirmOpen ? (
        <ConfirmSessionDeleteModal
          sessionName={sessionTitle(session)}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          onConfirm={() => {
            setIsDeleteConfirmOpen(false);
            onDeleted(snapshotSessionForDelete(session, store.state));
          }}
        />
      ) : null}
    </section>
  );
}

function BillingSettings({
  isHost,
  method,
  onChange,
}: {
  isHost: boolean;
  method: BillingMethod;
  onChange: (method: BillingMethod) => void;
}) {
  return (
    <div className="table-card billing-settings-card">
      <div>
        <p className="eyebrow">Billing settings</p>
        <h3>{billingMethodTitle(method)}</h3>
        <span>{billingMethodDescription(method)}</span>
      </div>
      {isHost ? (
        <BillingMethodDropdown value={method} onChange={onChange} compact />
      ) : (
        <span className="billing-method-chip">Method: {billingMethodShortLabel(method)}</span>
      )}
    </div>
  );
}

function BillingMethodDropdown({
  value,
  onChange,
  compact = false,
}: {
  value: BillingMethod;
  onChange: (method: BillingMethod) => void;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const options: { value: BillingMethod; label: string }[] = [
    { value: "standard", label: "Standard (Fixed Court + Per Match)" },
    { value: "casual", label: "Casual (Pooled/Proportional)" },
  ];
  const selectedLabel = options.find((option) => option.value === value)?.label ?? options[0].label;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className={compact ? "custom-select billing-method-dropdown compact" : "custom-select billing-method-dropdown"} ref={dropdownRef}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={18} />
      </button>
      {isOpen ? (
        <div className="custom-select-menu" role="listbox" aria-label="Billing method">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                type="button"
                className={isSelected ? "custom-select-option selected" : "custom-select-option"}
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={17} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DeletedSessionToast({
  sessionName,
  remainingSeconds,
  onUndo,
}: {
  sessionName: string;
  remainingSeconds: number;
  onUndo: () => void;
}) {
  return createPortal(
    <div className="undo-toast" role="status" aria-live="polite">
      <div>
        <strong>The session has been deleted.</strong>
        <span>
          <span className="session-name-with-icon inline-session-name">
            <ShuttleIcon className="shuttle-icon" size={15} />
            <span>{sessionName}</span>
          </span>{" "}
          will be permanently deleted in {remainingSeconds}s.
        </span>
      </div>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>,
    document.body,
  );
}

function ConfirmSessionDeleteModal({
  sessionName,
  onCancel,
  onConfirm,
}: {
  sessionName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm delete session">
      <div className="confirm-modal">
        <p className="eyebrow">Delete session</p>
        <h2>Delete this session?</h2>
        <p>
          <span className="session-name-with-icon inline-session-name">
            <ShuttleIcon className="shuttle-icon" size={16} />
            <span>{sessionName}</span>
          </span>{" "}
          will disappear now. You can undo for 7 seconds before it is removed from Supabase.
        </p>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            Delete session
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConfirmEndSessionModal({
  sessionName,
  onCancel,
  onConfirm,
}: {
  sessionName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm end session">
      <div className="confirm-modal">
        <p className="eyebrow">End session</p>
        <h2>Close this session?</h2>
        <p>
          <span className="session-name-with-icon inline-session-name">
            <ShuttleIcon className="shuttle-icon" size={16} />
            <span>{sessionName}</span>
          </span>{" "}
          will be marked closed and players can no longer record new matches.
        </p>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            End session
          </button>
        </div>
      </div>
    </div>,
    document.body,
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

function PresetDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (presetId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedPresetName = presets.find((preset) => preset.id === value)?.name ?? "Select preset";

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <label>
      Preset
      <div className="custom-select" ref={dropdownRef}>
        <button
          type="button"
          className="custom-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span>{selectedPresetName}</span>
          <ChevronDown size={18} />
        </button>
        {isOpen ? (
          <div className="custom-select-menu" role="listbox" aria-label="Preset">
            {presets.map((preset) => {
              const isSelected = preset.id === value;
              return (
                <button
                  type="button"
                  className={isSelected ? "custom-select-option selected" : "custom-select-option"}
                  key={preset.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(preset.id);
                    setIsOpen(false);
                  }}
                >
                  <span>{preset.name}</span>
                  {isSelected ? <Check size={17} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <span className="input-with-suffix">
        <input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span>{suffix}</span> : null}
      </span>
    </label>
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

function billingMethodTitle(method: BillingMethod): string {
  return method === "casual" ? "Casual billing" : "Standard billing";
}

function billingMethodShortLabel(method: BillingMethod): string {
  return method === "casual" ? "Pay-per-play" : "Standard";
}

function billingMethodDescription(method: BillingMethod): string {
  return method === "casual"
    ? "All court and shuttle costs are pooled, then split by each player match."
    : "Court is split by present players. Shuttle is split only by players in each match.";
}

function participantSessionRoles(state: TrackerState): Map<string, "host" | "player"> {
  return new Map(
    state.participants.map((participant) => [participant.sessionId, participant.role]),
  );
}

function snapshotSessionForDelete(session: Session, state: TrackerState): DeletedSessionSnapshot {
  return {
    session,
    roster: state.roster.filter((entry) => entry.sessionId === session.id),
    participants: state.participants.filter((participant) => participant.sessionId === session.id),
    matches: state.matches.filter((match) => match.sessionId === session.id),
  };
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

function isHostPlaceholderUser(user: User): boolean {
  return user.name.trim().toLowerCase() === "host";
}

function readLocalSetupPlayers(): User[] {
  try {
    const raw = localStorage.getItem(setupPlayersStorageKey);
    if (!raw) return [];
    const users = JSON.parse(raw) as User[];
    if (!Array.isArray(users)) return [];
    return users.filter((user) => user?.id && user?.name?.trim());
  } catch {
    return [];
  }
}

function writeLocalSetupPlayers(users: User[]) {
  localStorage.setItem(setupPlayersStorageKey, JSON.stringify(users));
}

type SetupRosterPrefs = {
  selectedUsers: string[];
  hostUserIds: string[];
  hiddenUserIds: string[];
};

function readSetupRosterPrefs(users: User[]): SetupRosterPrefs | null {
  try {
    const raw = localStorage.getItem(setupRosterPrefsStorageKey);
    if (!raw) return null;
    const prefs = JSON.parse(raw) as SetupRosterPrefs;
    const validUserIds = new Set(users.map((user) => user.id));
    return {
      selectedUsers: Array.isArray(prefs.selectedUsers)
        ? prefs.selectedUsers.filter((id) => validUserIds.has(id))
        : [],
      hostUserIds: Array.isArray(prefs.hostUserIds)
        ? prefs.hostUserIds.filter((id) => validUserIds.has(id)).slice(0, 1)
        : [],
      hiddenUserIds: Array.isArray(prefs.hiddenUserIds)
        ? prefs.hiddenUserIds.filter((id) => validUserIds.has(id))
        : [],
    };
  } catch {
    return null;
  }
}

function writeSetupRosterPrefs(prefs: SetupRosterPrefs) {
  localStorage.setItem(setupRosterPrefsStorageKey, JSON.stringify(prefs));
}

function duplicateSelectedUserName(userIds: string[], users: User[]): string | undefined {
  const seenNames = new Set<string>();
  for (const userId of userIds) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) continue;
    const key = user.name.trim().toLowerCase();
    if (seenNames.has(key)) return user.name;
    seenNames.add(key);
  }
  return undefined;
}

function resolveSetupUsersForSession(setupUsers: User[], existingUsers: User[]): Map<string, User> {
  const existingByName = new Map(existingUsers.map((user) => [user.name.trim().toLowerCase(), user]));
  return new Map(
    setupUsers.map((user) => [
      user.id,
      existingByName.get(user.name.trim().toLowerCase()) ?? user,
    ]),
  );
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
  context.fillText(
    `${session.date} - ${activeRosterCount(state.roster, session.id)} active - ${formatVnd(courtSharePerPlayer(session, state.roster))} court share`,
    48,
    116,
  );

  bills.forEach((bill, index) => {
    const y = 188 + index * 74;
    context.fillStyle = index % 2 ? "#efe5d3" : "#fff8ea";
    context.fillRect(48, y - 42, 984, 58);
    context.fillStyle = "#14342b";
    context.font = "700 30px Georgia";
    context.fillText(bill.user.name, 72, y);
    context.font = "26px Georgia";
    context.fillText(`${bill.isPresent ? "Present" : "No-show"} / ${bill.matchesPlayed} matches`, 360, y);
    context.fillText(formatVnd(bill.totalDue), 680, y);
    context.fillText(bill.paid ? "Paid" : "Unpaid", 900, y);
  });

  const link = document.createElement("a");
  link.download = `smash-tracker-${session.date}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}



