import { Link, useParams } from "react-router-dom";
import { AdminView } from "./AdminView";
import { PlayerView } from "./PlayerView";
import { useTrackerStore } from "../lib/store";

type AppShellProps = {
  mode: "admin" | "player";
};

export function AppShell({ mode }: AppShellProps) {
  const { slug = "smash-tracker" } = useParams();
  const store = useTrackerStore();
  const activeSession = store.state.sessions.find(
    (session) => session.slug === slug && session.status === "Active",
  );

  return (
    <main className="app-shell">
      <nav className="top-nav" aria-label="Main navigation">
        <Link to={`/${slug}`} className={mode === "player" ? "nav-pill active" : "nav-pill"}>
          Player
        </Link>
        <Link
          to={`/${slug}/admin`}
          className={mode === "admin" ? "nav-pill active" : "nav-pill"}
        >
          Admin
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
