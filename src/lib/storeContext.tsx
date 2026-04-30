import { createContext, useContext } from "react";
import { useTrackerStore } from "./store";

export type TrackerStore = ReturnType<typeof useTrackerStore>;

const StoreContext = createContext<TrackerStore | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const store = useTrackerStore();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within StoreProvider");
  return store;
}
