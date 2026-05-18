import { useEffect, useState } from "react";
import { request } from "../services/api.js";

/**
 * Modal that fetches GET {path} → { breakdown: { like: [{id,name,avatarUrl}], ... } }
 * and renders grouped names. `reactionTypes` is e.g. Community REACTIONS or CHAT_REACTIONS.
 */
export default function ReactionActorsModal({ title, path, reactionTypes, onClose }) {
  const [breakdown, setBreakdown] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("siglacast_token");
    setLoading(true);
    request(path, { token })
      .then((res) => {
        setBreakdown(res?.breakdown || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [path]);

  const blocks = (reactionTypes || []).filter((r) => (breakdown[r.type] || []).length);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-card modal-card-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body reaction-actors-body">
          {loading ? <p className="muted small">Loading…</p> : null}
          {!loading && !blocks.length ? <p className="muted small">No reactions yet.</p> : null}
          {!loading &&
            blocks.map((r) => (
              <div key={r.type} className="reaction-actors-block">
                <div className="reaction-actors-type">
                  <span>{r.emoji}</span> {r.label}
                </div>
                <ul className="reaction-actors-list">
                  {(breakdown[r.type] || []).map((u) => (
                    <li key={`${r.type}-${u.id}`}>{u.name}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
