import { useState } from "react";
import type { Session } from "../../types";
import { Copy } from "../icons";

type Store = ReturnType<typeof import("../../lib/store").useTrackerStore>;

export function SessionInviteCard({ session, store }: { session: Session; store: Store }) {
  const shareLink = `${window.location.origin}/${session.slug}/session/${session.id}`;
  const [isCopyTipVisible, setIsCopyTipVisible] = useState(false);
  const [isPinCopyTipVisible, setIsPinCopyTipVisible] = useState(false);

  async function copyShareText() {
    await navigator.clipboard.writeText(shareLink);
    setIsCopyTipVisible(true);
    window.setTimeout(() => setIsCopyTipVisible(false), 1800);
  }

  async function copyPinCode() {
    if (!session.pinCode) return;
    await navigator.clipboard.writeText(session.pinCode);
    setIsPinCopyTipVisible(true);
    window.setTimeout(() => setIsPinCopyTipVisible(false), 1800);
  }

  return (
    <div className="share-card">
      <div className="share-card-main">
        <p className="eyebrow">
          {session.status} session since {formatTime(session.createdAt)}
        </p>
        <div className="share-card-title">
          <h3>Invite Players</h3>
          {session.pinCode ? (
            <div className="pin-copy-wrap">
              {isPinCopyTipVisible ? <div className="copy-tooltip">Copied PIN</div> : null}
              <div className="pin-chip">PIN {session.pinCode}</div>
              <button type="button" className="pin-copy-button" onClick={copyPinCode} aria-label="Copy PIN code">
                <Copy size={15} />
              </button>
            </div>
          ) : null}
        </div>
        <p>{shareLink}</p>
        <div className="copy-action">
          {isCopyTipVisible ? <div className="copy-tooltip">Copied link</div> : null}
          <button className="secondary-button" onClick={copyShareText}>
            <Copy size={18} /> Copy link
          </button>
        </div>
      </div>
      <img
        className="share-qr"
        alt="Session QR code"
        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareLink)}`}
      />
      <div className="share-meta">
        <small className={store.isRemoteEnabled ? "database-status enabled" : "database-status"}>
          {store.isSaving ? "Saving changes..." : store.isRemoteEnabled ? "Database sync enabled." : "Local mode only."}
        </small>
        {store.syncError ? <small>Sync issue: {store.syncError}</small> : null}
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
