import { useState } from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import EmojiPickerButton from "../components/EmojiPickerButton.jsx";
import MentionInput from "../components/MentionInput.jsx";
import ReactionActorsModal from "../components/ReactionActorsModal.jsx";
import { PostCardBody, REACTIONS } from "./CommunityPage.jsx";
import { publicUrlLooksLikeGif } from "../utils/imageUrlKind.js";
import { listeningStatusLine } from "../utils/displayStatus.js";

function formatCount(n, singular, plural = `${singular}s`) {
  const value = Number(n) || 0;
  return `${value} ${value === 1 ? singular : plural}`;
}

function availabilityLabel(raw) {
  const v = String(raw || "online").toLowerCase();
  if (v === "dnd") return "Do Not Disturb";
  if (v === "idle") return "Idle";
  if (v === "invisible") return "Invisible";
  return "Online";
}

function dateLabel(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function ProfileComposer({ user, avatarSrc, onPost, onGeneratePost }) {
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() && !imageFile) return;
    await onPost?.({ content, imageFile });
    setContent("");
    clearImage();
  }

  return (
    <form className="my-profile-composer-card profile-inline-composer" onSubmit={submit}>
      <div className="my-profile-composer-line">
        {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{user.name?.charAt(0) || "?"}</span>}
        <MentionInput
          as="textarea"
          rows={2}
          value={content}
          onChange={setContent}
          placeholder="What's on your mind?"
        />
      </div>
      {previewUrl ? (
        <div className="image-preview-wrap">
          <img className="image-preview" src={previewUrl} alt="Preview" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearImage}>Remove image</button>
        </div>
      ) : null}
      <div className="composer-toolbar profile-composer-toolbar">
        <label className="btn btn-icon" title="Add image">
          <span className="ui-icon ui-icon-image" aria-hidden="true" />
          <input type="file" accept="image/*" hidden onChange={onFileChange} />
        </label>
        <EmojiPickerButton onPick={(emoji) => setContent((text) => text + emoji)} />
        {onGeneratePost ? (
          <button type="button" className="btn btn-secondary" onClick={() => onGeneratePost?.()}>
            Generate a post
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!content.trim() && !imageFile}>
          <span className="ui-icon ui-icon-send" aria-hidden="true" />
          <span>Publish</span>
        </button>
      </div>
    </form>
  );
}

