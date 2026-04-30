import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Download, Info, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { presets } from "../data/defaults";
import { formatVnd, parseMoneyInput } from "../lib/money";
import type { DeletedSessionSnapshot } from "../lib/store";
import {
  activeRosterCount,
  calculateFee,
  casualUnitPrice,
  courtSharePerPlayer,
  maxMatches,
  playerBills,
  shuttleFeePerMatch,
} from "../lib/sessionMath";
import type { BillingMethod, Match, RosterEntry, Session, TrackerState, User } from "../types";

type Store = ReturnType<typeof import("../lib/store").useTrackerStore>;

type AdminViewProps = {
  slug: string;
  store: Store;
  initialSessionId?: string;
  initialCreate?: boolean;
  detailBackTo?: string;
  detailPlayerId?: string;
};

type SetupDraft = {
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
  feePerPerson: number;
  billingMethod: BillingMethod;
};

const initialPreset = presets[0];

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function runViewTransition(update: () => void) {
  const transition = (document as ViewTransitionDocument).startViewTransition?.(update);
  if (!transition) update();
}

export function AdminView({ slug, store, initialSessionId, initialCreate = false, detailBackTo, detailPlayerId }: AdminViewProps) {
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
                <strong>{sessionTitle(session)}</strong>
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
  const [selectedUsers, setSelectedUsers] = useState<string[]>(
    uniqueUsersByName(
      store.state.users.filter((user) => user.type === "Regular"),
    ).map((u) => u.id),
  );
  const [hostUserIds, setHostUserIds] = useState<string[]>([]);
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [setupAddedUsers, setSetupAddedUsers] = useState<User[]>([]);
  const [guestName, setGuestName] = useState("");
  const [setupError, setSetupError] = useState("");
  const guestAddLock = useRef(false);
  const [draft, setDraft] = useState<SetupDraft>(() => {
    const feePerPerson = calculateFee(initialPreset);
    return { ...initialPreset, feePerPerson, billingMethod: "standard" };
  });

  const computedFee = calculateFee(draft);
  const setupUsers = uniqueUsersByName([...store.state.users, ...setupAddedUsers]);
  const setupPlayers = setupUsers.filter(
    (user) => !hiddenUserIds.includes(user.id),
  );

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId) ?? initialPreset;
    setSelectedPreset(preset.id);
    setDraft((current) => ({ ...preset, feePerPerson: calculateFee(preset), billingMethod: current.billingMethod }));
  }

  function updateNumber(field: keyof SetupDraft, value: string) {
    const numeric = field.includes("Price") || field === "feePerPerson" ? parseMoneyInput(value) : Number(value);
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
    setSetupAddedUsers((current) => [...current, user]);
    store.addUser(user);
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
      billingMethod: draft.billingMethod,
      status: "Active",
      createdAt: new Date().toISOString(),
    };
    const roster: RosterEntry[] = uniqueSelectedUsers.map((userId) => ({
      sessionId,
      userId,
      paid: false,
      isPresent: true,
      isHost: hostUserIds.includes(userId),
    }));
    store.createSession(session, roster, setupUsers);
    onSessionCreated(sessionId);
  }

  function removeSetupPlayer(userId: string) {
    setSelectedUsers((current) => current.filter((id) => id !== userId));
    setHostUserIds((current) => current.filter((id) => id !== userId));
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
          <MoneyField label="Fee per person override" value={draft.feePerPerson} onChange={(value) => updateNumber("feePerPerson", value)} />
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
          <div className="formula-card">
            <strong>{formatVnd(computedFee)}</strong>
            <span>Calculated fee per person per match</span>
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
          <strong>{formatVnd(draft.feePerPerson || computedFee)} per person / match</strong>
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
}: {
  session: Session;
  role: "host" | "player";
  store: Store;
  onDeleted: (snapshot: DeletedSessionSnapshot) => void;
  currentPlayerId?: string;
}) {
  const isHost = role === "host";
  const shareLink = `${window.location.origin}/${session.slug}/session/${session.id}`;
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [isCopyTipVisible, setIsCopyTipVisible] = useState(false);
  const [isPinCopyTipVisible, setIsPinCopyTipVisible] = useState(false);
  const [isCourtPriceEditing, setIsCourtPriceEditing] = useState(false);
  const [courtPriceDraft, setCourtPriceDraft] = useState(() => formatVnd(session.courtPrice));
  const [isMatchDurationEditing, setIsMatchDurationEditing] = useState(false);
  const [matchDurationDraft, setMatchDurationDraft] = useState(() => String(session.matchDuration));
  const [isTotalCourtTimeEditing, setIsTotalCourtTimeEditing] = useState(false);
  const [totalCourtTimeDraft, setTotalCourtTimeDraft] = useState(() => String(session.totalCourtTime));
  const [isTotalMatchesEditing, setIsTotalMatchesEditing] = useState(false);
  const [totalMatchesDraft, setTotalMatchesDraft] = useState(() => formatStatNumber(maxMatches(session)));
  const [isEndConfirmOpen, setIsEndConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [participantName, setParticipantName] = useState("");
  const [pendingRemovedPlayerIds, setPendingRemovedPlayerIds] = useState<string[]>([]);
  const [collapsingRemovedPlayerIds, setCollapsingRemovedPlayerIds] = useState<string[]>([]);
  const removePlayerTimersRef = useRef<Record<string, number>>({});
  const collapsePlayerTimersRef = useRef<Record<string, number>>({});
  const bills = playerBills({
    session,
    users: store.state.users,
    roster: store.state.roster,
    matches: store.state.matches,
  });
  const activeCount = activeRosterCount(store.state.roster, session.id);
  const courtShare = courtSharePerPlayer(session, store.state.roster);
  const fixedPricePerMatch = casualUnitPrice(session, store.state.matches);
  const shuttleFee = shuttleFeePerMatch(session);
  const sessionMatches = store.state.matches
    .filter((match) => match.sessionId === session.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const duplicateRosterNames = duplicateSessionRosterNames(session.id, store.state);
  const totalDue = bills.reduce((sum, bill) => sum + bill.totalDue, 0);
  const collected = bills.filter((bill) => bill.paid).reduce((sum, bill) => sum + bill.totalDue, 0);
  const sessionCost = session.courtPrice + (sessionMatches.length * session.shuttlePrice) / session.shuttlesPerTube;

  async function copyShareText() {
    await navigator.clipboard.writeText(shareLink);
    setIsCopyTipVisible(true);
    window.setTimeout(() => setIsCopyTipVisible(false), 1800);
  }

  async function copyPinCode() {
    if (!session.pinCode) return;
    await navigator.clipboard.writeText(session.pinCode);
    setIsPinCopyTipVisible(true);
    window.setTimeout(() => setIsPinCopyTipVisible(false), 1800);
  }

  useEffect(() => {
    if (!isCourtPriceEditing) setCourtPriceDraft(formatVnd(session.courtPrice));
  }, [isCourtPriceEditing, session.courtPrice]);

  useEffect(() => {
    if (!isMatchDurationEditing) setMatchDurationDraft(String(session.matchDuration));
  }, [isMatchDurationEditing, session.matchDuration]);

  useEffect(() => {
    if (!isTotalCourtTimeEditing) setTotalCourtTimeDraft(String(session.totalCourtTime));
  }, [isTotalCourtTimeEditing, session.totalCourtTime]);

  useEffect(() => {
    if (!isTotalMatchesEditing) setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
  }, [isTotalMatchesEditing, session]);

  useEffect(
    () => () => {
      Object.values(removePlayerTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      Object.values(collapsePlayerTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    },
    [],
  );

  function submitCourtPrice() {
    const nextCourtPrice = parseCourtMoneyInput(courtPriceDraft);
    if (nextCourtPrice <= 0) {
      setCourtPriceDraft(formatVnd(session.courtPrice));
      setIsCourtPriceEditing(false);
      return;
    }
    store.updateCourtPrice(session.id, nextCourtPrice);
    setCourtPriceDraft(formatVnd(nextCourtPrice));
    setIsCourtPriceEditing(false);
  }

  function submitMatchDuration() {
    const nextMatchDuration = Number(matchDurationDraft);
    if (!Number.isFinite(nextMatchDuration) || nextMatchDuration <= 0) {
      setMatchDurationDraft(String(session.matchDuration));
      setIsMatchDurationEditing(false);
      return;
    }
    store.updateMatchDuration(session.id, nextMatchDuration);
    setMatchDurationDraft(String(nextMatchDuration));
    setIsMatchDurationEditing(false);
  }

  function submitTotalCourtTime() {
    const nextTotalCourtTime = Number(totalCourtTimeDraft);
    if (!Number.isFinite(nextTotalCourtTime) || nextTotalCourtTime <= 0) {
      setTotalCourtTimeDraft(String(session.totalCourtTime));
      setIsTotalCourtTimeEditing(false);
      return;
    }
    store.updateTotalCourtTime(session.id, nextTotalCourtTime);
    setTotalCourtTimeDraft(String(nextTotalCourtTime));
    setIsTotalCourtTimeEditing(false);
  }

  function submitTotalMatches() {
    const nextTotalMatches = Number(totalMatchesDraft);
    if (!Number.isFinite(nextTotalMatches) || nextTotalMatches <= 0) {
      setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
      setIsTotalMatchesEditing(false);
      return;
    }
    const nextMatchDuration = Number((session.totalCourtTime / nextTotalMatches).toFixed(2));
    store.updateMatchDuration(session.id, nextMatchDuration);
    setTotalMatchesDraft(formatStatNumber(nextTotalMatches));
    setIsTotalMatchesEditing(false);
  }

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

  function scheduleRemovePlayer(userId: string) {
    const bill = bills.find((candidate) => candidate.user.id === userId);
    if (bill?.isHost || pendingRemovedPlayerIds.includes(userId)) return;
    if (pendingRemovedPlayerIds.includes(userId)) return;
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
    <section className="panel report-detail-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            {session.status} session since {formatTime(session.createdAt)}
          </p>
          <h2>{sessionTitle(session)}</h2>
        </div>
        <div className="header-actions">
          {isHost && session.status === "Active" ? (
            <button className="danger-button" onClick={() => setIsEndConfirmOpen(true)}>
              End session
            </button>
          ) : null}
        </div>
      </div>

      {session.status === "Active" ? (
        <div className="share-card">
          <div className="share-card-main">
            <p className="eyebrow">Share session</p>
            <h3>Player join link</h3>
            <p>{shareLink}</p>
            <div className="copy-action">
              {isCopyTipVisible ? <div className="copy-tooltip">Copied link</div> : null}
              <button className="secondary-button" onClick={copyShareText}>
                <Copy size={18} /> Copy link
              </button>
            </div>
          </div>
          <img
            className="share-qr"
            alt="Session QR code"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareLink)}`}
          />
          <div className="share-meta">
            {session.pinCode ? (
              <div className="pin-copy-wrap">
                {isPinCopyTipVisible ? <div className="copy-tooltip">Copied PIN</div> : null}
                <div className="pin-chip">PIN {session.pinCode}</div>
                <button type="button" className="pin-copy-button" onClick={copyPinCode} aria-label="Copy PIN code">
                  <Copy size={15} />
                </button>
              </div>
            ) : null}
            <small>{store.isRemoteEnabled ? "Supabase sync enabled." : "Local mode only."}</small>
            {store.syncError ? <small>Sync issue: {store.syncError}</small> : null}
          </div>
        </div>
      ) : null}

      <div className="table-card leaderboard-card">
        <div className="leaderboard-header">
          <h3>Participants</h3>
          <div className="participant-stats">
            <span>{activeCount} present</span>
            <span>
              {session.billingMethod === "casual" ? "Fixed Price/match" : "Court share"}{" "}
              {formatVnd(session.billingMethod === "casual" ? fixedPricePerMatch : courtShare)}
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
        {bills.map((bill) => {
          const isPendingRemoval = pendingRemovedPlayerIds.includes(bill.user.id);
          const isCollapsingRemoval = collapsingRemovedPlayerIds.includes(bill.user.id);
          const isCurrentPlayer = Boolean(currentPlayerId && bill.userIds.includes(currentPlayerId));
          return (
          <div
            className={[
              "leaderboard-player",
              bill.isPresent ? "" : "not-present",
              isCurrentPlayer ? "current-player" : "",
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
                  {bill.isPresent ? "" : "No-show · "}
                  {bill.matchesPlayed} matches · <strong className="leader-row-amount">{formatVnd(bill.totalDue)}</strong>
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
              <PlayerMatchHistory matches={sessionMatches} state={store.state} playerId={bill.user.id} />
            ) : null}
          </div>
          );
        })}
      </div>

      <BillingSettings
        isHost={isHost}
        method={session.billingMethod ?? "standard"}
        onChange={(billingMethod) => store.updateBillingMethod(session.id, billingMethod)}
      />

      <div className="metric-grid report-stats-grid">
        <CourtPriceMetric
          isHost={isHost}
          value={session.courtPrice}
          captionLabel={session.billingMethod === "casual" ? "Fixed price/match" : "Court share/person"}
          captionValue={session.billingMethod === "casual" ? fixedPricePerMatch : courtShare}
          draft={courtPriceDraft}
          isEditing={isCourtPriceEditing}
          onDraftChange={setCourtPriceDraft}
          onEdit={() => setIsCourtPriceEditing(true)}
          onCancel={() => {
            setCourtPriceDraft(formatVnd(session.courtPrice));
            setIsCourtPriceEditing(false);
          }}
          onSubmit={submitCourtPrice}
        />
        <EditableNumberMetric
          isHost={isHost}
          label="Total matches"
          value={maxMatches(session)}
          draft={totalMatchesDraft}
          isEditing={isTotalMatchesEditing}
          onDraftChange={setTotalMatchesDraft}
          onEdit={() => setIsTotalMatchesEditing(true)}
          onCancel={() => {
            setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
            setIsTotalMatchesEditing(false);
          }}
          onSubmit={submitTotalMatches}
        />
        <Metric label="Shuttle Cost / Match" value={formatVnd(shuttleFee)} />
        <MatchDurationMetric
          isHost={isHost}
          value={session.matchDuration}
          draft={matchDurationDraft}
          isEditing={isMatchDurationEditing}
          onDraftChange={setMatchDurationDraft}
          onEdit={() => setIsMatchDurationEditing(true)}
          onCancel={() => {
            setMatchDurationDraft(String(session.matchDuration));
            setIsMatchDurationEditing(false);
          }}
          onSubmit={submitMatchDuration}
        />
        <EditableMinuteMetric
          isHost={isHost}
          label="Total court time"
          value={session.totalCourtTime}
          draft={totalCourtTimeDraft}
          isEditing={isTotalCourtTimeEditing}
          onDraftChange={setTotalCourtTimeDraft}
          onEdit={() => setIsTotalCourtTimeEditing(true)}
          onCancel={() => {
            setTotalCourtTimeDraft(String(session.totalCourtTime));
            setIsTotalCourtTimeEditing(false);
          }}
          onSubmit={submitTotalCourtTime}
        />
        <Metric label="Matches logged" value={`${sessionMatches.length}/${formatStatNumber(maxMatches(session))}`} />
        <Metric label="Collected" value={formatVnd(collected)} />
        <Metric label="Profit / loss" value={formatVnd(totalDue - sessionCost)} />
      </div>

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
        <span>{sessionName} will be permanently deleted in {remainingSeconds}s.</span>
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
        <p>{sessionName} will disappear now. You can undo for 7 seconds before it is removed from Supabase.</p>
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
        <p>{sessionName} will be marked closed and players can no longer record new matches.</p>
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
              <b className={`match-result-${result.toLowerCase()}`}>{result}</b>
              <span>{opponent}</span>
            </p>
            <div className="history-meta">
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

function CourtPriceMetric({
  isHost,
  value,
  captionLabel,
  captionValue,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  value: number;
  captionLabel: string;
  captionValue: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!isHost) {
    return (
      <div className="metric-card court-price-card">
        <span>Total court money</span>
        <strong>{formatVnd(value)}</strong>
        <small className="metric-caption">{captionLabel}: {formatVnd(captionValue)}</small>
      </div>
    );
  }

  return (
    <div className="metric-card court-price-card">
      <span>Total court money</span>
      {isEditing ? (
        <form
          className="court-price-editor"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            autoFocus
            inputMode="decimal"
            value={draft}
            placeholder="1.5*120000"
            onChange={(event) => onDraftChange(event.target.value.replace(/[^\d.*\s]/g, ""))}
            onBlur={onSubmit}
          />
          <button type="submit">Save</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="court-price-display" onClick={onEdit}>
          <span>
            <strong>{formatVnd(value)}</strong>
            <small className="metric-caption">{captionLabel}: {formatVnd(captionValue)}</small>
          </span>
          <small>Edit</small>
        </button>
      )}
    </div>
  );
}

function EditableNumberMetric({
  isHost,
  label,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  label: string;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!isHost) return <Metric label={label} value={formatStatNumber(value)} />;

  return (
    <div className="metric-card court-price-card">
      <span>{label}</span>
      {isEditing ? (
        <form
          className="court-price-editor"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value.replace(/[^\d.]/g, ""))}
            onBlur={onSubmit}
          />
          <button type="submit">Save</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="court-price-display" onClick={onEdit}>
          <strong>{formatStatNumber(value)}</strong>
          <small>Edit</small>
        </button>
      )}
    </div>
  );
}

function MatchDurationMetric({
  isHost,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <EditableMinuteMetric
      isHost={isHost}
      label="Match duration"
      value={value}
      draft={draft}
      isEditing={isEditing}
      onDraftChange={onDraftChange}
      onEdit={onEdit}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

function EditableMinuteMetric({
  isHost,
  label,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  label: string;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!isHost) return <Metric label={label} value={formatMinutesWithHours(value)} />;

  return (
    <div className="metric-card court-price-card">
      <span>{label}</span>
      {isEditing ? (
        <form
          className="court-price-editor"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value.replace(/\D/g, ""))}
            onBlur={onSubmit}
          />
          <button type="submit">Save</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="court-price-display" onClick={onEdit}>
          <strong>{formatMinutesWithHours(value)}</strong>
          <small>Edit</small>
        </button>
      )}
    </div>
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

function formatStatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatMinutesWithHours(minutes: number): string {
  const formattedMinutes = `${formatStatNumber(minutes)} min`;
  if (!Number.isFinite(minutes) || minutes <= 0) return formattedMinutes;
  const hours = minutes / 60;
  const hourLabel = hours === 1 ? "hour" : "hours";
  return `${formattedMinutes} - ${formatStatNumber(hours)} ${hourLabel}`;
}

function parseCourtMoneyInput(value: string): number {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) return 0;

  if (normalized.includes("*")) {
    const parts = normalized.split("*");
    if (parts.length !== 2) return 0;
    const hours = Number(parts[0]);
    const hourlyPrice = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(hourlyPrice)) return 0;
    return Math.round(hours * hourlyPrice);
  }

  return parseMoneyInput(value);
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

function duplicateSessionRosterNames(sessionId: string, state: TrackerState): string[] {
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();
  state.roster
    .filter((entry) => entry.sessionId === sessionId)
    .forEach((entry) => {
      const user = state.users.find((candidate) => candidate.id === entry.userId);
      if (!user) return;
      const key = user.name.trim().toLowerCase();
      if (seenNames.has(key)) duplicateNames.add(user.name);
      seenNames.add(key);
    });
  return Array.from(duplicateNames);
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
