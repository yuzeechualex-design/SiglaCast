import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import { publicUrlLooksLikeGif } from "../utils/imageUrlKind.js";
import AvatarEditModal from "../components/AvatarEditModal.jsx";
import CoverEditModal from "../components/CoverEditModal.jsx";

const BIO_MAX_LEN = 500;

export default function CharacterEditPage({
  characters = [],
  onSave,
  onAvatarUpload,
  onCoverUpload,
  setNotice
}) {
  const { characterId } = useParams();
  const character = characters.find((c) => c.id === characterId);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [roles, setRoles] = useState("");
  const [personality, setPersonality] = useState("");
  const [background, setBackground] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pendingCoverFile, setPendingCoverFile] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);

  useEffect(() => {
    if (!character) return;
    setName(character.name || "");
    setBio(character.bio || "");
    setRoles(character.roles || character.aiRoles || "");
    setPersonality(character.personality || character.aiPersonality || "");
    setBackground(character.background || character.aiBackground || "");
  }, [character]);

  if (!character) return <Navigate to="/characters" replace />;

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNotice?.("Character name cannot be empty.");
      return;
    }
    const payload = {};
    if (trimmedName !== character.name) payload.name = trimmedName;
    const bioTrimmed = bio.trim();
    if (bioTrimmed !== (character.bio || "")) payload.bio = bioTrimmed;
    const rolesTrimmed = roles.trim();
    if (rolesTrimmed !== (character.roles || character.aiRoles || "")) payload.roles = rolesTrimmed;
    const personalityTrimmed = personality.trim();
    if (personalityTrimmed !== (character.personality || character.aiPersonality || "")) {
      payload.personality = personalityTrimmed;
    }
    const backgroundTrimmed = background.trim();
    if (backgroundTrimmed !== (character.background || character.aiBackground || "")) {
      payload.background = backgroundTrimmed;
    }
    if (!Object.keys(payload).length) {
      setNotice?.("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      await onSave?.(character.id, payload);
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice?.("Please choose an image file.");
      return;
    }
    setPendingAvatarFile(file);
  }

  async function applyEditedAvatar(croppedFile) {
    setAvatarUploading(true);
    try {
      await onAvatarUpload?.(character.id, croppedFile);
    } finally {
      setAvatarUploading(false);
    }
  }

  function handleCoverPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice?.("Please choose an image file.");
      return;
    }
    setPendingCoverFile(file);
  }

  async function applyEditedCover(croppedFile) {
    setCoverUploading(true);
    try {
      await onCoverUpload?.(character.id, croppedFile);
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleRemoveCover() {
    if (!character.coverUrl) return;
    if (!window.confirm("Remove this character's banner?")) return;
    await onSave?.(character.id, { removeCover: true });
  }

  const avatarSrc = character.avatarUrl ? mediaUrl(character.avatarUrl) : null;
  const coverSrc = character.coverUrl ? mediaUrl(character.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);

  return (
    <section className="panel single character-edit-page">
      <div className="panel-head">
        <h2>Edit {character.name}</h2>
        <p>Customize your AI character&apos;s banner, photo, bio, and personality.</p>
        <Link to="/profile" className="btn btn-ghost btn-sm character-edit-back">
          ← Back to profile
        </Link>
      </div>

      <div className="profile-hero">
        <div className="profile-cover-block">
          {coverSrc ? (
            coverIsGif ? (
              <div className="profile-cover-preview profile-cover-preview-has-image profile-cover-preview--gif-wrap">
                <img src={coverSrc} alt="" className="profile-cover-preview-gif" />
              </div>
            ) : (
              <div
                className="profile-cover-preview profile-cover-preview-has-image"
                style={{ backgroundImage: `url(${coverSrc})` }}
              />
            )
          ) : (
            <div className="profile-cover-preview" />
          )}
          <div className="profile-cover-actions">
            <label className="btn btn-secondary btn-sm">
              Change banner
              <input type="file" accept="image/*" className="sr-only" onChange={handleCoverPick} />
            </label>
            {character.coverUrl ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleRemoveCover()}>
                Remove banner
              </button>
            ) : null}
          </div>
        </div>

        <div className="profile-avatar-wrap">
          {avatarSrc ? (
            <img className="profile-avatar" src={avatarSrc} alt="" />
          ) : (
            <div className="profile-avatar placeholder">{character.name?.charAt(0) || "AI"}</div>
          )}
          <label className="btn btn-secondary profile-avatar-btn">
            Change photo
            <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarPick} />
          </label>
        </div>
      </div>

      {pendingCoverFile ? (
        <CoverEditModal
          file={pendingCoverFile}
          uploading={coverUploading}
          onClose={() => !coverUploading && setPendingCoverFile(null)}
          onApply={applyEditedCover}
        />
      ) : null}

      {pendingAvatarFile ? (
        <AvatarEditModal
          file={pendingAvatarFile}
          uploading={avatarUploading}
          onClose={() => !avatarUploading && setPendingAvatarFile(null)}
          onApply={applyEditedAvatar}
        />
      ) : null}

      <form className="composer profile-form character-edit-form" onSubmit={handleSave}>
        <label className="field-label">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" maxLength={80} />

        <label className="field-label">Bio</label>
        <p className="muted small profile-field-hint">Shown on the character profile intro ({BIO_MAX_LEN} characters max).</p>
        <textarea
          className="profile-bio-input"
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX_LEN))}
          placeholder="Short profile bio"
          maxLength={BIO_MAX_LEN}
        />

        <label className="field-label">Roles</label>
        <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Mentor, singer, campus DJ..." maxLength={240} />

        <label className="field-label">Personality</label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={3}
          placeholder="How this character talks and behaves"
          maxLength={500}
        />

        <label className="field-label">Background</label>
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          rows={4}
          placeholder="Backstory, interests, lore"
          maxLength={1000}
        />

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save character"}
        </button>
      </form>
    </section>
  );
}
