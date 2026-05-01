import { useEffect, useRef, useState } from "react";
import { defaultState } from "../data/defaults";
import {
  isRemoteEnabled,
  loadRemoteState,
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
  remoteUpdateBillingMethod,
  remoteUpdateCourtPrice,
  remoteUpdateMatchDuration,
  remoteUpdateTotalCourtTime,
  remoteVerifySessionPin,
  seedDefaultUsers as remoteSeedDefaultUsers,
  subscribeRemoteChanges,
} from "./remoteStore";
import type { BillingMethod, Match, RosterEntry, Session, SessionParticipant, SessionStatus, TrackerState, User } from "../types";

const storageKey = "smash-tracker-state-v1";
const channelName = "smash-tracker-sync";
const closedStatus: SessionStatus = "Closed";

export type DeletedSessionSnapshot = {
  session: Session;
  roster: RosterEntry[];
  participants: SessionParticipant[];
  matches: Match[];
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
  const stateRef = useRef(state);
  const pendingRemoteWrites = useRef(0);
  const softDeletedSessionIds = useRef(new Set<string>());

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

  const commit = (updater: (current: TrackerState) => TrackerState) => {
    const next = updater(stateRef.current);
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

  const applyLocalOnlyDeletes = (nextState: TrackerState): TrackerState => {
    if (softDeletedSessionIds.current.size === 0) return nextState;
    return Array.from(softDeletedSessionIds.current).reduce(removeSessionFromState, nextState);
  };

  const runRemote = async (operation: () => Promise<unknown>) => {
    if (!isRemoteEnabled) return;
    pendingRemoteWrites.current += 1;
    try {
      await operation();
      const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
      stateRef.current = remoteState;
      setState(remoteState);
      writeState(remoteState);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
    } finally {
      pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
    }
  };

  const refreshAfterRemoteWrite = async () => {
    const remoteState = applyLocalOnlyDeletes(await loadRemoteState(defaultState.users));
    stateRef.current = remoteState;
    setState(remoteState);
    writeState(remoteState);
    setSyncError(null);
  };

  return {
    state,
    isRemoteEnabled,
    isSyncing,
    syncError,
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
      commit((current) =>
        current.users.some(
          (existingUser) => existingUser.name.trim().toLowerCase() === user.name.trim().toLowerCase(),
        )
          ? current
          : { ...current, users: [...current.users, user] },
      );
      void runRemote(() => remoteAddUser(user));
    },
    joinSessionGuest: (user: User, sessionId: string) => {
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
      void runRemote(() => remoteJoinSession(user, sessionId));
    },
    createSession: (session: Session, roster: RosterEntry[], setupUsers?: User[]) => {
      const knownUsers = setupUsers ?? state.users;
      const usersToAdd = knownUsers.filter(
        (user) => roster.some((entry) => entry.userId === user.id) && !state.users.some((existing) => existing.id === user.id),
      );
      const dedupedRoster = dedupeRosterByUserName(roster, knownUsers);
      commit((current) => ({
        ...current,
        users: [...current.users, ...usersToAdd],
        sessions: [
          ...current.sessions.map((item) =>
            item.slug === session.slug && item.status === "Active"
              ? { ...item, status: closedStatus, endedAt: new Date().toISOString() }
              : item,
          ),
          session,
        ],
        roster: [
          ...current.roster,
          ...Array.from(
            new Map(
              dedupedRoster.map((entry) => {
                const user = current.users.find((candidate) => candidate.id === entry.userId);
                return [user?.name.trim().toLowerCase() ?? entry.userId, entry];
              }),
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
      }));
      void runRemote(() => remoteCreateSession(session, dedupedRoster, knownUsers));
    },
    endSession: (sessionId: string) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, status: closedStatus, endedAt: new Date().toISOString() }
            : session,
        ),
      }));
      void runRemote(() => remoteEndSession(sessionId));
    },
    deleteSession: (sessionId: string) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
        roster: current.roster.filter((entry) => entry.sessionId !== sessionId),
        participants: current.participants.filter((participant) => participant.sessionId !== sessionId),
        matches: current.matches.filter((match) => match.sessionId !== sessionId),
      }));
      void runRemote(() => remoteDeleteSession(sessionId));
    },
    deleteSessionLocal: (sessionId: string) => {
      softDeletedSessionIds.current.add(sessionId);
      commit((current) => removeSessionFromState(current, sessionId));
    },
    deleteSessionRemote: (sessionId: string) => {
      void runRemote(async () => {
        await remoteDeleteSession(sessionId);
        softDeletedSessionIds.current.delete(sessionId);
      });
    },
    restoreSession: (snapshot: DeletedSessionSnapshot) => {
      softDeletedSessionIds.current.delete(snapshot.session.id);
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
      }));
    },
    updateCourtPrice: (sessionId: string, courtPrice: number) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, courtPrice } : session,
        ),
      }));
      void runRemote(() => remoteUpdateCourtPrice(sessionId, courtPrice));
    },
    updateMatchDuration: (sessionId: string, matchDuration: number) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, matchDuration } : session,
        ),
      }));
      void runRemote(() => remoteUpdateMatchDuration(sessionId, matchDuration));
    },
    updateTotalCourtTime: (sessionId: string, totalCourtTime: number) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, totalCourtTime } : session,
        ),
      }));
      void runRemote(() => remoteUpdateTotalCourtTime(sessionId, totalCourtTime));
    },
    updateBillingMethod: (sessionId: string, billingMethod: BillingMethod) => {
      commit((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, billingMethod } : session,
        ),
      }));
      void runRemote(() => remoteUpdateBillingMethod(sessionId, billingMethod));
    },
    togglePaid: (sessionId: string, userId: string) => {
      let nextPaid = false;
      let matchingUserIds: string[] = [];

      commit((current) => {
        const targetUser = current.users.find((user) => user.id === userId);
        matchingUserIds = current.users
          .filter(
            (user) =>
              targetUser &&
              user.name.trim().toLowerCase() === targetUser.name.trim().toLowerCase(),
          )
          .map((user) => user.id);
        const currentPaid = current.roster.find(
          (candidate) => candidate.sessionId === sessionId && matchingUserIds.includes(candidate.userId),
        )?.paid;
        nextPaid = !(currentPaid ?? false);

        return {
          ...current,
          roster: current.roster.map((entry) => {
          const entryUser = current.users.find((user) => user.id === entry.userId);
          const isSameName =
            targetUser &&
            entryUser &&
            targetUser.name.trim().toLowerCase() === entryUser.name.trim().toLowerCase();

            return entry.sessionId === sessionId && isSameName ? { ...entry, paid: nextPaid } : entry;
          }),
        };
      });
      void runRemote(() => remoteSetPaid(sessionId, matchingUserIds, nextPaid));
    },
    togglePresent: (sessionId: string, userId: string) => {
      let nextPresent = false;
      let matchingUserIds: string[] = [];

      commit((current) => {
        const targetUser = current.users.find((user) => user.id === userId);
        matchingUserIds = current.users
          .filter(
            (user) =>
              targetUser &&
              user.name.trim().toLowerCase() === targetUser.name.trim().toLowerCase(),
          )
          .map((user) => user.id);
        const currentPresent = current.roster.find(
          (candidate) => candidate.sessionId === sessionId && matchingUserIds.includes(candidate.userId),
        )?.isPresent;
        nextPresent = !(currentPresent ?? false);

        return {
          ...current,
          roster: current.roster.map((entry) => {
          const entryUser = current.users.find((user) => user.id === entry.userId);
          const isSameName =
            targetUser &&
            entryUser &&
            targetUser.name.trim().toLowerCase() === entryUser.name.trim().toLowerCase();

            return entry.sessionId === sessionId && isSameName ? { ...entry, isPresent: nextPresent } : entry;
          }),
        };
      });
      void runRemote(() => remoteSetPresent(sessionId, matchingUserIds, nextPresent));
    },
    removeSessionPlayer: (sessionId: string, userId: string) => {
      const targetUser = state.users.find((user) => user.id === userId);
      const matchingUserIds = state.users
        .filter(
          (user) =>
            targetUser &&
            user.name.trim().toLowerCase() === targetUser.name.trim().toLowerCase(),
        )
        .map((user) => user.id);

      commit((current) => ({
        ...current,
        roster: current.roster.filter((entry) => {
          if (entry.sessionId !== sessionId) return true;
          const targetUser = current.users.find((user) => user.id === userId);
          const entryUser = current.users.find((user) => user.id === entry.userId);
          const isSameName =
            targetUser &&
            entryUser &&
            targetUser.name.trim().toLowerCase() === entryUser.name.trim().toLowerCase();
          return !isSameName;
        }),
      }));
      void runRemote(() => remoteRemoveSessionPlayers(sessionId, matchingUserIds));
    },
    addMatch: (match: Match) => {
      commit((current) =>
        current.matches.some((existingMatch) => existingMatch.id === match.id)
          ? current
          : { ...current, matches: [...current.matches, match] },
      );
      void runRemote(() => remoteAddMatch(match));
    },
    deleteMatch: (matchId: string) => {
      commit((current) => ({
        ...current,
        matches: current.matches.filter((match) => match.id !== matchId),
      }));
      void runRemote(() => remoteDeleteMatch(matchId));
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
  };
}

function removeSessionFromState(state: TrackerState, sessionId: string): TrackerState {
  return {
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    roster: state.roster.filter((entry) => entry.sessionId !== sessionId),
    participants: state.participants.filter((participant) => participant.sessionId !== sessionId),
    matches: state.matches.filter((match) => match.sessionId !== sessionId),
  };
}

function dedupeRosterByUserName(roster: RosterEntry[], users: User[]): RosterEntry[] {
  return Array.from(
    new Map(
      roster.map((entry) => {
        const user = users.find((candidate) => candidate.id === entry.userId);
        return [user?.name.trim().toLowerCase() ?? entry.userId, entry];
      }),
    ).values(),
  );
}
