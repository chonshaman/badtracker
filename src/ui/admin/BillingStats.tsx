import { useEffect, useState, type ReactNode } from "react";
import { formatVnd } from "../../lib/money";
import { casualUnitPrice, courtSharePerPlayer, maxMatches, shuttleFeePerMatch } from "../../lib/sessionMath";
import { getPlayerFeeMetric } from "../../lib/selectors";
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
  settings,
}: {
  session: Session;
  state: TrackerState;
  store: Store;
  isHost: boolean;
  sessionMatches: Match[];
  totalDue: number;
  collected: number;
  settings?: ReactNode;
}) {
  const [isCourtPriceEditing, setIsCourtPriceEditing] = useState(false);
  const [courtPriceDraft, setCourtPriceDraft] = useState(() => formatVnd(session.courtPrice));
  const [isShuttleSettingsEditing, setIsShuttleSettingsEditing] = useState(false);
  const [shuttlePriceDraft, setShuttlePriceDraft] = useState(() => formatVnd(session.shuttlePrice));
  const [shuttlesPerTubeDraft, setShuttlesPerTubeDraft] = useState(() => String(session.shuttlesPerTube));
  const [isMatchDurationEditing, setIsMatchDurationEditing] = useState(false);
  const [matchDurationDraft, setMatchDurationDraft] = useState(() => String(session.matchDuration));
  const [isTotalCourtTimeEditing, setIsTotalCourtTimeEditing] = useState(false);
  const [totalCourtTimeDraft, setTotalCourtTimeDraft] = useState(() => String(session.totalCourtTime));

  const courtShare = courtSharePerPlayer(session, state.roster);
  const fixedPricePerMatch = getPlayerFeeMetric(state, session, state.roster);
  const shuttleFee = shuttleFeePerMatch(session);
  const sessionCost = session.courtPrice + (sessionMatches.length * session.shuttlePrice) / session.shuttlesPerTube;
  const totalMatchCount = maxMatches(session);

  useEffect(() => {
    if (!isCourtPriceEditing) setCourtPriceDraft(formatVnd(session.courtPrice));
  }, [isCourtPriceEditing, session.courtPrice]);

  useEffect(() => {
    if (!isShuttleSettingsEditing) {
      setShuttlePriceDraft(formatVnd(session.shuttlePrice));
      setShuttlesPerTubeDraft(String(session.shuttlesPerTube));
    }
  }, [isShuttleSettingsEditing, session.shuttlePrice, session.shuttlesPerTube]);

  useEffect(() => {
    if (!isMatchDurationEditing) setMatchDurationDraft(String(session.matchDuration));
  }, [isMatchDurationEditing, session.matchDuration]);

  useEffect(() => {
    if (!isTotalCourtTimeEditing) setTotalCourtTimeDraft(String(session.totalCourtTime));
  }, [isTotalCourtTimeEditing, session.totalCourtTime]);

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

  function submitShuttleSettings() {
    const nextShuttlePrice = parseCourtMoneyInput(shuttlePriceDraft);
    const nextShuttlesPerTube = Number(shuttlesPerTubeDraft);
    if (nextShuttlePrice <= 0 || !Number.isFinite(nextShuttlesPerTube) || nextShuttlesPerTube <= 0) {
      setShuttlePriceDraft(formatVnd(session.shuttlePrice));
      setShuttlesPerTubeDraft(String(session.shuttlesPerTube));
      setIsShuttleSettingsEditing(false);
      return;
    }
    store.updateShuttleSettings(session.id, nextShuttlePrice, nextShuttlesPerTube);
    setShuttlePriceDraft(formatVnd(nextShuttlePrice));
    setShuttlesPerTubeDraft(String(nextShuttlesPerTube));
    setIsShuttleSettingsEditing(false);
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

  return (
    <>
      <div className="billing-config-row">
        <div className="billing-settings-column">
          {settings}
          <div className="billing-live-strip billing-live-cell">
            <LiveMetric label="Matches" value={`${sessionMatches.length}/${formatStatNumber(totalMatchCount)}`} caption="logged" />
            <LiveMetric label="Collected" value={formatVnd(collected)} caption="paid" />
            <LiveMetric label="Profit / loss" value={formatVnd(collected - sessionCost)} caption="balance" />
          </div>
        </div>
        <div className="billing-setup-column">
          <div className="billing-setup-grid">
            <div className="billing-setup-slot billing-setup-slot-court">
              <CourtPriceMetric
                isHost={isHost}
                value={session.courtPrice}
                captionLabel={session.billingMethod === "casual" ? "Fee/match:" : "Court share/person"}
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
            </div>
            <div className="billing-setup-slot billing-setup-slot-shuttle">
              <Metric
                isHost={isHost}
                label="Shuttle Cost / Match"
                value={formatVnd(shuttleFee)}
                caption={`~Shuttle fee ${formatVnd(shuttleFee / 2)}/player`}
                onEdit={() => setIsShuttleSettingsEditing(true)}
              />
            </div>
            <div className="billing-setup-slot billing-setup-slot-court-time">
              <EditableNumberMetric
                isHost={isHost}
                label="Total court time"
                value={session.totalCourtTime}
                displayValue={formatMinutesApproxHours(session.totalCourtTime)}
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
            </div>
            <div className="billing-setup-slot billing-setup-slot-total-matches">
              <Metric label="Max matches est." value={formatStatNumber(totalMatchCount)} />
            </div>
            <div className="billing-setup-slot billing-setup-slot-match-duration">
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
            </div>
          </div>
        </div>
      </div>
      {isShuttleSettingsEditing ? (
        <ShuttleSettingsModal
          shuttlePriceDraft={shuttlePriceDraft}
          shuttlesPerTubeDraft={shuttlesPerTubeDraft}
          onShuttlePriceDraftChange={setShuttlePriceDraft}
          onShuttlesPerTubeDraftChange={setShuttlesPerTubeDraft}
          onClose={() => {
            setShuttlePriceDraft(formatVnd(session.shuttlePrice));
            setShuttlesPerTubeDraft(String(session.shuttlesPerTube));
            setIsShuttleSettingsEditing(false);
          }}
          onSubmit={submitShuttleSettings}
        />
      ) : null}
    </>
  );
}

function LiveMetric({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="billing-live-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
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
      {isEditing ? (
        <>
          <span>Total court money</span>
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
        </>
      ) : (
        <>
          <div className="metric-card-content">
            <span>Total court money</span>
            <strong>{formatVnd(value)}</strong>
            <small>
              {captionLabel} {formatVnd(captionValue)}
            </small>
          </div>
          {isHost ? (
            <button type="button" className="metric-edit-trigger" onClick={onEdit}>
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
  displayValue,
  caption,
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
  displayValue?: string;
  caption?: string;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      {isEditing ? (
        <>
          <span>{label}</span>
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
        </>
      ) : (
        <>
          <div className="metric-card-content">
            <span>{label}</span>
            <strong>{displayValue ?? formatStatNumber(value)}</strong>
            {caption ? <small>{caption}</small> : null}
          </div>
          {isHost ? (
            <button type="button" className="metric-edit-trigger" onClick={onEdit}>
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
  caption,
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
  caption?: string;
  draft: string;
  isEditing: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      {isEditing ? (
        <>
          <span>{label}</span>
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
        </>
      ) : (
        <>
          <div className="metric-card-content">
            <span>{label}</span>
            <strong>{value} min</strong>
            <small>{caption ?? formatMinutesWithHours(value)}</small>
          </div>
          {isHost ? (
            <button type="button" className="metric-edit-trigger" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({
  isHost = false,
  label,
  value,
  caption,
  onEdit,
}: {
  isHost?: boolean;
  label: string;
  value: string;
  caption?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="metric-card editable-metric-card">
      <div className="metric-card-content">
        <span>{label}</span>
        <strong>{value}</strong>
        {caption ? <small>{caption}</small> : null}
      </div>
      {isHost && onEdit ? (
        <button type="button" className="metric-edit-trigger" onClick={onEdit}>
          Edit
        </button>
      ) : null}
    </div>
  );
}

function ShuttleSettingsModal({
  shuttlePriceDraft,
  shuttlesPerTubeDraft,
  onShuttlePriceDraftChange,
  onShuttlesPerTubeDraftChange,
  onClose,
  onSubmit,
}: {
  shuttlePriceDraft: string;
  shuttlesPerTubeDraft: string;
  onShuttlePriceDraftChange: (value: string) => void;
  onShuttlesPerTubeDraftChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit shuttle settings">
      <section className="match-modal shuttle-settings-modal panel">
        <p className="eyebrow">Billing setup</p>
        <h2>Shuttle settings</h2>
        <p className="shuttle-settings-copy">Change shuttle tube price and the number of shuttles in each tube.</p>
        <form
          className="form-grid shuttle-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="full-span">
            <span>Shuttle tube price</span>
            <input value={shuttlePriceDraft} onChange={(event) => onShuttlePriceDraftChange(event.target.value)} autoFocus />
          </label>
          <label className="full-span">
            <span>Shuttles per tube</span>
            <input
              value={shuttlesPerTubeDraft}
              onChange={(event) => onShuttlesPerTubeDraftChange(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <div className="modal-action-row full-span">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save
            </button>
          </div>
        </form>
      </section>
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

function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 hours";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${hours.toFixed(1)} hours`;
}

function formatMinutesApproxHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 mins";
  return `${formatStatNumber(minutes)} mins ~ ${formatHours(minutes)}`;
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
