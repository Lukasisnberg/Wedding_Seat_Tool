"use client";

import type { AuthUser, ConnectionStatus, PresenceState } from "@/lib/types";
import { isMockMode } from "@/lib/getRepository";
import { setMockConnected } from "@/lib/mockRepository";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Verbunden",
  connecting: "Verbinde …",
  disconnected: "Verbindung getrennt — Bearbeitung gesperrt"
};

interface StatusBarProps {
  status: ConnectionStatus;
  others: PresenceState[];
  user: AuthUser;
  onSignOut: () => void;
}

export function StatusBar({ status, others, user, onSignOut }: StatusBarProps) {
  return (
    <div className={`status-bar status-bar--${status}`}>
      <span className="status-bar__dot" />
      <span>{STATUS_LABEL[status]}</span>

      {others.length > 0 && (
        <div className="status-bar__presence">
          {others.map((o) => (
            <span
              key={o.clientId}
              className="status-bar__presence-item"
              title={o.draggingGuestName ? `${o.userName} zieht „${o.draggingGuestName}"` : `${o.userName} ist online`}
            >
              <span className="status-bar__presence-dot" style={{ background: o.color }} />
              {o.draggingGuestName ? `${o.userName} zieht „${o.draggingGuestName}"` : o.userName}
            </span>
          ))}
        </div>
      )}

      <div className="status-bar__trailing">
        {isMockMode && (
          <label className="status-bar__mock-toggle">
            <input
              type="checkbox"
              defaultChecked
              onChange={(e) => setMockConnected(e.target.checked)}
            />
            verbunden (Test-Schalter)
          </label>
        )}

        <span className="status-bar__user">
          {user.displayName}
          <button type="button" className="status-bar__signout" onClick={onSignOut}>
            Abmelden
          </button>
        </span>
      </div>
    </div>
  );
}
