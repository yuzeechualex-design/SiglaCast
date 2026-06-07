import { useState } from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../services/api.js";

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

function CharacterAvatar({ character }) {
  const src = character?.avatarUrl ? mediaUrl(character.avatarUrl) : null;
  if (src) return <img src={src} alt="" />;
  return <span>{character?.name?.charAt(0) || "AI"}</span>;
}

export default function AICharactersPage({
  characters = [],
  onCreateCharacter,
  onToggleCharacter,
  onGenerateCharacterPost
}) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

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
            <input type="file" accept="image/*" hidden onChange={(e) => patch("avatarFile", e.target.files?.[0] || null)} />
          </label>
          <span className="muted small">{form.avatarFile?.name || "No photo selected"}</span>
          <label className="btn btn-secondary">
            Banner
            <input type="file" accept="image/*" hidden onChange={(e) => patch("coverFile", e.target.files?.[0] || null)} />
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

      <div className="ai-character-list-head">
        <h3>Your Characters</h3>
        <span>{characters.length}</span>
      </div>
      <div className="ai-character-list">
        {characters.length ? characters.map((character) => (
          <article className="ai-character-row" key={character.id}>
            <Link to={`/users/${encodeURIComponent(character.id)}`} className="ai-character-row-main">
              <div className="ai-character-row-avatar"><CharacterAvatar character={character} /></div>
              <div>
                <h4>{character.name}</h4>
                <p className="muted small">AI Character{character.roles ? ` • ${character.roles}` : ""}</p>
              </div>
            </Link>
            <div className="ai-character-row-actions">
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(character.autoPost)}
                  onChange={(e) => onToggleCharacter?.(character.id, { autoPost: e.target.checked })}
                />
                <span>Posts</span>
              </label>
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(character.autoReply)}
                  onChange={(e) => onToggleCharacter?.(character.id, { autoReply: e.target.checked })}
                />
                <span>Replies</span>
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!character.autoPost}
                onClick={() => onGenerateCharacterPost?.(character)}
              >
                Generate character post
              </button>
            </div>
          </article>
        )) : (
          <div className="ai-character-empty">
            <strong>No AI characters yet</strong>
            <p className="muted small">Create one above and it will appear on your profile under Your characters.</p>
          </div>
        )}
      </div>
    </section>
  );
}
