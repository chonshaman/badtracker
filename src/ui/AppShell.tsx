import { lazy, Suspense, useLayoutEffect } from "react";
import { Link, useLocation, useMatch, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { useStore } from "../lib/storeContext";
import { ErrorBoundary } from "./ErrorBoundary";

const AdminView = lazy(() => import("./AdminView").then((module) => ({ default: module.AdminView })));
const PlayerView = lazy(() => import("./PlayerView").then((module) => ({ default: module.PlayerView })));

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
  const routeState = location.state as { backTo?: string; playerId?: string; highlightMatchId?: string } | null;
  const detailBackTo = routeState?.backTo;
  const detailPlayerId = routeState?.playerId;
  const detailHighlightMatchId = routeState?.highlightMatchId;
  const store = useStore();
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

        <ErrorBoundary resetKey={location.pathname}>
          <div className={`route-view route-view-${mode}`}>
            <Suspense fallback={<div className="route-loading">Loading court...</div>}>
              {mode === "admin" ? (
                <AdminView
                  slug={slug}
                  initialSessionId={reportSessionId}
                  initialCreate={shouldCreateSession}
                  detailBackTo={detailBackTo}
                  detailPlayerId={detailPlayerId}
                  detailHighlightMatchId={detailHighlightMatchId}
                />
              ) : (
                <PlayerView slug={slug} sessionId={sessionId} activeSession={activeSession} />
              )}
            </Suspense>
          </div>
        </ErrorBoundary>
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
