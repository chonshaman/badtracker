import { createClient } from "@supabase/supabase-js";
import type { BillingMethod, Match, RosterEntry, Session, SessionParticipant, TrackerState, User } from "../types";

const supabaseUrl: string | undefined =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey: string | undefined =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (import.meta.env.DEV && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn("[badtracker] Supabase env vars not set. App will run in local-only mode.");
}

export const isRemoteEnabled = Boolean(supabaseUrl && supabaseAnonKey);

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
let anonymousSignInPromise: ReturnType<typeof createAnonymousSession> | null = null;

type RemoteSession = {
  id: string;
  slug: string;
  name?: string | null;
  pin_code?: string | null;
  date: string;
  court_price: number;
  shuttle_price: number;
  shuttles_per_tube: number;
  match_duration: number;
  total_court_time: number;
  fee_per_person: number;
  billing_method?: BillingMethod | null;
  status: Session["status"];
  created_at: string;
  ended_at?: string | null;
};

type RemoteRosterEntry = {
  session_id: string;
  user_id: string;
  paid: boolean;
  is_present?: boolean;
  is_host?: boolean;
};

type RemoteSessionParticipant = {
  session_id: string;
  user_id: string;
  role: SessionParticipant["role"];
  joined_at: string;
};

type RemoteMatch = {
  id: string;
  session_id: string;
  created_at: string;
  player_a_id: string;
  player_b_id: string;
  is_stake?: boolean;
  winner_id?: string | null;
  score?: string | null;
  status: "Valid";
};

async function createAnonymousSession() {
  const {
    data: { session: anonymousSession },
    error: signInError,
  } = await supabase!.auth.signInAnonymously();
  if (signInError) throw signInError;
  return anonymousSession ?? undefined;
}

async function ensureAnonymousSession() {
  if (!supabase) return undefined;

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return session;

  anonymousSignInPromise ??= createAnonymousSession();
  try {
    return await anonymousSignInPromise;
  } finally {
    anonymousSignInPromise = null;
  }
}

async function headers() {
  const session = await ensureAnonymousSession();
  return {
    apikey: supabaseAnonKey ?? "",
    authorization: `Bearer ${session?.access_token ?? supabaseAnonKey ?? ""}`,
    "content-type": "application/json",
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...(await headers()), ...init?.headers },
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
  const [users, sessions, roster, participants, matches] = await Promise.all([
    request<User[]>("users?select=*"),
    request<RemoteSession[]>("sessions?select=*"),
    request<RemoteRosterEntry[]>("session_roster?select=*"),
    request<RemoteSessionParticipant[]>("session_participants?select=*"),
    request<RemoteMatch[]>("matches?select=*"),
  ]);

  const remoteSessionIds = new Set(sessions.map((session) => session.id));
  const sessionRoster = roster.filter((entry) => remoteSessionIds.has(entry.session_id));
  const sessionParticipants = participants.filter((participant) => remoteSessionIds.has(participant.session_id));
  const sessionMatches = matches.filter((match) => remoteSessionIds.has(match.session_id));
  const mergedUsers = mergeFallbackUsers(users, fallbackUsers, sessionRoster);

  return {
    users: mergedUsers,
    sessions: sessions.map(fromRemoteSession),
    roster: sessionRoster.map(fromRemoteRoster),
    participants: sessionParticipants.map(fromRemoteParticipant),
    matches: sessionMatches.map(fromRemoteMatch),
  };
}

export async function seedDefaultUsers(fallbackUsers: User[]) {
  const existing = await request<User[]>("users?select=*");
  if (existing.length > 0 || fallbackUsers.length === 0) return;

  await request("users", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fallbackUsers),
  });
}

export function subscribeRemoteChanges(onChange: () => void): () => void {
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel("smash-tracker-db")
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "session_roster" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "session_participants" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, onChange)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function remoteClaimSessionAccess(sessionId: string, role: "host" | "player") {
  const session = await ensureAnonymousSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Unable to create anonymous session.");

  await request("session_participants", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      role,
    }),
  });
}

export async function remoteVerifySessionPin(sessionId: string, pinCode: string): Promise<boolean> {
  return request<boolean>("rpc/verify_session_pin", {
    method: "POST",
    body: JSON.stringify({
      p_session_id: sessionId,
      p_input_pin: pinCode,
    }),
  });
}

export async function remoteGetSessionLinkStatus(sessionId: string): Promise<"active" | "closed" | "missing"> {
  return request<"active" | "closed" | "missing">("rpc/session_link_status", {
    method: "POST",
    body: JSON.stringify({ p_session_id: sessionId }),
  });
}

export async function remoteAddUser(user: User) {
  const existingUser = await findRemoteUserByName(user.name);
  if (existingUser) return existingUser;

  try {
    await request("users", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(user),
    });
  } catch (error) {
    if (!isDuplicateNameError(error)) throw error;
    return (await findRemoteUserByName(user.name)) ?? user;
  }
  return user;
}

export async function remoteCreateSession(session: Session, roster: RosterEntry[], users: User[]) {
  const rosterUsers = users.filter((user) => roster.some((entry) => entry.userId === user.id));
  let remoteRoster = roster;
  if (rosterUsers.length > 0) {
    const remoteUsers = await Promise.all(rosterUsers.map((user) => remoteAddUser(user)));
    const remoteUserIdsByLocalId = new Map(
      rosterUsers.map((user, index) => [user.id, remoteUsers[index]?.id ?? user.id]),
    );
    remoteRoster = roster.map((entry) => ({
      ...entry,
      userId: remoteUserIdsByLocalId.get(entry.userId) ?? entry.userId,
    }));
  }

  await request(`sessions?slug=eq.${encodeURIComponent(session.slug)}&status=eq.Active`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Closed", ended_at: new Date().toISOString() }),
  });
  try {
    await request("sessions", {
      method: "POST",
      body: JSON.stringify(toRemoteSession(session)),
    });
  } catch (error) {
    if (!isMissingSessionOptionalColumn(error)) throw error;
    await request("sessions", {
      method: "POST",
      body: JSON.stringify(toRemoteSession(session, false)),
    });
  }
  await remoteClaimSessionAccess(session.id, "host");
  if (remoteRoster.length > 0) {
    await insertRemoteRoster(remoteRoster);
  }
}

