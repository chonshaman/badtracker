import type { Match, RosterEntry, Session, TrackerState, User } from "../types";

const fallbackSupabaseUrl = "https://lhkonyltsafjkguctkmc.supabase.co";
const fallbackSupabaseAnonKey = "sb_publishable_2DZhFU_EqNqIMnmWiNvm2g__D8e7-9R";
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ??
  fallbackSupabaseUrl;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  fallbackSupabaseAnonKey;

export const isRemoteEnabled = Boolean(supabaseUrl && supabaseAnonKey);

type RemoteSession = {
  id: string;
  slug: string;
  date: string;
  court_price: number;
  shuttle_price: number;
  shuttles_per_tube: number;
  match_duration: number;
  total_court_time: number;
  fee_per_person: number;
  status: Session["status"];
  created_at: string;
  ended_at?: string | null;
};

type RemoteRosterEntry = {
  session_id: string;
  user_id: string;
  paid: boolean;
};

type RemoteMatch = {
  id: string;
  session_id: string;
  created_at: string;
  player_a_id: string;
  player_b_id: string;
  score?: string | null;
  status: "Valid";
};

function headers() {
  return {
    apikey: supabaseAnonKey ?? "",
    authorization: `Bearer ${supabaseAnonKey ?? ""}`,
    "content-type": "application/json",
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function loadRemoteState(fallbackUsers: User[]): Promise<TrackerState> {
  const [users, sessions, roster, matches] = await Promise.all([
    request<User[]>("users?select=*"),
    request<RemoteSession[]>("sessions?select=*"),
    request<RemoteRosterEntry[]>("session_roster?select=*"),
    request<RemoteMatch[]>("matches?select=*"),
  ]);

  if (users.length === 0 && fallbackUsers.length > 0) {
    await request<User[]>("users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(fallbackUsers),
    });
  }

  const mergedUsers = mergeFallbackUsers(users, fallbackUsers, roster);
  const missingFallbackUsers = mergedUsers.filter(
    (user) => !users.some((existingUser) => existingUser.id === user.id),
  );
  if (missingFallbackUsers.length > 0) {
    await request("users", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(missingFallbackUsers),
    });
  }

  return {
    users: mergedUsers,
    sessions: sessions.map(fromRemoteSession),
    roster: roster.map(fromRemoteRoster),
    matches: matches.map(fromRemoteMatch),
  };
}

export async function remoteAddUser(user: User) {
  const existingUser = await findRemoteUserByName(user.name);
  if (existingUser) return existingUser;

  await request("users", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(user),
  });
  return user;
}

export async function remoteCreateSession(session: Session, roster: RosterEntry[], users: User[]) {
  const rosterUsers = users.filter((user) => roster.some((entry) => entry.userId === user.id));
  if (rosterUsers.length > 0) {
    await request("users", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(rosterUsers),
    });
  }

  await request(`sessions?slug=eq.${encodeURIComponent(session.slug)}&status=eq.Active`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Closed", ended_at: new Date().toISOString() }),
  });
  await request("sessions", {
    method: "POST",
    body: JSON.stringify(toRemoteSession(session)),
  });
  if (roster.length > 0) {
    await request("session_roster", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(roster.map(toRemoteRoster)),
    });
  }
}

export async function remoteJoinSession(user: User, sessionId: string) {
  const remoteUser = await remoteAddUser(user);
  await request("session_roster", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(toRemoteRoster({ sessionId, userId: remoteUser.id, paid: false })),
  });
  return remoteUser;
}

export async function remoteEndSession(sessionId: string) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Closed", ended_at: new Date().toISOString() }),
  });
}

export async function remoteSetPaid(sessionId: string, userIds: string[], paid: boolean) {
  await Promise.all(
    userIds.map((userId) =>
      request(
        `session_roster?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ paid }),
        },
      ),
    ),
  );
}

export async function remoteAddMatch(match: Match) {
  await request("matches", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(toRemoteMatch(match)),
  });
}

export async function remoteDeleteMatch(matchId: string) {
  await request(`matches?id=eq.${encodeURIComponent(matchId)}`, { method: "DELETE" });
}

function fromRemoteSession(session: RemoteSession): Session {
  return {
    id: session.id,
    slug: session.slug,
    date: session.date,
    courtPrice: session.court_price,
    shuttlePrice: session.shuttle_price,
    shuttlesPerTube: session.shuttles_per_tube,
    matchDuration: session.match_duration,
    totalCourtTime: session.total_court_time,
    feePerPerson: session.fee_per_person,
    status: session.status,
    createdAt: session.created_at,
    endedAt: session.ended_at ?? undefined,
  };
}

function toRemoteSession(session: Session): RemoteSession {
  return {
    id: session.id,
    slug: session.slug,
    date: session.date,
    court_price: session.courtPrice,
    shuttle_price: session.shuttlePrice,
    shuttles_per_tube: session.shuttlesPerTube,
    match_duration: session.matchDuration,
    total_court_time: session.totalCourtTime,
    fee_per_person: session.feePerPerson,
    status: session.status,
    created_at: session.createdAt,
    ended_at: session.endedAt,
  };
}

function fromRemoteRoster(entry: RemoteRosterEntry): RosterEntry {
  return { sessionId: entry.session_id, userId: entry.user_id, paid: entry.paid };
}

function toRemoteRoster(entry: RosterEntry): RemoteRosterEntry {
  return { session_id: entry.sessionId, user_id: entry.userId, paid: entry.paid };
}

function fromRemoteMatch(match: RemoteMatch): Match {
  return {
    id: match.id,
    sessionId: match.session_id,
    createdAt: match.created_at,
    playerAId: match.player_a_id,
    playerBId: match.player_b_id,
    score: match.score ?? undefined,
    status: match.status,
  };
}

function toRemoteMatch(match: Match): RemoteMatch {
  return {
    id: match.id,
    session_id: match.sessionId,
    created_at: match.createdAt,
    player_a_id: match.playerAId,
    player_b_id: match.playerBId,
    score: match.score,
    status: match.status,
  };
}

async function findRemoteUserByName(name: string): Promise<User | undefined> {
  const normalizedName = name.trim();
  if (!normalizedName) return undefined;
  const users = await request<User[]>(
    `users?select=*&name=ilike.${encodeURIComponent(normalizedName)}`,
  );
  return users[0];
}

function mergeFallbackUsers(
  remoteUsers: User[],
  fallbackUsers: User[],
  remoteRoster: RemoteRosterEntry[],
): User[] {
  const usersById = new Map(remoteUsers.map((user) => [user.id, user]));
  const rosterUserIds = new Set(remoteRoster.map((entry) => entry.user_id));

  fallbackUsers.forEach((fallbackUser) => {
    if (rosterUserIds.has(fallbackUser.id) && !usersById.has(fallbackUser.id)) {
      usersById.set(fallbackUser.id, fallbackUser);
    }
  });

  return Array.from(usersById.values());
}
