import { useEffect, useRef, useState } from "react";
import { defaultState } from "../data/defaults";
import {
  isRemoteEnabled,
  loadRemoteState,
  remoteAddActivity,
  remoteAddMatch,
  remoteAddUser,
  remoteClaimSessionAccess,
  remoteCreateSession,
  remoteDeleteSession,
  remoteDeleteMatch,
  remoteEndSession,
  remoteGetSessionLinkStatus,
  remoteGetSessionPublicInfo,
  remoteJoinSession,
  remoteRemoveSessionPlayers,
  remoteSetPaid,
  remoteSetPresent,
  remoteUpdateMatchScore,
  remoteUpdateMatchStake,
  remoteUpdateBillingMethod,
  remoteUpdateCourtPrice,
  remoteUpdateMatchDuration,
  remoteUpdateTotalCourtTime,
  remoteVerifySessionPin,
  seedDefaultUsers as remoteSeedDefaultUsers,
  subscribeRemoteChanges,
} from "./remoteStore";
import type { BillingMethod, Match, RosterEntry, Session, SessionActivity, SessionActivityType, SessionParticipant, SessionStatus, TrackerState, User } from "../types";

const storageKey = "smash-tracker-state-v1";
const channelName = "smash-tracker-sync";
const closedStatus: SessionStatus = "Closed";

export type DeletedSessionSnapshot = {
  session: Session;
  roster: RosterEntry[];
  participants: SessionParticipant[];
  matches: Match[];
  activities: SessionActivity[];
};

function readState(): TrackerState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return defaultState;

  try {
    return normalizeState({ ...defaultState, ...JSON.parse(raw) } as TrackerState);
  } catch {
    return defaultState;
  }
}

function writeState(nextState: TrackerState) {
  localStorage.setItem(storageKey, JSON.stringify(nextState));
}

