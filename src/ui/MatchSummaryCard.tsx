import { Link } from "react-router-dom";
import type { To } from "react-router-dom";
import type { Match } from "../types";
import { BadmintonIcon, ChevronRight, ShuttleIcon } from "./icons";

type MatchSummaryCardProps = {
  match: Match;
  number: number;
  sessionName: string;
  currentPlayerId: string;
  currentPlayerName: string;
  opponentName: string;
  isCurrentPlayerHost?: boolean;
  isOpponentHost?: boolean;
  to?: To;
  state?: unknown;
  isHighlighted?: boolean;
  id?: string;
  showSessionName?: boolean;
  canToggleStake?: boolean;
  onToggleStake?: () => void;
};

export function MatchSummaryCard({
  match,
  number,
  sessionName,
  currentPlayerId,
  currentPlayerName,
  opponentName,
  isCurrentPlayerHost = false,
  isOpponentHost = false,
  to,
  state,
  isHighlighted = false,
  id,
  showSessionName = true,
  canToggleStake = false,
  onToggleStake,
}: MatchSummaryCardProps) {
  const isStakeWinner = match.isStake && match.winnerId === currentPlayerId;
  const scoreParts = matchScoreParts(match.score, match.playerAId === currentPlayerId);
  const opponentId = match.playerAId === currentPlayerId ? match.playerBId : match.playerAId;
  const isCurrentPlayerStakeLoser = Boolean(match.isStake && match.winnerId && match.winnerId !== currentPlayerId);
  const isOpponentStakeLoser = Boolean(match.isStake && match.winnerId && match.winnerId !== opponentId);
  const className = [
    "match-card",
    match.isStake ? (isStakeWinner ? "stake-win" : "stake-loss") : "",
    isHighlighted ? "highlighted-match" : "",
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <div className="match-card-scoreboard">
        <div className="match-player-line with-divider">
          <span className="match-player-name">
            {!match.score ? <BadmintonIcon size={16} /> : null}
            {currentPlayerName}
            {isCurrentPlayerHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-side">
            {isCurrentPlayerStakeLoser ? (
              <StakeControl isActive={match.isStake} canToggle={canToggleStake} onToggle={onToggleStake} />
            ) : null}
            <span className="match-score-bubble score-primary">{scoreParts.current}</span>
          </span>
        </div>
        <div className="match-player-line">
          <span className="match-player-name">
            {!match.score ? <BadmintonIcon size={16} /> : null}
            {opponentName}
            {isOpponentHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-side">
            {isOpponentStakeLoser ? (
              <StakeControl isActive={match.isStake} canToggle={canToggleStake} onToggle={onToggleStake} />
            ) : null}
            <span className="match-score-bubble score-secondary">{scoreParts.opponent}</span>
          </span>
        </div>
      </div>
      <div className="match-card-footer">
        <span>#{number} - {formatTime(match.createdAt)}</span>
        {canToggleStake && !match.isStake ? (
          <StakeControl isActive={false} canToggle={canToggleStake} onToggle={onToggleStake} />
        ) : null}
        {showSessionName || to ? (
          <span className="match-card-session">
            {showSessionName ? (
              <span className="session-name-with-icon">
                <ShuttleIcon className="shuttle-icon" size={16} />
                <span>{sessionName}</span>
              </span>
            ) : null}
            {to ? <ChevronRight size={18} /> : null}
          </span>
        ) : null}
      </div>
    </>
  );

  if (to) {
    return (
      <Link className={className} to={to} state={state}>
        {content}
      </Link>
    );
  }

  return (
    <article className={className} id={id}>
      {content}
    </article>
  );
}

function StakeControl({
  isActive,
  canToggle,
  onToggle,
}: {
  isActive: boolean;
  canToggle: boolean;
  onToggle?: () => void;
}) {
  const className = isActive ? "match-stake-toggle active" : "match-stake-toggle";
  if (!canToggle) return <span className={className}>Loser pay all</span>;

  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.();
      }}
    >
      Loser pay all
    </button>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function matchScoreParts(score: string | undefined, isCurrentPlayerA: boolean): { current: string; opponent: string } {
  if (!score) return { current: "-", opponent: "-" };
  const [firstScore, secondScore] = score.split(/[-:]/).map((value) => value.trim());
  if (!firstScore || !secondScore) return { current: "-", opponent: "-" };
  return isCurrentPlayerA
    ? { current: firstScore, opponent: secondScore }
    : { current: secondScore, opponent: firstScore };
}