export default function MyProfilePage({
  user,
  posts = [],
  characters = [],
  currentUser = user,
  liteMode = false,
  isOwnProfile = true,
  backHref = "",
  onPost,
  onGenerateCharacterPost,
  onToggleCharacter,
  onReact,
  onComment,
  onReactComment,
  onDeleteComment,
  onDeletePost,
  onShare,
  onOpenUserProfile,
  bonds = [],
  onTogglePinnedBond,
  shopItems = [],
  onEquipProfileFrame
}) {
  const [profileMode, setProfileMode] = useState("profile");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const selectedCharacter =
    isOwnProfile && profileMode === "characters"
      ? characters.find((c) => c.id === selectedCharacterId) || characters[0] || null
      : null;
  const displayUser = selectedCharacter || user;
  const avatarSrc = displayUser.avatarUrl ? mediaUrl(displayUser.avatarUrl) : null;
  const coverSrc = displayUser.coverUrl ? mediaUrl(displayUser.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);
  const myPosts = posts.filter((post) => post.authorId === displayUser.id);
  const statusLine = [displayUser.statusEmoji, displayUser.statusNote].filter(Boolean).join(" ");
  const musicLine = displayUser.isAiCharacter ? "" : listeningStatusLine(displayUser);
  const [rxModal, setRxModal] = useState({ open: false, path: "", title: "" });
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [bondPickerOpen, setBondPickerOpen] = useState(false);
  const [bondViewerOpen, setBondViewerOpen] = useState(false);
  const [bondSearch, setBondSearch] = useState("");
  const [selectedFrameId, setSelectedFrameId] = useState(displayUser.profileFrameItemId || "");
  const isCharacterProfile = Boolean(displayUser.isAiCharacter);
  const characterRoles = displayUser.roles || displayUser.aiRoles || "";
  const characterBackground = displayUser.background || displayUser.aiBackground || "";
  const canCompose = isOwnProfile;
  const frameFallback =
    currentUser?.email === "alexcarloman@dorsu.edu.ph"
      ? [{
          id: "pink-heart-bond-frame",
          name: "Pink Heart Bond Frame",
          type: "profile_frame",
          imageUrl: "/assets/bond-frame-pink.png",
          owned: true,
          unlocked: true,
          effectivePrice: 0,
          price: 20
        }]
      : [];
  const frameItems = (shopItems.length ? shopItems : frameFallback).filter((item) => item.type === "profile_frame");
  const ownedFrameItems = frameItems.filter((item) => item.owned || item.effectivePrice === 0);
  const activeFrame = frameItems.find((item) => item.id === displayUser.profileFrameItemId);
  const eligibleBonds = isOwnProfile ? bonds.filter((bond) => (bond.exp || 0) >= 200 && bond.target) : [];
  const pinnedBonds = eligibleBonds.filter((bond) => bond.pinned).slice(0, 3);
  const normalizedBondSearch = bondSearch.trim().toLowerCase();
  const filteredEligibleBonds = eligibleBonds.filter((bond) => {
    if (!normalizedBondSearch) return true;
    return String(bond.target?.name || "").toLowerCase().includes(normalizedBondSearch);
  });

  return (
    <section className="my-profile-page">
      {isOwnProfile ? (
        <div className="my-profile-owner-switch" role="tablist" aria-label="Profile view">
          <button
            type="button"
            className={profileMode === "profile" ? "active" : ""}
            onClick={() => setProfileMode("profile")}
          >
            Your profile
          </button>
          <button
            type="button"
            className={profileMode === "characters" ? "active" : ""}
            onClick={() => {
              setProfileMode("characters");
              if (!selectedCharacterId && characters[0]?.id) setSelectedCharacterId(characters[0].id);
            }}
          >
            Your characters
          </button>
        </div>
      ) : null}

      {isOwnProfile && profileMode === "characters" ? (
        <div className="my-profile-character-strip">
          {characters.length ? characters.map((character) => (
            <button
              type="button"
              key={character.id}
              className={(selectedCharacter?.id || characters[0]?.id) === character.id ? "active" : ""}
              onClick={() => setSelectedCharacterId(character.id)}
            >
              {character.avatarUrl ? <img src={mediaUrl(character.avatarUrl)} alt="" /> : <span>{character.name?.charAt(0) || "AI"}</span>}
              <strong>{character.name}</strong>
            </button>
          )) : (
            <Link to="/characters" className="my-profile-character-create">Create your first AI character</Link>
          )}
        </div>
      ) : null}

      <div className="my-profile-hero-card">
        <div className="my-profile-cover">
          {coverSrc && !liteMode ? (
            coverIsGif ? (
              <img src={coverSrc} alt="" className="my-profile-cover-gif" />
            ) : (
              <div className="my-profile-cover-img" style={{ backgroundImage: `url(${coverSrc})` }} />
            )
          ) : (
            <div className="my-profile-cover-fallback" />
          )}
          {isOwnProfile ? (
            <Link
              to={isCharacterProfile ? `/characters/${encodeURIComponent(displayUser.id)}/edit` : "/settings"}
              className="my-profile-cover-edit"
            >
              {isCharacterProfile ? "Manage character" : "Edit profile"}
            </Link>
          ) : null}
        </div>

        <div className="my-profile-identity">
          <div className="my-profile-avatar-wrap">
            {activeFrame?.imageUrl || displayUser.profileFrameUrl ? (
              <img className="my-profile-avatar-frame" src={activeFrame?.imageUrl || displayUser.profileFrameUrl} alt="" />
            ) : null}
            {avatarSrc ? (
              <img className="my-profile-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className="my-profile-avatar my-profile-avatar--empty">{displayUser.name?.charAt(0) || "?"}</span>
            )}
            {isOwnProfile ? (
              <button
                type="button"
                className="my-profile-frame-add"
                title="Choose profile frame"
                onClick={() => {
                  setSelectedFrameId(displayUser.profileFrameItemId || ownedFrameItems[0]?.id || "");
                  setFramePickerOpen(true);
                }}
              >
                +
              </button>
            ) : null}
          </div>
          <div className="my-profile-name-block">
            <h2>{displayUser.name}</h2>
            <p>{isCharacterProfile ? "AI Character" : "purxu profile"}</p>
            <div className="my-profile-pills">
              <span className={`my-profile-presence my-profile-presence--${displayUser.availability || "online"}`}>
                {isCharacterProfile ? "AI Character" : availabilityLabel(displayUser.availability)}
              </span>
              {statusLine ? <span>{statusLine}</span> : null}
              {isCharacterProfile && characterRoles ? <span>{characterRoles}</span> : null}
              {musicLine ? <span>{musicLine}</span> : null}
            </div>
          </div>
        </div>

        <nav className="my-profile-tabs" aria-label="Profile sections">
          <a href="#profile-posts" className="active">Posts</a>
          <a href="#profile-about">About</a>
          <a href="#profile-status">Status</a>
        </nav>

        {isOwnProfile ? (
          <div className="profile-bonds-mini">
            <div className="profile-bonds-mini-head">
              <strong>Bonds</strong>
              <button
                type="button"
                className="profile-bonds-add-btn"
                title="Add bond"
                onClick={(e) => {
                  e.stopPropagation();
                  setBondPickerOpen(true);
                }}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="profile-bonds-mini-list"
              onClick={() => setBondViewerOpen(true)}
              title="View bonds"
            >
              {pinnedBonds.length ? pinnedBonds.map((bond) => (
                <span
                  key={bond.targetUserId}
                  title={`${bond.target.name} · ${bond.levelLabel} Bond`}
                  className="profile-bond-mini-avatar"
                >
                  {bond.target.avatarUrl ? <img src={mediaUrl(bond.target.avatarUrl)} alt="" /> : <span>{bond.target.name?.charAt(0) || "?"}</span>}
                  <small>{bond.levelLabel}</small>
                </span>
              )) : (
                <span className="profile-bonds-empty-pill">Add bonds</span>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {bondViewerOpen ? (
        <BondLibraryModal
          title="Your bonds"
          bonds={eligibleBonds}
          onClose={() => setBondViewerOpen(false)}
          onTogglePinnedBond={onTogglePinnedBond}
          mode="viewer"
        />
      ) : null}

      {bondPickerOpen ? (
        <BondLibraryModal
          title="Add bond"
          bonds={filteredEligibleBonds}
          search={bondSearch}
          onSearch={setBondSearch}
          onClose={() => setBondPickerOpen(false)}
          onTogglePinnedBond={onTogglePinnedBond}
          mode="picker"
        />
      ) : null}

      {framePickerOpen ? (
        <div className="profile-frame-modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose profile frame">
          <div className="profile-frame-modal">
            <div className="profile-frame-modal-head">
              <div>
                <p>Avatar frames</p>
                <h3>Choose your profile frame</h3>
              </div>
              <button type="button" onClick={() => setFramePickerOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="profile-frame-modal-body">
              <div className="profile-frame-preview">
                {selectedFrameId ? (
                  <img
                    className="profile-frame-preview-frame"
                    src={frameItems.find((item) => item.id === selectedFrameId)?.imageUrl}
                    alt=""
                  />
                ) : null}
                {avatarSrc ? <img className="profile-frame-preview-avatar" src={avatarSrc} alt="" /> : <span>{displayUser.name?.charAt(0) || "?"}</span>}
              </div>
              <div className="profile-frame-list">
                <button
                  type="button"
                  className={!selectedFrameId ? "active" : ""}
                  onClick={() => setSelectedFrameId("")}
                >
                  <span className="profile-frame-none">None</span>
                  <strong>No frame</strong>
                </button>
                {ownedFrameItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={selectedFrameId === item.id ? "active" : ""}
                    onClick={() => setSelectedFrameId(item.id)}
                  >
                    <img src={item.imageUrl} alt="" />
                    <strong>{item.name}</strong>
                  </button>
                ))}
              </div>
            </div>
            <div className="profile-frame-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setFramePickerOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const ok = await onEquipProfileFrame?.(selectedFrameId);
                  if (ok !== false) setFramePickerOpen(false);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="my-profile-grid">
        <aside className="my-profile-about-card" id="profile-about">
          <h3>Intro</h3>
          {displayUser.bio ? <p className="my-profile-bio">{displayUser.bio}</p> : <p className="muted small">No bio yet.</p>}
          <div className="my-profile-info-list">
            <span>{isCharacterProfile ? "AI Character" : displayUser.role === "admin" ? "Administrator" : "Student"}</span>
            <span>{isCharacterProfile ? "Generated identity" : availabilityLabel(displayUser.availability)}</span>
            {statusLine ? <span id="profile-status">{statusLine}</span> : null}
            {musicLine ? <span>{musicLine}</span> : null}
          </div>
          {isCharacterProfile && characterBackground ? (
            <p className="my-profile-bio my-profile-character-lore">{characterBackground}</p>
          ) : null}
          {isCharacterProfile ? (
            <div className="my-profile-character-controls">
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(displayUser.autoPost)}
                  onChange={(e) => onToggleCharacter?.(displayUser.id, { autoPost: e.target.checked })}
                />
                <span>Generate posts</span>
              </label>
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(displayUser.autoReply)}
                  onChange={(e) => onToggleCharacter?.(displayUser.id, { autoReply: e.target.checked })}
                />
                <span>Auto replies</span>
              </label>
              <button
                type="button"
                className="my-profile-edit-wide"
                onClick={() => onGenerateCharacterPost?.(displayUser)}
              >
                Generate a post
              </button>
            </div>
          ) : isOwnProfile ? <Link to="/settings" className="my-profile-edit-wide">Edit details</Link> : null}
        </aside>

        <main className="my-profile-posts" id="profile-posts">
          {backHref ? (
            <Link to={backHref} className="my-profile-back-link">
              ← Back to Community
            </Link>
          ) : null}
          {canCompose ? (
            <ProfileComposer
              user={displayUser}
              avatarSrc={avatarSrc}
              onPost={(payload) =>
                onPost?.({
                  ...payload,
                  characterId: isCharacterProfile ? displayUser.id : undefined
                })
              }
              onGeneratePost={isCharacterProfile ? () => onGenerateCharacterPost?.(displayUser) : null}
            />
          ) : null}

          <div className="my-profile-section-head">
            <h3>Posts</h3>
            <span>{formatCount(myPosts.length, "post")}</span>
          </div>

          {myPosts.length ? (
            myPosts.map((post) => (
              <article key={post.id} id={`post-${post.id}`} className="tile post-card my-profile-post-card">
                <PostCardBody
                  post={post}
                  canModerateDelete={
                    (currentUser?.role === "admin" || post.authorId === currentUser?.id || (isCharacterProfile && isOwnProfile)) &&
                    !!onDeletePost
                  }
                  forceExpandedBody={false}
                  currentUser={currentUser}
                  onDeletePost={() => onDeletePost?.(post)}
                  onReact={onReact}
                  onComment={onComment}
                  onReactComment={onReactComment}
                  onDeleteComment={onDeleteComment}
                  onShare={onShare}
                  onOpenUserProfile={onOpenUserProfile}
                  characters={characters}
                  openPostReactors={() =>
                    setRxModal({
                      open: true,
                      title: "Post reactions",
                      path: `/community/posts/${post.id}/reactors`
                    })}
                  openCommentReactors={(commentId) =>
                    setRxModal({
                      open: true,
                      title: "Comment reactions",
                      path: `/community/comments/${commentId}/reactors`
                    })}
                  liteMode={liteMode}
                />
              </article>
            ))
          ) : (
            <div className="my-profile-empty-posts">
              <strong>No posts yet</strong>
              <p className="muted small">
                {isOwnProfile
                  ? isCharacterProfile
                    ? "Write a post above or generate one with AI."
                    : "Share something in Community and it will show up here."
                  : "This user has not posted yet."}
              </p>
              {canCompose && !isCharacterProfile ? (
                <Link to="/community" className="btn btn-secondary btn-sm my-profile-create-post-btn">
                  Create post
                </Link>
              ) : null}
            </div>
          )}
        </main>
      </div>
      {rxModal.open ? (
        <ReactionActorsModal
          title={rxModal.title}
          path={rxModal.path}
          reactionTypes={REACTIONS}
          onClose={() => setRxModal({ open: false, path: "", title: "" })}
        />
      ) : null}
    </section>
  );
}

function isCharacterBond(bond) {
  const target = bond?.target || {};
  return Boolean(target.isAiCharacter || target.email?.includes("@characters.") || target.id?.includes("ai_"));
}

function BondLibraryModal({ title, bonds, search = "", onSearch, onClose, onTogglePinnedBond, mode }) {
  const userBonds = bonds.filter((bond) => !isCharacterBond(bond));
  const characterBonds = bonds.filter(isCharacterBond);
  const showSearch = typeof onSearch === "function";

  function renderSection(sectionTitle, rows) {
    return (
      <section className="bond-library-section">
        <h4>{sectionTitle}</h4>
        {rows.length ? (
          <div className="bond-library-list">
            {rows.map((bond) => (
              <button
                key={bond.targetUserId}
                type="button"
                className="bond-library-row"
                onClick={() => onTogglePinnedBond?.(bond.targetUserId, !bond.pinned)}
              >
                <span className="bond-library-avatar">
                  {bond.target?.avatarUrl ? (
                    <img src={mediaUrl(bond.target.avatarUrl)} alt="" />
                  ) : (
                    <span>{bond.target?.name?.charAt(0) || "?"}</span>
                  )}
                </span>
                <span className="bond-library-copy">
                  <strong>{bond.target?.name || "Unknown"}</strong>
                  <small>{bond.levelLabel} Bond · {bond.exp || 0} EXP</small>
                </span>
                <span className={`bond-library-action${bond.pinned ? " active" : ""}`}>
                  {bond.pinned ? (mode === "picker" ? "Added" : "Pinned") : "Add"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small bond-library-empty">No available bonds here yet.</p>
        )}
      </section>
    );
  }

  return (
    <div className="profile-frame-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="profile-frame-modal bond-library-modal">
        <div className="profile-frame-modal-head">
          <div>
            <p>Bonds</p>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <div className="profile-frame-modal-body bond-library-body">
          {showSearch ? (
            <input
              className="bond-library-search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search bonds..."
              autoFocus
            />
          ) : null}
          {renderSection("Character bonds", characterBonds)}
          {renderSection("User bonds", userBonds)}
        </div>
        <div className="profile-frame-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
