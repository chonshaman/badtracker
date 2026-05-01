import { useEffect, useState } from "react";
import { formatVnd } from "../../lib/money";
import { casualUnitPrice, courtSharePerPlayer, maxMatches, shuttleFeePerMatch } from "../../lib/sessionMath";
import type { Match, Session, TrackerState } from "../../types";

type Store = ReturnType<typeof import("../../lib/store").useTrackerStore>;

export function BillingStats({
  session,
  state,
  store,
  isHost,
  sessionMatches,
  totalDue,
  collected,
}: {
  session: Session;
  state: TrackerState;
  store: Store;
  isHost: boolean;
  sessionMatches: Match[];
  totalDue: number;
  collected: number;
}) {
  const [isCourtPriceEditing, setIsCourtPriceEditing] = useState(false);
  const [courtPriceDraft, setCourtPriceDraft] = useState(() => formatVnd(session.courtPrice));
  const [isMatchDurationEditing, setIsMatchDurationEditing] = useState(false);
  const [matchDurationDraft, setMatchDurationDraft] = useState(() => String(session.matchDuration));
  const [isTotalCourtTimeEditing, setIsTotalCourtTimeEditing] = useState(false);
  const [totalCourtTimeDraft, setTotalCourtTimeDraft] = useState(() => String(session.totalCourtTime));
  const [isTotalMatchesEditing, setIsTotalMatchesEditing] = useState(false);
  const [totalMatchesDraft, setTotalMatchesDraft] = useState(() => formatStatNumber(maxMatches(session)));

  const courtShare = courtSharePerPlayer(session, state.roster);
  const fixedPricePerMatch = casualUnitPrice(session, state.matches);
  const shuttleFee = shuttleFeePerMatch(session);
  const sessionCost = session.courtPrice + (sessionMatches.length * session.shuttlePrice) / session.shuttlesPerTube;

  useEffect(() => {
    if (!isCourtPriceEditing) setCourtPriceDraft(formatVnd(session.courtPrice));
  }, [isCourtPriceEditing, session.courtPrice]);

  useEffect(() => {
    if (!isMatchDurationEditing) setMatchDurationDraft(String(session.matchDuration));
  }, [isMatchDurationEditing, session.matchDuration]);

  useEffect(() => {
    if (!isTotalCourtTimeEditing) setTotalCourtTimeDraft(String(session.totalCourtTime));
  }, [isTotalCourtTimeEditing, session.totalCourtTime]);

  useEffect(() => {
    if (!isTotalMatchesEditing) setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
  }, [isTotalMatchesEditing, session]);

  function submitCourtPrice() {
    const nextCourtPrice = parseCourtMoneyInput(courtPriceDraft);
    if (nextCourtPrice <= 0) {
      setCourtPriceDraft(formatVnd(session.courtPrice));
      setIsCourtPriceEditing(false);
      return;
    }
    store.updateCourtPrice(session.id, nextCourtPrice);
    setCourtPriceDraft(formatVnd(nextCourtPrice));
    setIsCourtPriceEditing(false);
  }

  function submitMatchDuration() {
    const nextMatchDuration = Number(matchDurationDraft);
    if (!Number.isFinite(nextMatchDuration) || nextMatchDuration <= 0) {
      setMatchDurationDraft(String(session.matchDuration));
      setIsMatchDurationEditing(false);
      return;
    }
    store.updateMatchDuration(session.id, nextMatchDuration);
    setMatchDurationDraft(String(nextMatchDuration));
    setIsMatchDurationEditing(false);
  }

  function submitTotalCourtTime() {
    const nextTotalCourtTime = Number(totalCourtTimeDraft);
    if (!Number.isFinite(nextTotalCourtTime) || nextTotalCourtTime <= 0) {
      setTotalCourtTimeDraft(String(session.totalCourtTime));
      setIsTotalCourtTimeEditing(false);
      return;
    }
    store.updateTotalCourtTime(session.id, nextTotalCourtTime);
    setTotalCourtTimeDraft(String(nextTotalCourtTime));
    setIsTotalCourtTimeEditing(false);
  }

  function submitTotalMatches() {
    const nextTotalMatches = Number(totalMatchesDraft);
    if (!Number.isFinite(nextTotalMatches) || nextTotalMatches <= 0) {
      setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
      setIsTotalMatchesEditing(false);
      return;
    }
    const nextMatchDuration = Number((session.totalCourtTime / nextTotalMatches).toFixed(2));
    store.updateMatchDuration(session.id, nextMatchDuration);
    setTotalMatchesDraft(formatStatNumber(nextTotalMatches));
    setIsTotalMatchesEditing(false);
  }

  return (
    <div className="metric-grid report-stats-grid">
      <CourtPriceMetric
        isHost={isHost}
        value={session.courtPrice}
        captionLabel={session.billingMethod === "casual" ? "Fixed price/match" : "Court share/person"}
        captionValue={session.billingMethod === "casual" ? fixedPricePerMatch : courtShare}
        draft={courtPriceDraft}
        isEditing={isCourtPriceEditing}
        onDraftChange={setCourtPriceDraft}
        onEdit={() => setIsCourtPriceEditing(true)}
        onCancel={() => {
          setCourtPriceDraft(formatVnd(session.courtPrice));
          setIsCourtPriceEditing(false);
        }}
        onSubmit={submitCourtPrice}
      />
      <EditableNumberMetric
        isHost={isHost}
        label="Total matches"
        value={maxMatches(session)}
        draft={totalMatchesDraft}
        isEditing={isTotalMatchesEditing}
        onDraftChange={setTotalMatchesDraft}
        onEdit={() => setIsTotalMatchesEditing(true)}
        onCancel={() => {
          setTotalMatchesDraft(formatStatNumber(maxMatches(session)));
          setIsTotalMatchesEditing(false);
        }}
        onSubmit={submitTotalMatches}
      />
      <Metric label="Shuttle Cost / Match" value={formatVnd(shuttleFee)} />
      <MatchDurationMetric
        isHost={isHost}
        value={session.matchDuration}
        draft={matchDurationDraft}
        isEditing={isMatchDurationEditing}
        onDraftChange={setMatchDurationDraft}
        onEdit={() => setIsMatchDurationEditing(true)}
        onCancel={() => {
          setMatchDurationDraft(String(session.matchDuration));
          setIsMatchDurationEditing(false);
        }}
        onSubmit={submitMatchDuration}
      />
      <EditableMinuteMetric
        isHost={isHost}
        label="Total court time"
        value={session.totalCourtTime}
        draft={totalCourtTimeDraft}
        isEditing={isTotalCourtTimeEditing}
        onDraftChange={setTotalCourtTimeDraft}
        onEdit={() => setIsTotalCourtTimeEditing(true)}
        onCancel={() => {
          setTotalCourtTimeDraft(String(session.totalCourtTime));
          setIsTotalCourtTimeEditing(false);
        }}
        onSubmit={submitTotalCourtTime}
      />
      <Metric label="Matches logged" value={`${sessionMatches.length}/${formatStatNumber(maxMatches(session))}`} />
      <Metric label="Collected" value={formatVnd(collected)} />
      <Metric label="Profit / loss" value={formatVnd(totalDue - sessionCost)} />
    </div>
  );
}

