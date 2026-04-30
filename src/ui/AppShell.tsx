import { useLayoutEffect } from "react";
import { Link, useLocation, useMatch, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { AdminView } from "./AdminView";
import { PlayerView } from "./PlayerView";
import { useTrackerStore } from "../lib/store";

export function AppShell() {
  const location = useLocation();
  const { slug = "smash-tracker" } = useParams();
  const adminMatch = useMatch("/:slug/admin");
  const adminDetailMatch = useMatch("/:slug/admin/:reportSessionId");
  const sessionMatch = useMatch("/:slug/session/:sessionId");
  const mode = adminMatch || adminDetailMatch ? "admin" : "player";
  const reportSessionId = adminDetailMatch?.params.reportSessionId;
  const sessionId = sessionMatch?.params.sessionId;
  const shouldCreateSession = new URLSearchParams(location.search).get("create") === "1";
  const store = useTrackerStore();
  const activeSession = sessionId
    ? store.state.sessions.find((session) => session.id === sessionId && session.status === "Active")
    : store.state.sessions.find(
        (session) => session.slug === slug && session.status === "Active",
      );

  useLayoutEffect(() => {
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <>
      <main className="app-shell">
        <MainNav
          activeSessionId={activeSession?.id}
          className="desktop-nav"
          mode={mode}
          slug={slug}
        />

        <div className={`route-view route-view-${mode}`}>
          {mode === "admin" ? (
            <AdminView
              slug={slug}
              store={store}
              initialSessionId={reportSessionId}
              initialCreate={shouldCreateSession}
            />
          ) : (
            <PlayerView slug={slug} sessionId={sessionId} store={store} activeSession={activeSession} />
          )}
        </div>
      </main>
      {createPortal(
        <MainNav
          activeSessionId={activeSession?.id}
          className="mobile-bottom-nav"
          mode={mode}
          slug={slug}
        />,
        document.body,
      )}
    </>
  );
}

function MainNav({
  activeSessionId,
  className,
  mode,
  slug,
}: {
  activeSessionId?: string;
  className: string;
  mode: "admin" | "player";
  slug: string;
}) {
  return (
    <nav className={`top-nav ${className}`} aria-label="Main navigation">
      <Link
        to={activeSessionId ? `/${slug}/session/${activeSessionId}` : `/${slug}`}
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
  );
}
