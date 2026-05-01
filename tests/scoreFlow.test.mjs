import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOpponentScoreInput,
  applyPlayerScoreInput,
  formatScorePart,
  hasRecordedScore,
  matchScoreParts,
  readScoreResultFromParts,
  scoreForMatchSubmit,
  scoreForSubmit,
  splitScoreForPlayer,
} from "../.test-dist/lib/scoreFlow.js";

describe("score entry parsing", () => {
  it("keeps only two score digits per input", () => {
    assert.equal(formatScorePart("2a199"), "21");
    assert.equal(formatScorePart("7"), "7");
  });

  it("moves to opponent input after two player digits", () => {
    assert.deepEqual(applyPlayerScoreInput("21"), {
      playerScore: "21",
      focusOpponent: true,
    });
  });

  it("splits continuous 4-digit score entry into both inputs", () => {
    assert.deepEqual(applyPlayerScoreInput("2119"), {
      playerScore: "21",
      opponentScore: "19",
      focusOpponent: true,
    });
  });

  it("moves back to player input when opponent score is deleted", () => {
    assert.deepEqual(applyOpponentScoreInput("", "deleteContentBackward"), {
      opponentScore: "",
      focusPlayer: true,
    });
  });

  it("does not move back when opponent score changes for other reasons", () => {
    assert.deepEqual(applyOpponentScoreInput("19", "insertText"), {
      opponentScore: "19",
      focusPlayer: false,
    });
  });
});

describe("score submit formatting", () => {
  it("submits undefined when no score is entered for rush auto-submit", () => {
    assert.equal(scoreForSubmit("", ""), undefined);
  });

  it("formats current-player score for new match submit", () => {
    assert.equal(scoreForSubmit("21", "19"), "21-19");
  });

  it("preserves match player order when editing scores", () => {
    assert.equal(scoreForMatchSubmit("21", "19", true), "21-19");
    assert.equal(scoreForMatchSubmit("21", "19", false), "19-21");
  });

  it("splits an existing score relative to the current player", () => {
    assert.deepEqual(splitScoreForPlayer("21-19", true), { player: "21", opponent: "19" });
    assert.deepEqual(splitScoreForPlayer("21-19", false), { player: "19", opponent: "21" });
  });
});

describe("recorded score detection and display", () => {
  it("does not treat placeholders as recorded scores", () => {
    assert.equal(hasRecordedScore(undefined), false);
    assert.equal(hasRecordedScore(""), false);
    assert.equal(hasRecordedScore("-"), false);
    assert.equal(hasRecordedScore("0"), false);
  });

  it("treats numeric score pairs as recorded scores", () => {
    assert.equal(hasRecordedScore("21-19"), true);
    assert.equal(hasRecordedScore(" 17 : 21 "), true);
  });

  it("returns dash score parts for unrecorded matches", () => {
    assert.deepEqual(matchScoreParts("-", true), { current: "-", opponent: "-" });
  });

  it("returns score parts in the current player's perspective", () => {
    assert.deepEqual(matchScoreParts("24-26", true), { current: "24", opponent: "26" });
    assert.deepEqual(matchScoreParts("24-26", false), { current: "26", opponent: "24" });
  });
});

describe("stake winner inference from score inputs", () => {
  it("detects current player win and loss", () => {
    assert.deepEqual(readScoreResultFromParts("21", "19"), {
      formattedScore: "21-19",
      playerWon: true,
    });
    assert.deepEqual(readScoreResultFromParts("17", "21"), {
      formattedScore: "17-21",
      playerWon: false,
    });
  });

  it("does not infer a winner from partial or tied score", () => {
    assert.equal(readScoreResultFromParts("21", ""), null);
    assert.equal(readScoreResultFromParts("20", "20"), null);
  });
});
