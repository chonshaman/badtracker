export type ScoreParts = {
  current: string;
  opponent: string;
};

export type ScoreResult = {
  formattedScore: string;
  playerWon: boolean;
};

export function formatScorePart(value: string): string {
  return value.replace(/\D/g, "").slice(0, 2);
}

export function scoreForSubmit(playerScore: string, opponentScore: string): string | undefined {
  const first = formatScorePart(playerScore);
  const second = formatScorePart(opponentScore);
  return first && second ? `${first}-${second}` : undefined;
}

export function scoreForMatchSubmit(
  playerScore: string,
  opponentScore: string,
  isCurrentPlayerA: boolean,
): string | undefined {
  const first = formatScorePart(playerScore);
  const second = formatScorePart(opponentScore);
  if (!first || !second) return undefined;
  return isCurrentPlayerA ? `${first}-${second}` : `${second}-${first}`;
}

export function readScoreResult(score: string): ScoreResult | null {
  const digits = score.replace(/\D/g, "");
  if (digits.length !== 4) return null;

  const playerScore = Number(digits.slice(0, 2));
  const opponentScore = Number(digits.slice(2));
  if (!Number.isFinite(playerScore) || !Number.isFinite(opponentScore) || playerScore === opponentScore) {
    return null;
  }

  return {
    formattedScore: `${digits.slice(0, 2)}-${digits.slice(2)}`,
    playerWon: playerScore > opponentScore,
  };
}

export function readScoreResultFromParts(playerScore: string, opponentScore: string): ScoreResult | null {
  const normalizedScore = scoreForSubmit(playerScore, opponentScore);
  return normalizedScore ? readScoreResult(normalizedScore) : null;
}

export function splitScoreForPlayer(
  score: string | undefined,
  isCurrentPlayerA: boolean,
): { player: string; opponent: string } {
  if (!score) return { player: "", opponent: "" };
  const [firstScore, secondScore] = score.split(/[-:]/).map((value) => formatScorePart(value));
  if (!firstScore || !secondScore) return { player: "", opponent: "" };
  return isCurrentPlayerA
    ? { player: firstScore, opponent: secondScore }
    : { player: secondScore, opponent: firstScore };
}

export function hasRecordedScore(score: string | undefined): boolean {
  return /^\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*$/.test(score ?? "");
}

export function matchScoreParts(score: string | undefined, isCurrentPlayerA: boolean): ScoreParts {
  if (!hasRecordedScore(score)) return { current: "-", opponent: "-" };
  const [firstScore, secondScore] = score!.split(/[-:]/).map((value) => value.trim());
  return isCurrentPlayerA
    ? { current: firstScore, opponent: secondScore }
    : { current: secondScore, opponent: firstScore };
}

export function applyPlayerScoreInput(value: string): {
  playerScore: string;
  opponentScore?: string;
  focusOpponent: boolean;
} {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) {
    return {
      playerScore: digits.slice(0, 2),
      opponentScore: digits.slice(2),
      focusOpponent: true,
    };
  }

  return {
    playerScore: digits,
    focusOpponent: digits.length === 2,
  };
}

export function applyOpponentScoreInput(
  value: string,
  inputType?: string,
): { opponentScore: string; focusPlayer: boolean } {
  const opponentScore = formatScorePart(value);
  return {
    opponentScore,
    focusPlayer: !opponentScore && inputType === "deleteContentBackward",
  };
}