export async function remoteJoinSession(user: User, sessionId: string) {
  const remoteUser = await remoteAddUser(user);
  await insertRemoteRoster([{ sessionId, userId: remoteUser.id, paid: false, isPresent: true, isHost: false }]);
  return remoteUser;
}

async function insertRemoteRoster(roster: RosterEntry[]) {
  try {
    await request("session_roster", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(roster.map((entry) => toRemoteRoster(entry))),
    });
  } catch (error) {
    if (!isMissingColumn(error, "is_host") && !isMissingColumn(error, "is_present")) throw error;
    try {
      await request("session_roster", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(roster.map((entry) => toRemoteRoster(entry, false, false))),
      });
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
}

export async function remoteEndSession(sessionId: string) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Closed", ended_at: new Date().toISOString() }),
  });
}

export async function remoteDeleteSession(sessionId: string) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export async function remoteUpdateCourtPrice(sessionId: string, courtPrice: number) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ court_price: courtPrice }),
  });
}

export async function remoteUpdateMatchDuration(sessionId: string, matchDuration: number) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ match_duration: matchDuration }),
  });
}

export async function remoteUpdateTotalCourtTime(sessionId: string, totalCourtTime: number) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ total_court_time: totalCourtTime }),
  });
}

export async function remoteUpdateBillingMethod(sessionId: string, billingMethod: BillingMethod) {
  await request(`sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ billing_method: billingMethod }),
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

export async function remoteSetPresent(sessionId: string, userIds: string[], isPresent: boolean) {
  await Promise.all(
    userIds.map((userId) =>
      request(
        `session_roster?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_present: isPresent }),
        },
      ),
    ),
  );
}

export async function remoteRemoveSessionPlayers(sessionId: string, userIds: string[]) {
  await Promise.all(
    userIds.map((userId) =>
      request(
        `session_roster?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
        { method: "DELETE" },
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
    name: session.name ?? undefined,
    pinCode: session.pin_code ?? undefined,
    date: session.date,
    courtPrice: session.court_price,
    shuttlePrice: session.shuttle_price,
    shuttlesPerTube: session.shuttles_per_tube,
    matchDuration: session.match_duration,
    totalCourtTime: session.total_court_time,
    feePerPerson: session.fee_per_person,
    billingMethod: session.billing_method ?? "standard",
    status: session.status,
    createdAt: session.created_at,
    endedAt: session.ended_at ?? undefined,
  };
}

function toRemoteSession(session: Session, includeName = true): RemoteSession {
  const remoteSession: RemoteSession = {
    id: session.id,
    slug: session.slug,
    name: includeName ? session.name : undefined,
    pin_code: includeName ? session.pinCode : undefined,
    date: session.date,
    court_price: session.courtPrice,
    shuttle_price: session.shuttlePrice,
    shuttles_per_tube: session.shuttlesPerTube,
    match_duration: session.matchDuration,
    total_court_time: session.totalCourtTime,
    fee_per_person: session.feePerPerson,
    billing_method: includeName ? session.billingMethod : undefined,
    status: session.status,
    created_at: session.createdAt,
    ended_at: session.endedAt,
  };
  if (!includeName) {
    delete remoteSession.name;
    delete remoteSession.pin_code;
    delete remoteSession.billing_method;
  }
  return remoteSession;
}

function fromRemoteRoster(entry: RemoteRosterEntry): RosterEntry {
  return {
    sessionId: entry.session_id,
    userId: entry.user_id,
    paid: entry.paid,
    isPresent: entry.is_present ?? true,
    isHost: entry.is_host ?? false,
  };
}

function toRemoteRoster(entry: RosterEntry, includeHost = true, includePresent = true): RemoteRosterEntry {
  const remoteEntry: RemoteRosterEntry = {
    session_id: entry.sessionId,
    user_id: entry.userId,
    paid: entry.paid,
  };
  if (includePresent) remoteEntry.is_present = entry.isPresent;
  if (includeHost) remoteEntry.is_host = entry.isHost;
  return remoteEntry;
}

function fromRemoteParticipant(entry: RemoteSessionParticipant): SessionParticipant {
  return {
    sessionId: entry.session_id,
    userId: entry.user_id,
    role: entry.role,
    joinedAt: entry.joined_at,
  };
}

function fromRemoteMatch(match: RemoteMatch): Match {
  return {
    id: match.id,
    sessionId: match.session_id,
    createdAt: match.created_at,
    playerAId: match.player_a_id,
    playerBId: match.player_b_id,
    isStake: Boolean(match.is_stake),
    winnerId: match.winner_id ?? undefined,
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
    is_stake: match.isStake,
    winner_id: match.winnerId,
    score: match.score,
    status: match.status,
  };
}

function isMissingSessionOptionalColumn(error: unknown): boolean {
  return isMissingColumn(error, "name") || isMissingColumn(error, "pin_code") || isMissingColumn(error, "billing_method");
}

function isMissingColumn(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
}

function isDuplicateNameError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("23505") && message.includes("users_name_key");
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