export function useTrackerStore() {
  const [state, setState] = useState<TrackerState>(() => readState());
  const [isSyncing, setIsSyncing] = useState(isRemoteEnabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingRemoteWriteCount, setPendingRemoteWriteCount] = useState(0);
  const stateRef = useRef(state);
  const pendingRemoteWrites = useRef(0);
  const softDeletedSessionIds = useRef(new Set<string>());
  const softDeletedSessionSnapshots = useRef(new Map<string, DeletedSessionSnapshot>());

  useEffect(() => {
    stateRef.current = state;
    writeState(state);
  }, [state]);

  useEffect(() => {
    if (isRemoteEnabled) return;

    const channel = "BroadcastChannel" in window ? new BroadcastChannel(channelName) : null;

    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setState(readState());
    };

    channel?.addEventListener("message", () => setState(readState()));
    window.addEventListener("storage", handleStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!isRemoteEnabled) return;

    let isMounted = true;

    async function refreshRemoteState() {
      if (pendingRemoteWrites.current > 0) return;

      try {
        const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
        if (!isMounted) return;
        stateRef.current = remoteState;
        setState(remoteState);
        writeState(remoteState);
        setSyncError(null);
      } catch (error) {
        if (!isMounted) return;
        setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
      } finally {
        if (isMounted) setIsSyncing(false);
      }
    }

    void refreshRemoteState();
    const intervalId = window.setInterval(refreshRemoteState, 30_000);
    const unsubscribeRemoteChanges = subscribeRemoteChanges(() => {
      void refreshRemoteState();
    });

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      unsubscribeRemoteChanges();
    };
  }, []);

  const publishState = (next: TrackerState) => {
    stateRef.current = next;
    writeState(next);
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(channelName);
      channel.postMessage({ type: "updated" });
      channel.close();
    }
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    setState(next);
  };

  const commit = (updater: (current: TrackerState) => TrackerState) => {
    publishState(updater(stateRef.current));
  };

  const createActivity = (
    sessionId: string,
    type: SessionActivityType,
    options: Omit<SessionActivity, "id" | "sessionId" | "type" | "createdAt"> = {},
  ): SessionActivity => ({
    id: `activity-${crypto.randomUUID()}`,
    sessionId,
    type,
    createdAt: new Date().toISOString(),
    ...options,
  });

  const appendActivity = (activity: SessionActivity) => {
    commit((current) => ({
      ...current,
      activities: current.activities.some((existing) => existing.id === activity.id)
        ? current.activities
        : [...current.activities, activity],
    }));
    if (isRemoteEnabled) {
      void remoteAddActivity(activity).catch((error) => {
        setSyncError(error instanceof Error ? error.message : "Unable to sync activity.");
      });
    }
  };

  const applyLocalOnlyDeletes = (nextState: TrackerState): TrackerState => {
    if (softDeletedSessionIds.current.size === 0) return nextState;
    return Array.from(softDeletedSessionIds.current).reduce(removeSessionFromState, nextState);
  };

  const runRemote = async (
    operation: () => Promise<unknown>,
    rollbackState?: TrackerState,
    options?: { afterSuccess?: () => void; beforeRollback?: () => void },
  ) => {
    if (!isRemoteEnabled) return;
    pendingRemoteWrites.current += 1;
    setPendingRemoteWriteCount((count) => count + 1);
    try {
      await operation();
      options?.afterSuccess?.();
      const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
      publishState(remoteState);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
      if (rollbackState && pendingRemoteWrites.current === 1) {
        options?.beforeRollback?.();
        publishState(applyLocalOnlyDeletes(rollbackState));
      }
    } finally {
      pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
      setPendingRemoteWriteCount((count) => Math.max(0, count - 1));
    }
  };

  const refreshAfterRemoteWrite = async () => {
    const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
    publishState(remoteState);
    setSyncError(null);
  };

  return {
    state,
    isRemoteEnabled,
    isSyncing,
    isSaving: pendingRemoteWriteCount > 0,
    syncError,
    refreshRemoteNow: async () => {
      if (!isRemoteEnabled || pendingRemoteWrites.current > 0) return;
      setIsSyncing(true);
      try {
        const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
        stateRef.current = remoteState;
        setState(remoteState);
        writeState(remoteState);
        setSyncError(null);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
      } finally {
        setIsSyncing(false);
      }
    },
    claimSessionAccess: (sessionId: string, role: "host" | "player" = "player") => {
      void runRemote(() => remoteClaimSessionAccess(sessionId, role));
    },
    verifySessionPin: async (sessionId: string, pinCode: string) => {
      if (!isRemoteEnabled) return false;
      pendingRemoteWrites.current += 1;
      try {
        const isValid = await remoteVerifySessionPin(sessionId, pinCode);
        if (isValid) await refreshAfterRemoteWrite();
        setSyncError(null);
        return isValid;
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to verify session PIN.");
        return false;
      } finally {
        pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
      }
    },
    getSessionLinkStatus: async (sessionId: string) => {
      if (!isRemoteEnabled) return "unknown" as const;
      try {
        return await remoteGetSessionLinkStatus(sessionId);
      } catch {
        return "unknown" as const;
      }
    },
    getSessionPublicInfo: async (sessionId: string) => {
      if (!isRemoteEnabled) return undefined;
      try {
        return await remoteGetSessionPublicInfo(sessionId);
      } catch {
        return undefined;
      }
    },
    seedDefaultUsers: () => {
      void runRemote(() => remoteSeedDefaultUsers(defaultState.users));
    },
    addUser: (user: User) => {
      const rollbackState = stateRef.current;
      commit((current) =>
        current.users.some(
          (existingUser) => existingUser.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
        )
          ? current
          : { ...current, users: [...current.users, user] },
      );
      void runRemote(() => remoteAddUser(user), rollbackState);
    },
    joinSessionGuest: (user: User, sessionId: string) => {
      const rollbackState = stateRef.current;
      const existingUser = stateRef.current.users.find(
        (candidate) => candidate.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
      );
      const rosterUserId = existingUser?.id ?? user.id;
      const alreadyInSession = stateRef.current.roster.some(
        (entry) => entry.sessionId === sessionId && entry.userId === rosterUserId,
      );
      commit((current) => {
        const existingUser = current.users.find(
          (candidate) => candidate.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
        );
        const rosterUserId = existingUser?.id ?? user.id;
        const hasRosterEntry = current.roster.some(
          (entry) => entry.sessionId === sessionId && entry.userId === rosterUserId,
        );

        return {
          ...current,
          users: existingUser ? current.users : [...current.users, user],
          roster: hasRosterEntry
            ? current.roster
            : [...current.roster, { sessionId, userId: rosterUserId, paid: false, isPresent: true, isHost: false }],
        };
      });
      if (!alreadyInSession) {
        appendActivity(createActivity(sessionId, "player_added", {
          actorUserId: sessionHostUserId(stateRef.current, sessionId),
          targetUserId: rosterUserId,
          metadata: { targetName: user.name },
        }));
      }
      void runRemote(() => remoteJoinSession(user, sessionId), rollbackState);
    },
    createSession: (session: Session, roster: RosterEntry[], setupUsers?: User[]) => {
      const knownUsers = setupUsers ?? state.users;
      const usersToAdd = knownUsers.filter(
        (user) => roster.some((entry) => entry.userId === user.id) && !state.users.some((existing) => existing.id === user.id),
      );
      const dedupedRoster = dedupeRosterByUserId(roster);
      const rollbackState = stateRef.current;
      const createdActivity = createActivity(session.id, "session_created", {
        actorUserId: dedupedRoster.find((entry) => entry.isHost)?.userId,
        metadata: { sessionName: session.name ?? session.date },
      });
      commit((current) => ({
        ...current,
        users: [...current.users, ...usersToAdd],
        sessions: [...current.sessions, session],
        roster: [
          ...current.roster,
          ...Array.from(
            new Map(
              dedupedRoster.map((entry) => [`${entry.sessionId}:${entry.userId}`, entry]),
            ).values(),
          ),
        ],
        participants: [
          ...current.participants.filter(
            (participant) => !(participant.sessionId === session.id && participant.role === "host"),
          ),
          {
            sessionId: session.id,
            userId: "local-host",
            role: "host",
            joinedAt: new Date().toISOString(),
          },
        ],
        activities: [...current.activities, createdActivity],
      }));
      void runRemote(async () => {
        await remoteCreateSession(session, dedupedRoster, knownUsers);
        await remoteAddActivity(createdActivity);
      }, rollbackState);
    },
    endSession: (sessionId: string) => {
      const rollbackState = stateRef.current;
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, status: closedStatus, endedAt: new Date().toISOString() }
            : session,
        ),
      }));
      appendActivity(createActivity(sessionId, "session_closed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
      }));
      void runRemote(() => remoteEndSession(sessionId), rollbackState);
    },
    deleteSession: (sessionId: string) => {
      const rollbackState = stateRef.current;
      commit((current) => ({
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
        roster: current.roster.filter((entry) => entry.sessionId !== sessionId),
        participants: current.participants.filter((participant) => participant.sessionId !== sessionId),
        matches: current.matches.filter((match) => match.sessionId !== sessionId),
        activities: current.activities.filter((activity) => activity.sessionId !== sessionId),
      }));
      void runRemote(() => remoteDeleteSession(sessionId), rollbackState);
    },
    deleteSessionLocal: (sessionId: string) => {
      const snapshot = getDeletedSessionSnapshot(stateRef.current, sessionId);
      if (snapshot) softDeletedSessionSnapshots.current.set(sessionId, snapshot);
      softDeletedSessionIds.current.add(sessionId);
      commit((current) => removeSessionFromState(current, sessionId));
    },
    deleteSessionRemote: (sessionId: string) => {
      const snapshot = softDeletedSessionSnapshots.current.get(sessionId);
      const rollbackState = snapshot ? restoreDeletedSessionSnapshot(stateRef.current, snapshot) : undefined;
      void runRemote(
        () => remoteDeleteSession(sessionId),
        rollbackState,
        {
          afterSuccess: () => {
            softDeletedSessionIds.current.delete(sessionId);
            softDeletedSessionSnapshots.current.delete(sessionId);
          },
          beforeRollback: () => {
            softDeletedSessionIds.current.delete(sessionId);
            softDeletedSessionSnapshots.current.delete(sessionId);
          },
        },
      );
    },
    restoreSession: (snapshot: DeletedSessionSnapshot) => {
      softDeletedSessionIds.current.delete(snapshot.session.id);
      softDeletedSessionSnapshots.current.delete(snapshot.session.id);
      commit((current) => ({
        ...current,
        sessions: current.sessions.some((session) => session.id === snapshot.session.id)
          ? current.sessions
          : [...current.sessions, snapshot.session],
        roster: [
          ...current.roster.filter((entry) => entry.sessionId !== snapshot.session.id),
          ...snapshot.roster,
        ],
        participants: [
          ...current.participants.filter((participant) => participant.sessionId !== snapshot.session.id),
          ...snapshot.participants,
        ],
        matches: [
          ...current.matches.filter((match) => match.sessionId !== snapshot.session.id),
          ...snapshot.matches,
        ],
        activities: [
          ...current.activities.filter((activity) => activity.sessionId !== snapshot.session.id),
          ...snapshot.activities,
        ],
      }));
    },
    updateCourtPrice: (sessionId: string, courtPrice: number) => {
      const rollbackState = stateRef.current;
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, courtPrice } : session,
        ),
      }));
      appendActivity(createActivity(sessionId, "court_price_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: courtPrice },
      }));
      void runRemote(() => remoteUpdateCourtPrice(sessionId, courtPrice), rollbackState);
    },
    updateMatchDuration: (sessionId: string, matchDuration: number) => {
      const rollbackState = stateRef.current;
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, matchDuration } : session,
        ),
      }));
      appendActivity(createActivity(sessionId, "match_duration_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: matchDuration },
      }));
      void runRemote(() => remoteUpdateMatchDuration(sessionId, matchDuration), rollbackState);
    },
    updateTotalCourtTime: (sessionId: string, totalCourtTime: number) => {
      const rollbackState = stateRef.current;
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, totalCourtTime } : session,
        ),
      }));
      appendActivity(createActivity(sessionId, "total_court_time_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: totalCourtTime },
      }));
      void runRemote(() => remoteUpdateTotalCourtTime(sessionId, totalCourtTime), rollbackState);
    },
    updateBillingMethod: (sessionId: string, billingMethod: BillingMethod) => {
      const rollbackState = stateRef.current;
      const previousMethod = stateRef.current.sessions.find((session) => session.id === sessionId)?.billingMethod ?? "standard";
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, billingMethod } : session,
        ),
      }));
      if (previousMethod !== billingMethod) {
        appendActivity(createActivity(sessionId, "billing_method_changed", {
          actorUserId: sessionHostUserId(stateRef.current, sessionId),
          metadata: { from: previousMethod, to: billingMethod },
        }));
      }
      void runRemote(() => remoteUpdateBillingMethod(sessionId, billingMethod), rollbackState);
    },
    togglePaid: (sessionId: string, userId: string) => {
      const rollbackState = stateRef.current;
      let nextPaid = false;

      commit((current) => {
        const currentPaid = current.roster.find(
          (candidate) => candidate.sessionId === sessionId && candidate.userId === userId,
        )?.paid;
        nextPaid = !(currentPaid ?? false);

        return {
          ...current,
          roster: current.roster.map((entry) =>
            entry.sessionId === sessionId && entry.userId === userId ? { ...entry, paid: nextPaid } : entry,
          ),
        };
      });
      appendActivity(createActivity(sessionId, "paid_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { paid: nextPaid },
      }));
      void runRemote(() => remoteSetPaid(sessionId, [userId], nextPaid), rollbackState);
    },
    togglePresent: (sessionId: string, userId: string) => {
      const rollbackState = stateRef.current;
      let nextPresent = false;

      commit((current) => {
        const currentPresent = current.roster.find(
          (candidate) => candidate.sessionId === sessionId && candidate.userId === userId,
        )?.isPresent;
        nextPresent = !(currentPresent ?? false);

        return {
          ...current,
          roster: current.roster.map((entry) =>
            entry.sessionId === sessionId && entry.userId === userId ? { ...entry, isPresent: nextPresent } : entry,
          ),
        };
      });
      appendActivity(createActivity(sessionId, "present_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { isPresent: nextPresent },
      }));
      void runRemote(() => remoteSetPresent(sessionId, [userId], nextPresent), rollbackState);
    },
    removeSessionPlayer: (sessionId: string, userId: string) => {
      const rollbackState = stateRef.current;
      const targetUser = stateRef.current.users.find((user) => user.id === userId);
      commit((current) => ({
        ...current,
        roster: current.roster.filter((entry) => !(entry.sessionId === sessionId && entry.userId === userId)),
      }));
      appendActivity(createActivity(sessionId, "player_removed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { targetName: targetUser?.name ?? "Player" },
      }));
      void runRemote(() => remoteRemoveSessionPlayers(sessionId, [userId]), rollbackState);
    },
    addMatch: (match: Match) => {
      const rollbackState = stateRef.current;
      commit((current) =>
        current.matches.some((existingMatch) => existingMatch.id === match.id)
          ? current
          : { ...current, matches: [...current.matches, match] },
      );
      appendActivity(createActivity(match.sessionId, "match_added", {
        actorUserId: match.playerAId,
        matchId: match.id,
        metadata: matchSnapshotMetadata(match, stateRef.current),
      }));
      void runRemote(() => remoteAddMatch(match), rollbackState);
    },
    deleteMatch: (matchId: string) => {
      const rollbackState = stateRef.current;
      const deletedMatch = stateRef.current.matches.find((match) => match.id === matchId);
      commit((current) => ({
        ...current,
        matches: current.matches.filter((match) => match.id !== matchId),
      }));
      if (deletedMatch) {
        appendActivity(createActivity(deletedMatch.sessionId, "match_removed", {
          actorUserId: sessionHostUserId(stateRef.current, deletedMatch.sessionId),
          matchId,
          metadata: matchSnapshotMetadata(deletedMatch, stateRef.current),
        }));
      }
      void runRemote(() => remoteDeleteMatch(matchId), rollbackState);
    },
    updateMatchScore: (matchId: string, score: string | undefined) => {
      const rollbackState = stateRef.current;
      let nextWinnerId: string | undefined;
      commit((current) => {
        const targetMatch = current.matches.find((match) => match.id === matchId);
        if (!targetMatch) return current;
        nextWinnerId = score ? inferMatchWinnerId({ ...targetMatch, score }) : undefined;
        return {
          ...current,
          matches: current.matches.map((match) =>
            match.id === matchId ? { ...match, score, winnerId: match.isStake ? nextWinnerId : match.winnerId } : match,
          ),
        };
      });
      const updatedMatch = stateRef.current.matches.find((match) => match.id === matchId);
      if (updatedMatch) {
        appendActivity(createActivity(updatedMatch.sessionId, "match_score_updated", {
          actorUserId: updatedMatch.playerAId,
          matchId,
          metadata: matchSnapshotMetadata({ ...updatedMatch, score, winnerId: nextWinnerId ?? updatedMatch.winnerId }, stateRef.current),
        }));
      }
      void runRemote(() => remoteUpdateMatchScore(matchId, score, nextWinnerId), rollbackState);
    },
    toggleMatchStake: (matchId: string) => {
      const rollbackState = stateRef.current;
      let nextStake = false;
      let nextWinnerId: string | undefined;
      let shouldUpdateRemote = false;

      commit((current) => {
        const targetMatch = current.matches.find((match) => match.id === matchId);
        if (!targetMatch) return current;
        nextStake = !targetMatch.isStake;
        nextWinnerId = nextStake ? inferMatchWinnerId(targetMatch) : undefined;
        if (nextStake && !nextWinnerId) return current;
        shouldUpdateRemote = true;

        return {
          ...current,
          matches: current.matches.map((match) =>
            match.id === matchId ? { ...match, isStake: nextStake, winnerId: nextWinnerId } : match,
          ),
        };
      });

      if (shouldUpdateRemote) {
        const updatedMatch = stateRef.current.matches.find((match) => match.id === matchId);
        if (updatedMatch) {
          appendActivity(createActivity(updatedMatch.sessionId, "match_stake_changed", {
            actorUserId: sessionHostUserId(stateRef.current, updatedMatch.sessionId),
            matchId,
            metadata: matchSnapshotMetadata({ ...updatedMatch, isStake: nextStake, winnerId: nextWinnerId }, stateRef.current),
          }));
        }
        void runRemote(() => remoteUpdateMatchStake(matchId, nextStake, nextWinnerId), rollbackState);
      }
    },
  };
}

