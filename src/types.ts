export type SessionStatus = "Active" | "Closed";
export type BillingMethod = "standard" | "casual";
export type UserRole = "Admin" | "Player";
export type UserType = "Regular" | "Temp";

export type Preset = {
  id: string;
  name: string;
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
};

export type User = {
  id: string;
  name: string;
  role: UserRole;
  type: UserType;
};

export type Session = {
  id: string;
  slug: string;
  name?: string;
  pinCode?: string;
  date: string;
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
  billingMethod: BillingMethod;
  status: SessionStatus;
  createdAt: string;
  endedAt?: string;
};

export type RosterEntry = {
  sessionId: string;
  userId: string;
  paid: boolean;
  isPresent: boolean;
  isHost: boolean;
};

export type SessionPublicInfo = {
  sessionName?: string;
  sessionDate?: string;
  hostName?: string;
};

export type SessionParticipant = {
  sessionId: string;
  userId: string;
  role: "host" | "player";
  joinedAt: string;
};

export type Match = {
  id: string;
  sessionId: string;
  createdAt: string;
  playerAId: string;
  playerBId: string;
  isStake: boolean;
  winnerId?: string;
  score?: string;
  status: "Valid";
};

export type SessionActivityType =
  | "session_created"
  | "session_closed"
  | "player_joined"
  | "player_added"
  | "player_removed"
  | "present_changed"
  | "paid_changed"
  | "billing_method_changed"
  | "court_price_changed"
  | "match_duration_changed"
  | "total_court_time_changed"
  | "match_added"
  | "match_removed"
  | "match_score_updated"
  | "match_stake_changed";

export type SessionActivity = {
  id: string;
  sessionId: string;
  createdAt: string;
  type: SessionActivityType;
  actorUserId?: string;
  targetUserId?: string;
  matchId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type TrackerState = {
  users: User[];
  sessions: Session[];
  roster: RosterEntry[];
  participants: SessionParticipant[];
  matches: Match[];
  activities: SessionActivity[];
};

export type PlayerBill = {
  user: User;
  userIds: string[];
  isPresent: boolean;
  isHost: boolean;
  courtShare: number;
  shuttleFee: number;
  matchesPlayed: number;
  totalDue: number;
  paid: boolean;
};
