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
  remoteUpdateShuttleSettings,
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

type PendingMutation = {
  id: string;
  apply: (state: TrackerState) => TrackerState;
};

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
  const confirmedStateRef = useRef(state);
  const pendingRemoteWrites = useRef(0);
  const pendingMutationsRef = useRef<PendingMutation[]>([]);
  const remoteQueueRef = useRef(Promise.resolve());
  const softDeletedSessionIds = useRef(new Set<string>());
  const softDeletedSessionSnapshots = useRef(new Map<string, DeletedSessionSnapshot>());

  useEffect(() => {
    stateRef.current = state;
    writeState(isRemoteEnabled ? confirmedStateRef.current : state);
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
        confirmedStateRef.current = remoteState;
        publishProjectedState();
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

  const projectState = (base: TrackerState) =>
    applyLocalOnlyDeletes(
      pendingMutationsRef.current.reduce((current, mutation) => mutation.apply(current), base),
    );

  const publishState = (next: TrackerState, broadcastLocal = false) => {
    stateRef.current = next;
    writeState(isRemoteEnabled ? confirmedStateRef.current : next);
    if (broadcastLocal && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel(channelName);
      channel.postMessage({ type: "updated" });
      channel.close();
    }
    if (broadcastLocal) {
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    }
    setState(next);
  };

  const publishProjectedState = (broadcastLocal = false) => {
    publishState(projectState(confirmedStateRef.current), broadcastLocal);
  };

  const commitConfirmed = (updater: (current: TrackerState) => TrackerState, broadcastLocal = false) => {
    confirmedStateRef.current = updater(confirmedStateRef.current);
    publishProjectedState(broadcastLocal);
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

  const appendActivityToState = (current: TrackerState, activity?: SessionActivity) =>
    !activity || current.activities.some((existing) => existing.id === activity.id)
      ? current
      : { ...current, activities: [...current.activities, activity] };

  const applyLocalOnlyDeletes = (nextState: TrackerState): TrackerState => {
    if (softDeletedSessionIds.current.size === 0) return nextState;
    return Array.from(softDeletedSessionIds.current).reduce(removeSessionFromState, nextState);
  };

  const enqueueRemote = (
    operation: () => Promise<unknown>,
    options?: { onSuccess?: () => void; onFailure?: () => void },
  ) => {
    if (!isRemoteEnabled) return;
    pendingRemoteWrites.current += 1;
    setPendingRemoteWriteCount((count) => count + 1);
    const task = async () => {
      try {
        await operation();
        options?.onSuccess?.();
        confirmedStateRef.current = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
        setSyncError(null);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
        options?.onFailure?.();
        try {
          confirmedStateRef.current = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
        } catch {
          // Keep the last confirmed state if refresh fails too.
        }
      } finally {
        pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
        setPendingRemoteWriteCount((count) => Math.max(0, count - 1));
        publishProjectedState();
      }
    };
    remoteQueueRef.current = remoteQueueRef.current.then(task, task).catch(() => undefined);
  };

  const runOptimisticMutation = (
    apply: (current: TrackerState) => TrackerState,
    operation: () => Promise<unknown>,
    options?: { onSuccess?: () => void; onFailure?: () => void },
  ) => {
    if (!isRemoteEnabled) {
      commitConfirmed(apply, true);
      return;
    }

    const mutationId = `mutation-${crypto.randomUUID()}`;
    pendingMutationsRef.current = [...pendingMutationsRef.current, { id: mutationId, apply }];
    publishProjectedState();

    enqueueRemote(operation, {
      onSuccess: () => {
        pendingMutationsRef.current = pendingMutationsRef.current.filter((mutation) => mutation.id !== mutationId);
        options?.onSuccess?.();
      },
      onFailure: () => {
        pendingMutationsRef.current = pendingMutationsRef.current.filter((mutation) => mutation.id !== mutationId);
        options?.onFailure?.();
      },
    });
  };

  const runRemoteAndRefresh = async (operation: () => Promise<unknown>) => {
    if (!isRemoteEnabled) return;
    pendingRemoteWrites.current += 1;
    setPendingRemoteWriteCount((count) => count + 1);
    try {
      await operation();
      confirmedStateRef.current = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
      publishProjectedState();
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
    } finally {
      pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
      setPendingRemoteWriteCount((count) => Math.max(0, count - 1));
    }
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
        confirmedStateRef.current = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
        publishProjectedState();
        setSyncError(null);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
      } finally {
        setIsSyncing(false);
      }
    },
    claimSessionAccess: (sessionId: string, role: "host" | "player" = "player") => {
      void enqueueRemote(() => remoteClaimSessionAccess(sessionId, role));
    },
    verifySessionPin: async (sessionId: string, pinCode: string) => {
      if (!isRemoteEnabled) return false;
      pendingRemoteWrites.current += 1;
      try {
        const isValid = await remoteVerifySessionPin(sessionId, pinCode);
        if (isValid) {
          confirmedStateRef.current = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
          publishProjectedState();
        }
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
      void enqueueRemote(() => remoteSeedDefaultUsers(defaultState.users));
    },
    addUser: (user: User) => {
      const apply = (current: TrackerState) =>
        current.users.some(
          (existingUser) => existingUser.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
        )
          ? current
          : { ...current, users: [...current.users, user] };
      runOptimisticMutation(apply, () => remoteAddUser(user));
    },
    joinSessionGuest: (user: User, sessionId: string) => {
      const existingUser = stateRef.current.users.find(
        (candidate) => candidate.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
      );
      const rosterUserId = existingUser?.id ?? user.id;
      const alreadyInSession = stateRef.current.roster.some(
        (entry) => entry.sessionId === sessionId && entry.userId === rosterUserId,
      );
      const activity = !alreadyInSession
        ? createActivity(sessionId, "player_added", {
            actorUserId: sessionHostUserId(stateRef.current, sessionId),
            targetUserId: rosterUserId,
            metadata: { targetName: user.name },
          })
        : undefined;
      const apply = (current: TrackerState) => {
        const existingUser = current.users.find(
          (candidate) => candidate.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
        );
        const rosterUserId = existingUser?.id ?? user.id;
        const hasRosterEntry = current.roster.some(
          (entry) => entry.sessionId === sessionId && entry.userId === rosterUserId,
        );

        return appendActivityToState({
          ...current,
          users: existingUser ? current.users : [...current.users, user],
          roster: hasRosterEntry
            ? current.roster
            : [...current.roster, { sessionId, userId: rosterUserId, paid: false, isPresent: true, isHost: false }],
        }, activity);
      };
      runOptimisticMutation(apply, async () => {
        await remoteJoinSession(user, sessionId);
        if (activity) await remoteAddActivity(activity);
      });
    },
    createSession: (session: Session, roster: RosterEntry[], setupUsers?: User[]) => {
      const knownUsers = setupUsers ?? state.users;
      const usersToAdd = knownUsers.filter(
        (user) => roster.some((entry) => entry.userId === user.id) && !state.users.some((existing) => existing.id === user.id),
      );
      const dedupedRoster = dedupeRosterByUserId(roster);
      const createdActivity = createActivity(session.id, "session_created", {
        actorUserId: dedupedRoster.find((entry) => entry.isHost)?.userId,
        metadata: { sessionName: session.name ?? session.date },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
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
        }, createdActivity);
      runOptimisticMutation(apply, async () => {
        await remoteCreateSession(session, dedupedRoster, knownUsers);
        await remoteAddActivity(createdActivity);
      });
    },
    endSession: (sessionId: string) => {
      const activity = createActivity(sessionId, "session_closed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, status: closedStatus, endedAt: new Date().toISOString() }
              : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteEndSession(sessionId);
        await remoteAddActivity(activity);
      });
    },
    deleteSession: (sessionId: string) => {
      const apply = (current: TrackerState) => removeSessionFromState(current, sessionId);
      runOptimisticMutation(apply, () => remoteDeleteSession(sessionId));
    },
    deleteSessionLocal: (sessionId: string) => {
      const snapshot = getDeletedSessionSnapshot(stateRef.current, sessionId);
      if (snapshot) softDeletedSessionSnapshots.current.set(sessionId, snapshot);
      softDeletedSessionIds.current.add(sessionId);
      commitConfirmed((current) => removeSessionFromState(current, sessionId), !isRemoteEnabled);
    },
    deleteSessionRemote: (sessionId: string) => {
      void enqueueRemote(
        () => remoteDeleteSession(sessionId),
        {
          onSuccess: () => {
            softDeletedSessionIds.current.delete(sessionId);
            softDeletedSessionSnapshots.current.delete(sessionId);
          },
          onFailure: () => {
            softDeletedSessionIds.current.delete(sessionId);
            softDeletedSessionSnapshots.current.delete(sessionId);
          },
        },
      );
    },
    restoreSession: (snapshot: DeletedSessionSnapshot) => {
      softDeletedSessionIds.current.delete(snapshot.session.id);
      softDeletedSessionSnapshots.current.delete(snapshot.session.id);
      commitConfirmed((current) => ({
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
      }), !isRemoteEnabled);
    },
    updateCourtPrice: (sessionId: string, courtPrice: number) => {
      const activity = createActivity(sessionId, "court_price_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: courtPrice },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId ? { ...session, courtPrice } : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateCourtPrice(sessionId, courtPrice);
        await remoteAddActivity(activity);
      });
    },
    updateShuttleSettings: (sessionId: string, shuttlePrice: number, shuttlesPerTube: number) => {
      const activity = createActivity(sessionId, "shuttle_settings_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: {
          shuttlePrice,
          shuttlesPerTube,
        },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId ? { ...session, shuttlePrice, shuttlesPerTube } : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateShuttleSettings(sessionId, shuttlePrice, shuttlesPerTube);
        await remoteAddActivity(activity);
      });
    },
    updateMatchDuration: (sessionId: string, matchDuration: number) => {
      const activity = createActivity(sessionId, "match_duration_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: matchDuration },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId ? { ...session, matchDuration } : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateMatchDuration(sessionId, matchDuration);
        await remoteAddActivity(activity);
      });
    },
    updateTotalCourtTime: (sessionId: string, totalCourtTime: number) => {
      const activity = createActivity(sessionId, "total_court_time_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        metadata: { value: totalCourtTime },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId ? { ...session, totalCourtTime } : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateTotalCourtTime(sessionId, totalCourtTime);
        await remoteAddActivity(activity);
      });
    },
    updateBillingMethod: (sessionId: string, billingMethod: BillingMethod) => {
      const previousMethod = stateRef.current.sessions.find((session) => session.id === sessionId)?.billingMethod ?? "standard";
      const activity = previousMethod !== billingMethod
        ? createActivity(sessionId, "billing_method_changed", {
          actorUserId: sessionHostUserId(stateRef.current, sessionId),
          metadata: { from: previousMethod, to: billingMethod },
        })
        : undefined;
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId ? { ...session, billingMethod } : session,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateBillingMethod(sessionId, billingMethod);
        if (activity) await remoteAddActivity(activity);
      });
    },
    togglePaid: (sessionId: string, userId: string) => {
      const currentPaid = stateRef.current.roster.find(
        (candidate) => candidate.sessionId === sessionId && candidate.userId === userId,
      )?.paid;
      const nextPaid = !(currentPaid ?? false);
      const activity = createActivity(sessionId, "paid_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { paid: nextPaid },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          roster: current.roster.map((entry) =>
            entry.sessionId === sessionId && entry.userId === userId ? { ...entry, paid: nextPaid } : entry,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteSetPaid(sessionId, [userId], nextPaid);
        await remoteAddActivity(activity);
      });
    },
    togglePresent: (sessionId: string, userId: string) => {
      const currentPresent = stateRef.current.roster.find(
        (candidate) => candidate.sessionId === sessionId && candidate.userId === userId,
      )?.isPresent;
      const nextPresent = !(currentPresent ?? false);
      const activity = createActivity(sessionId, "present_changed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { isPresent: nextPresent },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          roster: current.roster.map((entry) =>
            entry.sessionId === sessionId && entry.userId === userId ? { ...entry, isPresent: nextPresent } : entry,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteSetPresent(sessionId, [userId], nextPresent);
        await remoteAddActivity(activity);
      });
    },
    removeSessionPlayer: (sessionId: string, userId: string) => {
      const targetUser = stateRef.current.users.find((user) => user.id === userId);
      const activity = createActivity(sessionId, "player_removed", {
        actorUserId: sessionHostUserId(stateRef.current, sessionId),
        targetUserId: userId,
        metadata: { targetName: targetUser?.name ?? "Player" },
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          roster: current.roster.filter((entry) => !(entry.sessionId === sessionId && entry.userId === userId)),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteRemoveSessionPlayers(sessionId, [userId]);
        await remoteAddActivity(activity);
      });
    },
    addMatch: (match: Match) => {
      const activity = createActivity(match.sessionId, "match_added", {
        actorUserId: match.playerAId,
        matchId: match.id,
        metadata: matchSnapshotMetadata(match, stateRef.current),
      });
      const apply = (current: TrackerState) =>
        appendActivityToState(
          current.matches.some((existingMatch) => existingMatch.id === match.id)
            ? current
            : { ...current, matches: [...current.matches, match] },
          activity,
        );
      runOptimisticMutation(apply, async () => {
        await remoteAddMatch(match);
        await remoteAddActivity(activity);
      });
    },
    deleteMatch: (matchId: string) => {
      const deletedMatch = stateRef.current.matches.find((match) => match.id === matchId);
      const activity = deletedMatch
        ? createActivity(deletedMatch.sessionId, "match_removed", {
            actorUserId: sessionHostUserId(stateRef.current, deletedMatch.sessionId),
            matchId,
            metadata: matchSnapshotMetadata(deletedMatch, stateRef.current),
          })
        : undefined;
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          matches: current.matches.filter((match) => match.id !== matchId),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteDeleteMatch(matchId);
        if (activity) await remoteAddActivity(activity);
      });
    },
    updateMatchScore: (matchId: string, score: string | undefined) => {
      const targetMatch = stateRef.current.matches.find((match) => match.id === matchId);
      if (!targetMatch) return;
      const nextWinnerId = score ? inferMatchWinnerId({ ...targetMatch, score }) : undefined;
      const activity = createActivity(targetMatch.sessionId, "match_score_updated", {
        actorUserId: targetMatch.playerAId,
        matchId,
        metadata: matchSnapshotMetadata(
          { ...targetMatch, score, winnerId: nextWinnerId ?? targetMatch.winnerId },
          stateRef.current,
        ),
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          matches: current.matches.map((match) =>
            match.id === matchId ? { ...match, score, winnerId: match.isStake ? nextWinnerId : match.winnerId } : match,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateMatchScore(matchId, score, nextWinnerId);
        await remoteAddActivity(activity);
      });
    },
    toggleMatchStake: (matchId: string) => {
      const targetMatch = stateRef.current.matches.find((match) => match.id === matchId);
      if (!targetMatch) return;
      const nextStake = !targetMatch.isStake;
      const nextWinnerId = nextStake ? inferMatchWinnerId(targetMatch) : undefined;
      if (nextStake && !nextWinnerId) return;

      const activity = createActivity(targetMatch.sessionId, "match_stake_changed", {
        actorUserId: sessionHostUserId(stateRef.current, targetMatch.sessionId),
        matchId,
        metadata: matchSnapshotMetadata({ ...targetMatch, isStake: nextStake, winnerId: nextWinnerId }, stateRef.current),
      });
      const apply = (current: TrackerState) =>
        appendActivityToState({
          ...current,
          matches: current.matches.map((match) =>
            match.id === matchId ? { ...match, isStake: nextStake, winnerId: nextWinnerId } : match,
          ),
        }, activity);
      runOptimisticMutation(apply, async () => {
        await remoteUpdateMatchStake(matchId, nextStake, nextWinnerId);
        await remoteAddActivity(activity);
      });
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
