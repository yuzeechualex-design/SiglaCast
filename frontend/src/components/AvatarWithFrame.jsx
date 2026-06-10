import { mediaUrl } from "../services/api.js";

const DEFAULT_FRAME_URLS = {
  "pink-heart-bond-frame": "/assets/bond-frame-pink.png"
};

export function resolveProfileFrameUrl(userLike) {
  const explicit = userLike?.profileFrameUrl || userLike?.authorProfileFrameUrl;
  if (explicit) return explicit;
  const itemId = userLike?.profileFrameItemId || userLike?.authorProfileFrameItemId;
  return DEFAULT_FRAME_URLS[itemId] || null;
}

export default function AvatarWithFrame({
  user,
  src,
  name,
  frameUrl,
  className = "",
  avatarClassName = "",
  placeholderClassName = "",
  size = "md",
  alt = ""
}) {
  const resolvedFrame = frameUrl || resolveProfileFrameUrl(user);
  const resolvedSrc = src || user?.avatarUrl || user?.authorAvatar || null;
  const displayName = name || user?.name || user?.author || "";
  const sizeClass = size ? ` avatar-frame-host--${size}` : "";
  return (
    <span className={`avatar-frame-host${sizeClass}${resolvedFrame ? " has-frame" : ""}${className ? ` ${className}` : ""}`}>
      {resolvedSrc ? (
        <img className={avatarClassName} src={mediaUrl(resolvedSrc)} alt={alt} />
      ) : (
        <span className={placeholderClassName}>{displayName.charAt(0) || "?"}</span>
      )}
      {resolvedFrame ? <img className="avatar-frame-img" src={resolvedFrame} alt="" aria-hidden="true" /> : null}
    </span>
  );
}