function normalizeState(state: TrackerState): TrackerState {
  return {
    ...state,
    sessions: state.sessions.map((session) => ({
      ...session,
      billingMethod: session.billingMethod ?? "standard",
    })),
    roster: state.roster.map((entry) => ({
      ...entry,
      isPresent: entry.isPresent ?? true,
      isHost: entry.isHost ?? false,
    })),
    activities: state.activities ?? [],
  };
}

function inferMatchWinnerId(match: Match): string | undefined {
  if (!match.score) return match.winnerId;
  const [firstScore, secondScore] = match.score.split(/[-:]/).map((value) => Number(value.trim()));
  if (!Number.isFinite(firstScore) || !Number.isFinite(secondScore) || firstScore === secondScore) {
    return match.winnerId;
  }
  return firstScore > secondScore ? match.playerAId : match.playerBId;
}

function removeSessionFromState(state: TrackerState, sessionId: string): TrackerState {
  return {
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    roster: state.roster.filter((entry) => entry.sessionId !== sessionId),
    participants: state.participants.filter((participant) => participant.sessionId !== sessionId),
    matches: state.matches.filter((match) => match.sessionId !== sessionId),
    activities: state.activities.filter((activity) => activity.sessionId !== sessionId),
  };
}

function getDeletedSessionSnapshot(state: TrackerState, sessionId: string): DeletedSessionSnapshot | undefined {
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return undefined;
  return {
    session,
    roster: state.roster.filter((entry) => entry.sessionId === sessionId),
    participants: state.participants.filter((participant) => participant.sessionId === sessionId),
    matches: state.matches.filter((match) => match.sessionId === sessionId),
    activities: state.activities.filter((activity) => activity.sessionId === sessionId),
  };
}

