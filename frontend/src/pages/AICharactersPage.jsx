import { useState } from "react";
import AvatarEditModal from "../components/AvatarEditModal.jsx";
import CoverEditModal from "../components/CoverEditModal.jsx";

const initialForm = {
  name: "",
  bio: "",
  roles: "",
  personality: "",
  background: "",
  autoPost: false,
  autoReply: false,
  avatarFile: null,
  coverFile: null
};

export default function AICharactersPage({
  onCreateCharacter
}) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [pendingCoverFile, setPendingCoverFile] = useState(null);

  function patch(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreateCharacter?.(form);
      setForm(initialForm);
    } finally {
      setSubmitting(false);
    }
  }

  function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingAvatarFile(file);
  }

  function handleCoverPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingCoverFile(file);
  }

  function applyEditedAvatar(croppedFile) {
    patch("avatarFile", croppedFile);
    setPendingAvatarFile(null);
  }

  function applyEditedCover(croppedFile) {
    patch("coverFile", croppedFile);
    setPendingCoverFile(null);
  }

  return (
    <section className="panel single ai-character-page">
      <div className="panel-head">
        <h2>AI Characters</h2>
        <p>Create character profiles that can publish and reply with their own identity.</p>
      </div>

      <form className="composer ai-character-form" onSubmit={submit}>
        <div className="ai-character-form-grid">
          <label>
            <span className="field-label">Name</span>
            <input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="Character name" maxLength={80} />
          </label>
          <label>
            <span className="field-label">Roles</span>
            <input value={form.roles} onChange={(e) => patch("roles", e.target.value)} placeholder="Mentor, villain, campus DJ..." maxLength={240} />
          </label>
        </div>

        <label className="field-label">Bio</label>
        <textarea value={form.bio} onChange={(e) => patch("bio", e.target.value)} rows={3} placeholder="Short profile bio" maxLength={500} />

        <label className="field-label">Personality</label>
        <textarea value={form.personality} onChange={(e) => patch("personality", e.target.value)} rows={3} placeholder="How this character talks, reacts, and behaves" maxLength={500} />

        <label className="field-label">Background</label>
        <textarea value={form.background} onChange={(e) => patch("background", e.target.value)} rows={4} placeholder="Backstory, interests, lore, memories, goals" maxLength={1000} />

        <div className="ai-character-upload-row">
          <label className="btn btn-secondary">
            Profile photo
            <input type="file" accept="image/*" hidden onChange={handleAvatarPick} />
          </label>
          <span className="muted small">{form.avatarFile?.name || "No photo selected"}</span>
          <label className="btn btn-secondary">
            Banner
            <input type="file" accept="image/*" hidden onChange={handleCoverPick} />
          </label>
          <span className="muted small">{form.coverFile?.name || "No banner selected"}</span>
        </div>

        <label className="ai-character-switch">
          <input type="checkbox" checked={form.autoPost} onChange={(e) => patch("autoPost", e.target.checked)} />
          <span>
            <strong>Generate character posts</strong>
            <small>Allows this character to publish personality-based posts.</small>
          </span>
        </label>
        <label className="ai-character-switch">
          <input type="checkbox" checked={form.autoReply} onChange={(e) => patch("autoReply", e.target.checked)} />
          <span>
            <strong>Automatic comments and replies</strong>
            <small>Lets this character reply when users comment on its posts.</small>
          </span>
        </label>

        <button type="submit" className="btn btn-primary" disabled={submitting || !form.name.trim()}>
          <span className="ui-icon ui-icon-user-plus" aria-hidden="true" />
          <span>{submitting ? "Creating..." : "Create AI Character"}</span>
        </button>
      </form>

      {pendingCoverFile ? (
        <CoverEditModal
          file={pendingCoverFile}
          onClose={() => setPendingCoverFile(null)}
          onApply={applyEditedCover}
        />
      ) : null}

      {pendingAvatarFile ? (
        <AvatarEditModal
          file={pendingAvatarFile}
          onClose={() => setPendingAvatarFile(null)}
          onApply={applyEditedAvatar}
        />
      ) : null}
    </section>
  );
}
