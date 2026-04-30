import type { Preset, TrackerState } from "../types";

export const presets: Preset[] = [
  {
    id: "standard-a-yonex",
    name: "Standard San A + Yonex",
    courtPrice: 480_000,
    shuttlePrice: 420_000,
    shuttlesPerTube: 12,
    matchDuration: 10,
    totalCourtTime: 240,
  },
  {
    id: "saturday-afternoon",
    name: "KDT + Tien Bo",
    courtPrice: 480_000,
    shuttlePrice: 280_000,
    shuttlesPerTube: 12,
    matchDuration: 10,
    totalCourtTime: 240,
  },
];

export const defaultState: TrackerState = {
  users: [
    { id: "u-nhat", name: "Nhat", role: "Player", type: "Regular" },
    { id: "u-hung", name: "Hung", role: "Player", type: "Regular" },
    { id: "u-tuan", name: "Tuan", role: "Player", type: "Regular" },
    { id: "u-duy", name: "Duy", role: "Player", type: "Regular" },
    { id: "u-chon", name: "Chồn", role: "Player", type: "Regular" },
  ],
  sessions: [],
  roster: [],
  participants: [],
  matches: [],
};
