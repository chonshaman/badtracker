import { useEffect, useRef, useState } from "react";
import { defaultState } from "../data/defaults";
import {
  isRemoteEnabled,
  loadRemoteState,
  remoteAddMatch,
  remoteAddUser,
  remoteClaimSessionAccess,
  remoteCreateSession,
  remoteDeleteMatch,
  remoteEndSession,
  remoteJoinSession,
  remoteSetPaid,
} from "./remoteStore";
import type { Match, RosterEntry, Session, SessionStatus, TrackerState, User } from "../types";

const storageKey = "smash-tracker-state-v1";
const channelName = "smash-tracker-sync";
const closedStatus: SessionStatus = "Closed";

function readState(): TrackerState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return defaultState;

  try {
    return { ...defaultState, ...JSON.parse(raw) } as TrackerState;
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
  const pendingRemoteWrites = useRef(0);

  useEffect(() => {
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
        const remoteState = await loadRemoteState(defaultState.users);
        if (!isMounted) return;
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
    const intervalId = window.setInterval(refreshRemoteState, 1500);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const commit = (updater: (current: TrackerState) => TrackerState) => {
    setState((current) => {
      const next = updater(current);
      writeState(next);
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(channelName);
        channel.postMessage({ type: "updated" });
        channel.close();
      }
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
      return next;
    });
  };

  const runRemote = async (operation: () => Promise<unknown>) => {
    if (!isRemoteEnabled) return;
    pendingRemoteWrites.current += 1;
    try {
      await operation();
      const remoteState = await loadRemoteState(defaultState.users);
      setState(remoteState);
      writeState(remoteState);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to sync with Supabase.");
    } finally {
      pendingRemoteWrites.current = Math.max(0, pendingRemoteWrites.current - 1);
    }
  };

  return {
    state,
    isRemoteEnabled,
    isSyncing,
    syncError,
    claimSessionAccess: (sessionId: string, role: "host" | "player" = "player") => {
      void runRemote(() => remoteClaimSessionAccess(sessionId, role));
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
            : [...current.roster, { sessionId, userId: rosterUserId, paid: false }],
        };
      });
      void runRemote(() => remoteJoinSession(user, sessionId));
    },
    createSession: (session: Session, roster: RosterEntry[]) => {
      const dedupedRoster = dedupeRosterByUserName(roster, state.users);
      commit((current) => ({
        ...current,
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
      void runRemote(() => remoteCreateSession(session, dedupedRoster, state.users));
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
    togglePaid: (sessionId: string, userId: string) => {
      const targetUser = state.users.find((user) => user.id === userId);
      const matchingUserIds = state.users
        .filter(
          (user) =>
            targetUser &&
            user.name.trim().toLowerCase() === targetUser.name.trim().toLowerCase(),
        )
        .map((user) => user.id);
      const currentPaid = state.roster.find(
        (entry) => entry.sessionId === sessionId && matchingUserIds.includes(entry.userId),
      )?.paid;
      const nextPaid = !currentPaid;

      commit((current) => ({
        ...current,
        roster: current.roster.map((entry) => {
          const targetUser = current.users.find((user) => user.id === userId);
          const entryUser = current.users.find((user) => user.id === entry.userId);
          const isSameName =
            targetUser &&
            entryUser &&
            targetUser.name.trim().toLowerCase() === entryUser.name.trim().toLowerCase();

          return entry.sessionId === sessionId && isSameName ? { ...entry, paid: !entry.paid } : entry;
        }),
      }));
      void runRemote(() => remoteSetPaid(sessionId, matchingUserIds, nextPaid));
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
