import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyOpponentScoreInput,
  applyPlayerScoreInput,
  readScoreResultFromParts,
  scoreForMatchSubmit,
  scoreForSubmit,
  splitScoreForPlayer,
} from "../../lib/scoreFlow";
import type { Match, User } from "../../types";
import { ToggleLeft, ToggleRight, X } from "../icons";

export function RecordMatchModal({
  currentUser,
  opponents,
  initialOpponentId,
  onClose,
  onSubmit,
}: {
  currentUser: User;
  opponents: User[];
  initialOpponentId: string;
  onClose: () => void;
  onSubmit: (opponentId: string, score: string | undefined, isStake: boolean, winnerId?: string) => void;
}) {
  const [opponentId] = useState(initialOpponentId);
  const [playerScore, setPlayerScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");
  const [timeLeft, setTimeLeft] = useState(30);
  const [isScoreTimerPaused, setIsScoreTimerPaused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStake, setIsStake] = useState(false);
  const submitLock = useRef(false);
  const firstScoreInputRef = useRef<HTMLInputElement>(null);
  const secondScoreInputRef = useRef<HTMLInputElement>(null);
  const scoreIdleTimerRef = useRef<number | null>(null);
  const selectedOpponent = opponents.find((opponent) => opponent.id === opponentId);
  const scoreResult = readScoreResultFromParts(playerScore, opponentScore);
  const inferredWinnerId = scoreResult
    ? scoreResult.playerWon
      ? currentUser.id
      : selectedOpponent?.id
    : undefined;

  useEffect(() => {
    if (submitLock.current || isScoreTimerPaused) return;
    const intervalId = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          handleSubmit();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [opponentId, isScoreTimerPaused, isStake]);

  useEffect(() => {
    return () => {
      if (scoreIdleTimerRef.current) window.clearTimeout(scoreIdleTimerRef.current);
    };
  }, []);

  function pauseCountdownForScoreEntry() {
    setIsScoreTimerPaused(true);
    if (scoreIdleTimerRef.current) window.clearTimeout(scoreIdleTimerRef.current);
    scoreIdleTimerRef.current = window.setTimeout(() => {
      setIsScoreTimerPaused(false);
      scoreIdleTimerRef.current = null;
    }, 30_000);
  }

  function handleSubmit() {
    if (!opponentId || submitLock.current) return;
    if (isStake && !inferredWinnerId) return;
    submitLock.current = true;
    setIsSubmitting(true);
    onSubmit(opponentId, scoreForSubmit(playerScore, opponentScore), isStake, isStake ? inferredWinnerId : undefined);
  }

  function handlePlayerScoreChange(value: string) {
    pauseCountdownForScoreEntry();
    const next = applyPlayerScoreInput(value);
    setPlayerScore(next.playerScore);
    if (next.opponentScore !== undefined) setOpponentScore(next.opponentScore);
    if (next.focusOpponent) secondScoreInputRef.current?.focus();
  }

  function handleOpponentScoreChange(value: string, inputType?: string) {
    pauseCountdownForScoreEntry();
    const next = applyOpponentScoreInput(value, inputType);
    setOpponentScore(next.opponentScore);
    if (next.focusPlayer) firstScoreInputRef.current?.focus();
  }

  const stakeCaption = scoreResult ? (
    scoreResult.playerWon ? (
      <>
        {scoreResult.formattedScore}: <span className="stake-caption-win">{currentUser.name} (You) wins</span>
        {", "}
        <span className="stake-caption-loss">{selectedOpponent?.name ?? "Opponent"} has the lower score.</span>
      </>
    ) : (
      <>
        {scoreResult.formattedScore}: <span className="stake-caption-loss">{currentUser.name} (You) has the lower score</span>
        {", "}
        <span className="stake-caption-win">{selectedOpponent?.name ?? "Opponent"} wins.</span>
      </>
    )
  ) : null;

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Record match">
      <form
        className="match-modal"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <button type="button" className="close-button" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <p className="eyebrow">New match</p>
        <h2>{currentUser.name} vs {selectedOpponent?.name}</h2>
        <div className="score-entry-grid">
          <label>
            {currentUser.name}
            <input
              ref={firstScoreInputRef}
              inputMode="numeric"
              placeholder="0"
              value={playerScore}
              onChange={(event) => handlePlayerScoreChange(event.target.value)}
            />
          </label>
          <label>
            {selectedOpponent?.name ?? "Opponent"}
            <input
              ref={secondScoreInputRef}
              inputMode="numeric"
              placeholder="0"
              value={opponentScore}
              onChange={(event) => {
                handleOpponentScoreChange(event.target.value, (event.nativeEvent as InputEvent).inputType);
              }}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && event.currentTarget.selectionStart === 0) firstScoreInputRef.current?.focus();
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="stake-control"
          aria-pressed={isStake}
          onClick={() => setIsStake((current) => !current)}
        >
          <div className="stake-control-copy">
            <span>Lower score pay all (2 chai)</span>
            <p className={["stake-caption", stakeCaption ? "visible" : ""].filter(Boolean).join(" ")} aria-live="polite">
              {stakeCaption || "Lower score pays."}
            </p>
          </div>
          <span className="stake-icon-toggle" aria-hidden="true">
            {isStake ? <ToggleRight size={34} /> : <ToggleLeft size={34} />}
          </span>
        </button>
        {isStake && !scoreResult ? (
          <p className="stake-warning">
            Enter a score first. Example: 2119 means {currentUser.name} wins, 1721 means {currentUser.name} has the lower score.
          </p>
        ) : null}
        <div className="modal-action-row">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!opponentId || isSubmitting || (isStake && !scoreResult)}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
        <div className="auto-submit-status" aria-live="polite">
          <span style={{ width: `${(timeLeft / 30) * 100}%` }} />
          <i aria-hidden="true" />
          <small>Auto-submitting in {timeLeft}s...</small>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function EditScoreModal({
  match,
  currentUser,
  users,
  onClose,
  onSubmit,
}: {
  match?: Match;
  currentUser: User;
  users: User[];
  onClose: () => void;
  onSubmit: (score: string | undefined) => void;
}) {
  const isCurrentPlayerA = match?.playerAId === currentUser.id;
  const opponentId = match ? (isCurrentPlayerA ? match.playerBId : match.playerAId) : undefined;
  const opponent = users.find((user) => user.id === opponentId);
  const initialScores = splitScoreForPlayer(match?.score, isCurrentPlayerA);
  const [playerScore, setPlayerScore] = useState(initialScores.player);
  const [opponentScore, setOpponentScore] = useState(initialScores.opponent);
  const firstScoreInputRef = useRef<HTMLInputElement>(null);
  const secondScoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstScoreInputRef.current?.focus();
  }, []);

  if (!match) return null;

  function handlePlayerScoreChange(value: string) {
    const next = applyPlayerScoreInput(value);
    setPlayerScore(next.playerScore);
    if (next.opponentScore !== undefined) setOpponentScore(next.opponentScore);
    if (next.focusOpponent) secondScoreInputRef.current?.focus();
  }

  function handleOpponentScoreChange(value: string, inputType?: string) {
    const next = applyOpponentScoreInput(value, inputType);
    setOpponentScore(next.opponentScore);
    if (next.focusPlayer) firstScoreInputRef.current?.focus();
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit score">
      <form
        className="match-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(scoreForMatchSubmit(playerScore, opponentScore, isCurrentPlayerA));
        }}
      >
        <button type="button" className="close-button" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <p className="eyebrow">Add score</p>
        <h2>{currentUser.name} vs {opponent?.name ?? "Opponent"}</h2>
        <div className="score-entry-grid">
          <label>
            {currentUser.name}
            <input ref={firstScoreInputRef} inputMode="numeric" placeholder="21" value={playerScore} onChange={(event) => handlePlayerScoreChange(event.target.value)} />
          </label>
          <label>
            {opponent?.name ?? "Opponent"}
            <input
              ref={secondScoreInputRef}
              inputMode="numeric"
              placeholder="19"
              value={opponentScore}
              onChange={(event) => handleOpponentScoreChange(event.target.value, (event.nativeEvent as InputEvent).inputType)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && event.currentTarget.selectionStart === 0) firstScoreInputRef.current?.focus();
              }}
            />
          </label>
        </div>
        <div className="modal-action-row">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save score
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
