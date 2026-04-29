export type SessionStatus = "Active" | "Closed";
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
  date: string;
  courtPrice: number;
  shuttlePrice: number;
  shuttlesPerTube: number;
  matchDuration: number;
  totalCourtTime: number;
  feePerPerson: number;
  status: SessionStatus;
  createdAt: string;
  endedAt?: string;
};

export type RosterEntry = {
  sessionId: string;
  userId: string;
  paid: boolean;
};

export type Match = {
  id: string;
  sessionId: string;
  createdAt: string;
  playerAId: string;
  playerBId: string;
  score?: string;
  status: "Valid";
};

export type TrackerState = {
  users: User[];
  sessions: Session[];
  roster: RosterEntry[];
  matches: Match[];
};

export type PlayerBill = {
  user: User;
  userIds: string[];
  matchesPlayed: number;
  totalDue: number;
  paid: boolean;
};
