export default function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span className="theme-toggle-label">{isDark ? "DARK" : "LIGHT"}</span>
      <span className="theme-toggle-track">
        <span className="theme-toggle-icon left" aria-hidden>☀️</span>
        <span className="theme-toggle-icon right" aria-hidden>🌙</span>
        <span className="theme-toggle-thumb">{isDark ? "🌙" : "☀️"}</span>
      </span>
    </button>
  );
}
