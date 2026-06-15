import { mediaUrl } from "../services/api.js";

const DEFAULT_FRAME_URLS = {
  "pink-heart-bond-frame": "/assets/bond-frame-pink.png",
  "alien-stage-ivan-frame": "/assets/alien-stage-ivan-frame.png",
  "alien-stage-till-frame": "/assets/alien-stage-till-frame.png",
  "alien-stage-mizi-frame": "/assets/alien-stage-mizi-frame.png",
  "alien-stage-sua-frame": "/assets/alien-stage-sua-frame.png",
  "chiikawa-hachiware-frame": "/assets/chiikawa-hachiware-frame.png",
  "chiikawa-usagi-frame": "/assets/chiikawa-usagi-frame.png",
  "chiikawa-momonga-frame": "/assets/chiikawa-momonga-frame.png",
  "chiikawa-chiikawa-frame": "/assets/chiikawa-chiikawa-frame.png",
  "exe-frame": "/assets/exe-frame.png"
};

export function profileFrameFitClass(frameLike) {
  const value = String(frameLike?.id || frameLike || "").toLowerCase();
  if (!value) return "";
  if (value.includes("exe-frame")) return " frame-fit-exe";
  if (value.includes("chiikawa")) return " frame-fit-chiikawa";
  if (value.includes("alien-stage")) return " frame-fit-alien-stage";
  if (value.includes("bond-frame") || value.includes("pink-heart")) return " frame-fit-bond";
  return "";
}

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
  const frameFitClass = profileFrameFitClass(resolvedFrame || user?.profileFrameItemId || user?.authorProfileFrameItemId);
  const resolvedSrc = src || user?.avatarUrl || user?.authorAvatar || null;
  const displayName = name || user?.name || user?.author || "";
  const sizeClass = size ? ` avatar-frame-host--${size}` : "";
  return (
    <span className={`avatar-frame-host${sizeClass}${resolvedFrame ? " has-frame" : ""}${frameFitClass}${className ? ` ${className}` : ""}`}>
      {resolvedSrc ? (
        <img className={avatarClassName} src={mediaUrl(resolvedSrc)} alt={alt} />
      ) : (
        <span className={placeholderClassName}>{displayName.charAt(0) || "?"}</span>
      )}
      {resolvedFrame ? <img className="avatar-frame-img" src={resolvedFrame} alt="" aria-hidden="true" /> : null}
    </span>
  );
}
