import { useEffect, useState } from "react";
import { mediaUrl } from "../services/api.js";
import { publicUrlLooksLikeGif } from "../utils/imageUrlKind.js";
import AvatarEditModal from "../components/AvatarEditModal.jsx";
import CoverEditModal from "../components/CoverEditModal.jsx";

const AVAILABILITY_IDS = ["online", "idle", "dnd", "invisible"];
const BIO_MAX_LEN = 500;

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

export default function ProfilePage({ user, onProfileSave, onAvatarUpload, onCoverUpload, setNotice, onLogout }) {
  const spotifyLinked = Boolean(user.spotifyLinked);
  const [musicShareNowPlaying, setMusicShareNowPlaying] = useState(() => Boolean(user.musicShareNowPlaying));
  const np = user.musicNowPlaying;

  useEffect(() => {
    setMusicShareNowPlaying(Boolean(user.musicShareNowPlaying));
  }, [user.musicShareNowPlaying]);

  async function persistMusicSharing(nextVal) {
    setMusicShareNowPlaying(Boolean(nextVal));
    await onProfileSave({ musicShareNowPlaying: Boolean(nextVal) });
  }

  const [name, setName] = useState(user.name);
  const [statusEmoji, setStatusEmoji] = useState(() => user.statusEmoji || "");
  const [statusNote, setStatusNote] = useState(() => user.statusNote || "");
  const [availability, setAvailability] = useState(() => normalizeAvailability(user.availability));
  const [bio, setBio] = useState(() => user.bio || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pendingCoverFile, setPendingCoverFile] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);

  useEffect(() => {
    setName(user.name);
    setBio(user.bio || "");
    setStatusEmoji(user.statusEmoji || "");
    setStatusNote(user.statusNote || "");
    setAvailability(normalizeAvailability(user.availability));
  }, [user.name, user.avatarUrl, user.coverUrl, user.bio, user.statusEmoji, user.statusNote, user.availability]);

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
    const prevBio = user.bio || "";
    const bioTrimmed = bio.trim();
    if (emojiTrimmed !== prevEmoji) payload.statusEmoji = emojiTrimmed;
    if (noteTrimmed !== prevNote) payload.statusNote = noteTrimmed;
    if (bioTrimmed !== prevBio) payload.bio = bioTrimmed;

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

  function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    setPendingAvatarFile(file);
  }

  async function applyEditedAvatar(croppedFile) {
    setAvatarUploading(true);
    try {
      await onAvatarUpload(croppedFile);
    } finally {
      setAvatarUploading(false);
    }
  }

  function closeCoverEditor() {
    if (!coverUploading) setPendingCoverFile(null);
  }

  function handleCoverPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    setPendingCoverFile(file);
  }

  async function applyEditedCover(croppedFile) {
    if (!onCoverUpload) return;
    setCoverUploading(true);
    try {
      await onCoverUpload(croppedFile);
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleRemoveCover() {
    if (!user.coverUrl) return;
    if (!window.confirm("Remove your profile cover image?")) return;
    await onProfileSave({ removeCover: true });
  }

  function closeAvatarEditor() {
    if (!avatarUploading) setPendingAvatarFile(null);
  }

  const avatarSrc = user.avatarUrl ? mediaUrl(user.avatarUrl) : null;
  const coverSrc = user.coverUrl ? mediaUrl(user.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>👤 Profile</h2>
        <p>Update your cover, profile photo, display name, bio, availability, custom status, and password.</p>
      </div>

      <div className="profile-hero">
        <div className="profile-cover-block">
          {coverSrc ? (
            coverIsGif ? (
              <div
                className="profile-cover-preview profile-cover-preview-has-image profile-cover-preview--gif-wrap"
                role="img"
                aria-label="Your animated profile cover preview"
              >
                <img src={coverSrc} alt="" className="profile-cover-preview-gif" />
              </div>
            ) : (
              <div
                className="profile-cover-preview profile-cover-preview-has-image"
                style={{ backgroundImage: `url(${coverSrc})` }}
                role="img"
                aria-label="Your profile cover preview"
              />
            )
          ) : (
            <div
              className="profile-cover-preview"
              role="img"
              aria-label="Default cover gradient"
            />
          )}
          <div className="profile-cover-actions">
            <label className="btn btn-secondary btn-sm">
              Change cover
              <input type="file" accept="image/*" className="sr-only" onChange={handleCoverPick} />
            </label>
            {user.coverUrl ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleRemoveCover()}>
                Remove cover
              </button>
            ) : null}
          </div>
          <p className="muted small profile-cover-hint">
            Wide banner behind your avatar. Still images use the crop/zoom editor; GIFs stay animated (whole file uploads as-is — max about 25 MB).
          </p>
        </div>

        <div className="profile-avatar-wrap">
          {avatarSrc ? (
            <img className="profile-avatar" src={avatarSrc} alt="" />
          ) : (
            <div className="profile-avatar placeholder" aria-hidden>{user.name?.charAt(0) || "?"}</div>
          )}
          <label className="btn btn-secondary profile-avatar-btn">
            Change photo
            <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarPick} />
          </label>
        </div>
        <p className="profile-email">{user.email}</p>
      </div>

      {pendingCoverFile ? (
        <CoverEditModal
          file={pendingCoverFile}
          uploading={coverUploading}
          onClose={closeCoverEditor}
          onApply={applyEditedCover}
        />
      ) : null}

      {pendingAvatarFile ? (
        <AvatarEditModal
          file={pendingAvatarFile}
          uploading={avatarUploading}
          onClose={closeAvatarEditor}
          onApply={applyEditedAvatar}
        />
      ) : null}

      <form className="composer profile-form" onSubmit={handleSave}>
        <label className="field-label">Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />

        <label className="field-label">About me</label>
        <p className="muted small profile-field-hint">
          Shown when someone opens your profile from Community or Messages ({BIO_MAX_LEN} characters max).
        </p>
        <textarea
          className="profile-bio-input"
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX_LEN))}
          placeholder="Tell others a bit about yourself…"
          maxLength={BIO_MAX_LEN}
          aria-label="Bio"
        />

        <label className="field-label">Spotify activity</label>
        <p className="muted small profile-field-hint">
          Link Spotify on the Music page first. Friends only see tracks while Spotify reports you as actively listening.
        </p>
        {!spotifyLinked ? (
          <p className="muted small profile-music-muted">
            Connect Spotify under <strong>Music</strong> to enable listening status on your bio.
          </p>
        ) : null}

        <label className={`profile-checkbox-row${!spotifyLinked ? " disabled" : ""}`}>
          <input
            type="checkbox"
            checked={musicShareNowPlaying}
            disabled={!spotifyLinked}
            onChange={(e) => void persistMusicSharing(e.target.checked)}
          />{" "}
          Show what I&apos;m listening to on my profile card
        </label>

        {spotifyLinked && np?.title ? (
          <div className="profile-music-snippet-muted muted small">
            Last Spotify sync{np.isPlaying ? " (currently playing)" : " (paused or idle)"}: <strong>{np.title}</strong>
            {np.artist ? <span>{` · ${np.artist}`}</span> : null}
          </div>
        ) : null}

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

      <div className="profile-logout-footer">
        <p className="muted small profile-logout-hint">Sign out on this device.</p>
        <button type="button" className="btn btn-ghost profile-logout-btn" onClick={() => onLogout?.()}>
          ➜] Log out
        </button>
      </div>
    </section>
  );
}