function restoreDeletedSessionSnapshot(state: TrackerState, snapshot: DeletedSessionSnapshot): TrackerState {
  return {
    ...state,
    sessions: state.sessions.some((session) => session.id === snapshot.session.id)
      ? state.sessions
      : [...state.sessions, snapshot.session],
    roster: [
      ...state.roster.filter((entry) => entry.sessionId !== snapshot.session.id),
      ...snapshot.roster,
    ],
    participants: [
      ...state.participants.filter((participant) => participant.sessionId !== snapshot.session.id),
      ...snapshot.participants,
    ],
    matches: [
      ...state.matches.filter((match) => match.sessionId !== snapshot.session.id),
      ...snapshot.matches,
    ],
    activities: [
      ...state.activities.filter((activity) => activity.sessionId !== snapshot.session.id),
      ...snapshot.activities,
    ],
  };
}

function dedupeRosterByUserId(roster: RosterEntry[]): RosterEntry[] {
  return Array.from(
    new Map(
      roster.map((entry) => [`${entry.sessionId}:${entry.userId}`, entry]),
    ).values(),
  );
}

function sessionHostUserId(state: TrackerState, sessionId: string): string | undefined {
  return state.roster.find((entry) => entry.sessionId === sessionId && entry.isHost)?.userId;
}

function matchSnapshotMetadata(match: Match, state: TrackerState): SessionActivity["metadata"] {
  const playerAName = state.users.find((user) => user.id === match.playerAId)?.name ?? "Player";
  const playerBName = state.users.find((user) => user.id === match.playerBId)?.name ?? "Opponent";
  const winnerName = match.winnerId
    ? state.users.find((user) => user.id === match.winnerId)?.name
    : undefined;
  return {
    playerAId: match.playerAId,
    playerBId: match.playerBId,
    playerAName,
    playerBName,
    score: match.score ?? null,
    isStake: match.isStake,
    winnerId: match.winnerId ?? null,
    winnerName: winnerName ?? null,
  };
}
