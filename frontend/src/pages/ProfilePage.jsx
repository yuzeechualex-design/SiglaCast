import { useEffect, useState } from "react";
import { mediaUrl } from "../services/api.js";

const AVAILABILITY_IDS = ["online", "idle", "dnd", "invisible"];

function normalizeAvailability(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return AVAILABILITY_IDS.includes(v) ? v : "online";
}

const AVAILABILITY_CHOICES = [
  {
    id: "online",
    title: "Online",
    subtitle: "",
    bulletClass: "profile-avail-dot profile-avail-dot-online",
    subtitleClass: ""
  },
  {
    id: "idle",
    title: "Idle",
    subtitle: "",
    bulletClass: "profile-avail-dot profile-avail-dot-idle",
    subtitleClass: ""
  },
  {
    id: "dnd",
    title: "Do Not Disturb",
    subtitle: "You will not receive desktop notifications",
    bulletClass: "profile-avail-dot profile-avail-dot-dnd",
    subtitleClass: "muted small profile-avail-sub"
  },
  {
    id: "invisible",
    title: "Invisible",
    subtitle: "You will appear offline to others",
    bulletClass: "profile-avail-dot profile-avail-dot-invisible",
    subtitleClass: "muted small profile-avail-sub"
  }
];

export default function ProfilePage({ user, onProfileSave, onAvatarUpload, setNotice }) {
  const [name, setName] = useState(user.name);
  const [statusEmoji, setStatusEmoji] = useState(() => user.statusEmoji || "");
  const [statusNote, setStatusNote] = useState(() => user.statusNote || "");
  const [availability, setAvailability] = useState(() => normalizeAvailability(user.availability));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user.name);
    setStatusEmoji(user.statusEmoji || "");
    setStatusNote(user.statusNote || "");
    setAvailability(normalizeAvailability(user.availability));
  }, [user.name, user.avatarUrl, user.statusEmoji, user.statusNote, user.availability]);

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    const emojiTrimmed = statusEmoji.trim();
    const noteTrimmed = statusNote.trim();
    const payload = {};

    const nameChanged = trimmed !== user.name;
    if (nameChanged) {
      if (!trimmed) {
        setNotice("Display name cannot be empty.");
        return;
      }
      payload.name = trimmed;
    }

    const prevEmoji = user.statusEmoji || "";
    const prevNote = user.statusNote || "";
    if (emojiTrimmed !== prevEmoji) payload.statusEmoji = emojiTrimmed;
    if (noteTrimmed !== prevNote) payload.statusNote = noteTrimmed;

    if (normalizeAvailability(availability) !== normalizeAvailability(user.availability)) {
      payload.availability = normalizeAvailability(availability);
    }

    if (newPassword) {
      payload.newPassword = newPassword;
      payload.currentPassword = currentPassword;
    }

    if (Object.keys(payload).length === 0) {
      setNotice("No changes to save.");
      return;
    }
    if (newPassword && !currentPassword) {
      setNotice("Enter your current password to set a new one.");
      return;
    }

    setSaving(true);
    try {
      await onProfileSave(payload);
    } finally {
      setCurrentPassword("");
      setNewPassword("");
      setSaving(false);
    }
  }

  async function handleAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    await onAvatarUpload(file);
  }

  const avatarSrc = user.avatarUrl ? mediaUrl(user.avatarUrl) : null;

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>👤 Profile</h2>
        <p>Update your display name, availability, custom status, password, and profile picture.</p>
      </div>

      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          {avatarSrc ? (
            <img className="profile-avatar" src={avatarSrc} alt="" />
          ) : (
            <div className="profile-avatar placeholder" aria-hidden>{user.name?.charAt(0) || "?"}</div>
          )}
          <label className="btn btn-secondary profile-avatar-btn">
            Change photo
            <input type="file" accept="image/*" className="sr-only" onChange={handleAvatar} />
          </label>
        </div>
        <p className="profile-email">{user.email}</p>
      </div>

      <form className="composer profile-form" onSubmit={handleSave}>
        <label className="field-label">Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />

        <label className="field-label">Availability</label>
        <p className="muted small profile-field-hint">
          Controls how others see you in Messages (presence dot) and browser notifications — similar to Discord.
        </p>
        <fieldset className="profile-avail-fieldset" role="radiogroup" aria-label="Availability status">
          {AVAILABILITY_CHOICES.map((ch, i) => {
            const sel = normalizeAvailability(availability) === ch.id;
            const showDivider = i === 1;
            return (
              <div key={ch.id} className="profile-avail-wrap">
                {showDivider ? <div className="profile-avail-divider" aria-hidden /> : null}
                <label
                  className={`profile-avail-row ${sel ? "profile-avail-row-selected" : ""}`}
                  htmlFor={`avail-${ch.id}`}
                >
                  <input
                    type="radio"
                    id={`avail-${ch.id}`}
                    name="profile-availability"
                    value={ch.id}
                    checked={sel}
                    onChange={() => setAvailability(ch.id)}
                  />
                  <span className={ch.bulletClass} aria-hidden />
                  <span className="profile-avail-copy">
                    <span className="profile-avail-title">{ch.title}</span>
                    {ch.subtitle ? <span className={ch.subtitleClass}>{ch.subtitle}</span> : null}
                  </span>
                  {i >= 1 ? <span className="profile-avail-chevron muted" aria-hidden>›</span> : (
                    <span className="profile-avail-spacer" aria-hidden />
                  )}
                </label>
              </div>
            );
          })}
        </fieldset>

        <label className="field-label">Custom status</label>
        <p className="muted small profile-field-hint">
          Shown beside your name in Messages — one emoji badge and a short line of text (like Discord).
        </p>
        <div className="profile-status-fields">
          <input
            className="profile-status-emoji"
            value={statusEmoji}
            onChange={(e) => setStatusEmoji(e.target.value)}
            placeholder="😴"
            maxLength={48}
            aria-label="Status emoji"
            title="Status emoji — paste one or a composite emoji"
          />
          <input
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder="What are you up to?"
            maxLength={128}
            aria-label="Status message"
          />
        </div>

        <label className="field-label">Change password</label>
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password (if changing)" />
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (optional)" />

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "💾 Save changes"}</button>
      </form>
    </section>
  );
}
