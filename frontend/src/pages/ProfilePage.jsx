import { useEffect, useState } from "react";
import { mediaUrl } from "../services/api.js";

export default function ProfilePage({ user, onProfileSave, onAvatarUpload, setNotice }) {
  const [name, setName] = useState(user.name);
  const [statusEmoji, setStatusEmoji] = useState(() => user.statusEmoji || "");
  const [statusNote, setStatusNote] = useState(() => user.statusNote || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user.name);
    setStatusEmoji(user.statusEmoji || "");
    setStatusNote(user.statusNote || "");
  }, [user.name, user.avatarUrl, user.statusEmoji, user.statusNote]);

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
        <p>Update your display name, custom status, password, and profile picture.</p>
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