function CourtPriceMetric({
  isHost,
  value,
  captionLabel,
  captionValue,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  value: number;
  captionLabel: string;
  captionValue: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      <span>Total court money</span>
      {isEditing ? (
        <form
          className="metric-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input value={draft} onChange={(event) => onDraftChange(event.target.value)} autoFocus />
          <div className="metric-edit-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <strong>{formatVnd(value)}</strong>
          <small>
            {captionLabel} {formatVnd(captionValue)}
          </small>
          {isHost ? (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function EditableNumberMetric({
  isHost,
  label,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  label: string;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      <span>{label}</span>
      {isEditing ? (
        <form
          className="metric-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input value={draft} onChange={(event) => onDraftChange(event.target.value)} autoFocus />
          <div className="metric-edit-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <strong>{formatStatNumber(value)}</strong>
          {isHost ? (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function MatchDurationMetric({
  isHost,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <EditableMinuteMetric
      isHost={isHost}
      label="Match duration"
      value={value}
      draft={draft}
      isEditing={isEditing}
      onDraftChange={onDraftChange}
      onEdit={onEdit}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

function EditableMinuteMetric({
  isHost,
  label,
  value,
  draft,
  isEditing,
  onDraftChange,
  onEdit,
  onCancel,
  onSubmit,
}: {
  isHost: boolean;
  label: string;
  value: number;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      <span>{label}</span>
      {isEditing ? (
        <form
          className="metric-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input value={draft} onChange={(event) => onDraftChange(event.target.value)} autoFocus />
          <div className="metric-edit-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <strong>{value} min</strong>
          <small>{formatMinutesWithHours(value)}</small>
          {isHost ? (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatStatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMinutesWithHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${minutes} min - ${hours} hours` : `${minutes} min - ${hours.toFixed(1)} hours`;
}

function parseCourtMoneyInput(value: string): number {
  const trimmed = value.trim();
  const expression = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(\d[\d.,]*)$/);
  if (expression) {
    const hours = Number(expression[1].replace(",", "."));
    const pricePerHour = Number(expression[2].replace(/[.,]/g, ""));
    return Number.isFinite(hours) && Number.isFinite(pricePerHour) ? Math.round(hours * pricePerHour) : 0;
  }
  const numeric = Number(trimmed.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}
