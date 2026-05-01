import { Link } from "react-router-dom";
import type { To } from "react-router-dom";
import { hasRecordedScore, matchScoreParts } from "../lib/scoreFlow";
import type { Match } from "../types";
import { ChevronRight, ShuttleIcon, Trash2 } from "./icons";

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
  onAddScore?: () => void;
  onDelete?: () => void;
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
  onAddScore,
  onDelete,
}: MatchSummaryCardProps) {
  const hasScore = hasRecordedScore(match.score);
  const isStakeWinner = match.isStake && match.winnerId === currentPlayerId;
  const scoreParts = matchScoreParts(match.score, match.playerAId === currentPlayerId);
  const opponentId = match.playerAId === currentPlayerId ? match.playerBId : match.playerAId;
  const isCurrentPlayerStakeLoser = Boolean(match.isStake && match.winnerId && match.winnerId !== currentPlayerId);
  const isOpponentStakeLoser = Boolean(match.isStake && match.winnerId && match.winnerId !== opponentId);
  const className = [
    "match-card",
    match.isStake ? (isStakeWinner ? "stake-win" : "stake-loss") : "",
    !hasScore ? "no-score" : "",
    onAddScore && !hasScore ? "has-add-score" : "",
    isHighlighted ? "highlighted-match" : "",
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <div className="match-card-scoreboard">
        <div className="match-player-line with-divider">
          <span className="match-player-name">
            {currentPlayerName}
            {isCurrentPlayerHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-side">
            {isCurrentPlayerStakeLoser ? (
              <StakeControl isActive={match.isStake} canToggle={canToggleStake} onToggle={onToggleStake} />
            ) : null}
            {hasScore ? <span className="match-score-bubble score-primary">{scoreParts.current}</span> : null}
          </span>
        </div>
        <div className="match-player-line">
          <span className="match-player-name">
            {opponentName}
            {isOpponentHost ? <span className="host-badge match-host-badge">Host</span> : null}
          </span>
          <span className="match-score-side">
            {isOpponentStakeLoser ? (
              <StakeControl isActive={match.isStake} canToggle={canToggleStake} onToggle={onToggleStake} />
            ) : null}
            {hasScore ? <span className="match-score-bubble score-secondary">{scoreParts.opponent}</span> : null}
          </span>
        </div>
      </div>
      <div className="match-card-footer">
        <span>#{number} - {formatTime(match.createdAt)}</span>
        {onDelete ? (
          <button
            type="button"
            className="match-delete-button"
            aria-label={`Delete match #${number}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={16} />
          </button>
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

  if (to && onAddScore && !hasScore) {
    return (
      <article className={className} id={id}>
        <Link className="match-card-main-link" to={to} state={state} aria-label={`Open report for ${sessionName}`}>
          {content}
        </Link>
        <button
          type="button"
          className="match-add-score-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAddScore();
          }}
        >
          Add score
        </button>
      </article>
    );
  }

  if (to) {
    return (
      <Link className={className} to={to} state={state} id={id}>
        {content}
      </Link>
    );
  }

  return <article className={className} id={id}>{content}</article>;
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
  if (!canToggle) return <span className={className}>Lower score pay all</span>;

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
      Lower score pay all
    </button>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
