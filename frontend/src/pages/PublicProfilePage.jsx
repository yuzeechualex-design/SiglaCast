import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import MyProfilePage from "./MyProfilePage.jsx";

export default function PublicProfilePage({
  api,
  posts: livePosts = [],
  currentUser,
  liteMode = false,
  onReact,
  onComment,
  onReactComment,
  onDeleteComment,
  onDeletePost,
  onShare,
  onOpenUserProfile
}) {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const [profileData, postRows] = await Promise.all([
        api(`/users/${encodeURIComponent(userId)}`),
        api("/community/posts")
      ]);
      if (cancelled) return;
      setLoading(false);
      if (profileData?.error) {
        setError(profileData.error);
        setProfile(null);
      } else {
        setProfile(profileData);
      }
      setPosts(Array.isArray(postRows) ? postRows : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  if (loading && !profile) {
    return (
      <section className="panel single">
        <Link to="/community" className="my-profile-back-link">← Back to Community</Link>
        <p className="muted">Loading profile...</p>
      </section>
    );
  }

  if (error || !profile) {
    return (
      <section className="panel single">
        <Link to="/community" className="my-profile-back-link">← Back to Community</Link>
        <p className="form-error">{error || "Could not load this profile."}</p>
      </section>
    );
  }

  const profilePosts = livePosts.length ? livePosts : posts;

  return (
    <MyProfilePage
      user={profile}
      posts={profilePosts}
      currentUser={currentUser}
      liteMode={liteMode}
      isOwnProfile={false}
      backHref="/community"
      onReact={onReact}
      onComment={onComment}
      onReactComment={onReactComment}
      onDeleteComment={onDeleteComment}
      onDeletePost={onDeletePost}
      onShare={onShare}
      onOpenUserProfile={onOpenUserProfile}
    />
  );
}
