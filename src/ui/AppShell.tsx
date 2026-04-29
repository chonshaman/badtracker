import { Link, useParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import { AdminView } from "./AdminView";
import { PlayerView } from "./PlayerView";
import { useTrackerStore } from "../lib/store";

type AppShellProps = {
  mode: "admin" | "player";
};

export function AppShell({ mode }: AppShellProps) {
  const { slug = "smash-tracker", sessionId } = useParams();
  const store = useTrackerStore();
  const claimedSessionId = useRef<string | null>(null);
  const activeSession = sessionId
    ? store.state.sessions.find((session) => session.id === sessionId && session.status === "Active")
    : store.state.sessions.find(
        (session) => session.slug === slug && session.status === "Active",
      );

  useEffect(() => {
    if (mode === "player" && sessionId && store.isRemoteEnabled) {
      if (claimedSessionId.current === sessionId) return;
      claimedSessionId.current = sessionId;
      store.claimSessionAccess(sessionId, "player");
    }
  }, [mode, sessionId, store]);

  return (
    <main className="app-shell">
      <nav className="top-nav" aria-label="Main navigation">
        <Link
          to={activeSession ? `/${slug}/session/${activeSession.id}` : `/${slug}`}
          className={mode === "player" ? "nav-pill active" : "nav-pill"}
        >
          Player
        </Link>
        <Link
          to={`/${slug}/admin`}
          className={mode === "admin" ? "nav-pill active" : "nav-pill"}
        >
          Reports
        </Link>
      </nav>

      {mode === "admin" ? (
        <AdminView slug={slug} store={store} />
      ) : (
        <PlayerView slug={slug} store={store} activeSession={activeSession} />
      )}
    </main>
  );
}
