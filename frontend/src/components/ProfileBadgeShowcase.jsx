import { mediaUrl } from "../services/api.js";

function badgeUrl(badge) {
  const raw = badge?.imageUrl || badge?.url || "";
  if (!raw) return "";
  if (String(raw).startsWith("/assets/")) return raw;
  return mediaUrl(raw);
}

export default function ProfileBadgeShowcase({ badges = [], compact = false }) {
  const visible = Array.isArray(badges) ? badges.filter(Boolean).slice(0, 8) : [];
  if (!visible.length) return null;

  return (
    <div className={`profile-badge-showcase${compact ? " compact" : ""}`} aria-label="Profile badge showcase">
      {visible.map((badge) => {
        const src = badgeUrl(badge);
        if (!src) return null;
        return (
          <span key={badge.id || src} className="profile-badge-chip" title={badge.name || "Profile badge"}>
            <img src={src} alt="" loading="lazy" decoding="async" />
          </span>
        );
      })}
    </div>
  );
}
