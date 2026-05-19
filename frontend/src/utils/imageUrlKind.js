/** True when pathname ends with .gif (queries/hash stripped). Use so covers render with <img> — CSS backgrounds often freeze GIFs. */
export function publicUrlLooksLikeGif(url) {
  if (!url || typeof url !== "string") return false;
  const stem = url.split("?")[0].split("#")[0].trim().toLowerCase();
  return stem.endsWith(".gif");
}
