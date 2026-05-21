import { Link } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
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

function ProfilePostPreview({ post, liteMode = false }) {
  return (
    <article className="my-profile-post-card">
      <div className="my-profile-post-head">
        {post.authorAvatar ? (
          <img className="my-profile-post-avatar" src={mediaUrl(post.authorAvatar)} alt="" />
        ) : (
          <span className="my-profile-post-avatar my-profile-post-avatar--empty">{post.author?.charAt(0) || "?"}</span>
        )}
        <div>
          <strong>{post.author}</strong>
          <span>{dateLabel(post.createdAt) || "Campus post"}</span>
        </div>
      </div>
      {post.content ? <p className="my-profile-post-text">{post.content}</p> : null}
      {post.imageUrl && !liteMode ? <img className="my-profile-post-image" src={mediaUrl(post.imageUrl)} alt="" loading="lazy" /> : null}
      <div className="my-profile-post-stats">
        <span>{formatCount(post.reactionCount, "reaction")}</span>
        <span>{formatCount(post.commentCount, "comment")}</span>
      </div>
    </article>
  );
}

export default function MyProfilePage({ user, posts = [], liteMode = false, isOwnProfile = true, backHref = "" }) {
  const avatarSrc = user.avatarUrl ? mediaUrl(user.avatarUrl) : null;
  const coverSrc = user.coverUrl ? mediaUrl(user.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);
  const myPosts = posts.filter((post) => post.authorId === user.id);
  const statusLine = [user.statusEmoji, user.statusNote].filter(Boolean).join(" ");
  const musicLine = listeningStatusLine(user);

  return (
    <section className="my-profile-page">
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
            <Link to="/settings" className="my-profile-cover-edit">
              Edit profile
            </Link>
          ) : null}
        </div>

        <div className="my-profile-identity">
          <div className="my-profile-avatar-wrap">
            {avatarSrc ? (
              <img className="my-profile-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className="my-profile-avatar my-profile-avatar--empty">{user.name?.charAt(0) || "?"}</span>
            )}
          </div>
          <div className="my-profile-name-block">
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <div className="my-profile-pills">
              <span className={`my-profile-presence my-profile-presence--${user.availability || "online"}`}>
                {availabilityLabel(user.availability)}
              </span>
              {statusLine ? <span>{statusLine}</span> : null}
              {musicLine ? <span>{musicLine}</span> : null}
            </div>
          </div>
        </div>

        <nav className="my-profile-tabs" aria-label="Profile sections">
          <a href="#profile-posts" className="active">Posts</a>
          <a href="#profile-about">About</a>
          <a href="#profile-status">Status</a>
        </nav>
      </div>

      <div className="my-profile-grid">
        <aside className="my-profile-about-card" id="profile-about">
          <h3>Intro</h3>
          {user.bio ? <p className="my-profile-bio">{user.bio}</p> : <p className="muted small">No bio yet.</p>}
          <div className="my-profile-info-list">
            <span>{user.role === "admin" ? "Administrator" : "Student"}</span>
            <span>{availabilityLabel(user.availability)}</span>
            {statusLine ? <span id="profile-status">{statusLine}</span> : null}
            {musicLine ? <span>{musicLine}</span> : null}
          </div>
          {isOwnProfile ? <Link to="/settings" className="my-profile-edit-wide">Edit details</Link> : null}
        </aside>

        <main className="my-profile-posts" id="profile-posts">
          {backHref ? (
            <Link to={backHref} className="my-profile-back-link">
              ← Back to Community
            </Link>
          ) : null}
          {isOwnProfile ? (
          <div className="my-profile-composer-card">
            <div className="my-profile-composer-line">
              {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{user.name?.charAt(0) || "?"}</span>}
              <Link to="/community">What's on your mind?</Link>
            </div>
          </div>
          ) : null}

          <div className="my-profile-section-head">
            <h3>Posts</h3>
            <span>{formatCount(myPosts.length, "post")}</span>
          </div>

          {myPosts.length ? (
            myPosts.map((post) => <ProfilePostPreview key={post.id} post={post} liteMode={liteMode} />)
          ) : (
            <div className="my-profile-empty-posts">
              <strong>No posts yet</strong>
              <p className="muted small">
                {isOwnProfile ? "Share something in Community and it will show up here." : "This user has not posted yet."}
              </p>
              {isOwnProfile ? <Link to="/community" className="btn btn-secondary btn-sm">Create post</Link> : null}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
