import { useState } from "react";
import type { Session } from "../../types";
import { Copy } from "../icons";
import { ActionButton } from "../common/ActionButton";

type Store = ReturnType<typeof import("../../lib/store").useTrackerStore>;

export function SessionInviteCard({
  session,
  store,
  canEndSession = false,
  onEndSession,
}: {
  session: Session;
  store: Store;
  canEndSession?: boolean;
  onEndSession?: () => void;
}) {
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
        <div className="share-card-title">
          <h3>Invite Players</h3>
        </div>
        <p>{shareLink}</p>
        <div className="invite-action-grid">
          <div className="copy-action">
            {isCopyTipVisible ? <div className="copy-tooltip">Copied link</div> : null}
            <ActionButton variant="copy" className="invite-copy-button" onClick={copyShareText} iconEnd={<Copy size={18} />}>
              Copy link
            </ActionButton>
          </div>
          {session.pinCode ? (
            <div className="copy-action pin-copy-action">
              {isPinCopyTipVisible ? <div className="copy-tooltip">Copied PIN</div> : null}
              <ActionButton
                variant="pin"
                className="invite-pin-button pin-copy-card-button"
                onClick={copyPinCode}
                iconEnd={<Copy size={18} />}
              >
                PIN: {session.pinCode}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
      <img
        className="share-qr"
        alt="Session QR code"
        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareLink)}`}
      />
      <div className="invite-session-actions">
        <div className="share-meta">
          <span>
            {session.status} session since {formatTime(session.createdAt)}
          </span>
          <small className={store.isRemoteEnabled ? "database-status enabled" : "database-status"}>
            {store.isSaving ? "Saving changes..." : store.isRemoteEnabled ? "Database sync enabled." : "Local mode only."}
          </small>
          {store.syncError ? <small>Sync issue: {store.syncError}</small> : null}
        </div>
        {canEndSession ? (
          <ActionButton variant="danger-subtle" className="invite-end-button" onClick={onEndSession}>
            End session
          </ActionButton>
        ) : null}
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
