// Render plain text where any `@[Name]` token is replaced with a styled span
// reading just "@Name". Preserves line breaks and the rest of the text.
export default function MentionText({ text }) {
  if (!text) return null;
  const parts = [];
  const re = /@\[([^\]]+)\]/g;
  let lastIndex = 0;
  let key = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(
      <span key={`mention-${key++}`} className="mention-pill">
        @{m[1]}
      </span>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
