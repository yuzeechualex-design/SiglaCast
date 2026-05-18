import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

// MentionInput
// Wraps a single-line <input> or <textarea> and provides Facebook-style
// `@mention` autocomplete. When the user types `@` followed by characters, we
// query /api/users/search for matches and show a popover. Clicking (or pressing
// Enter on) a result inserts `@[Full Name] ` so the backend can extract it.
//
// Props:
//   - value (string)
//   - onChange (fn(newValue))
//   - placeholder
//   - as: "input" | "textarea"  (default: "input")
//   - rows, autoFocus, className, name, disabled  — forwarded
//   - inputRef — optional ref to expose the underlying element
export default function MentionInput({
  value,
  onChange,
  placeholder,
  as = "input",
  rows = 3,
  autoFocus = false,
  className,
  name,
  disabled,
  inputRef
}) {
  const localRef = useRef(null);
  const elRef = inputRef || localRef;

  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);
  const [searching, setSearching] = useState(false);

  function detectTrigger(text, cursorPos) {
    // Look back from cursor for the latest `@` that's not preceded by a word char.
    const before = text.slice(0, cursorPos);
    // Match `@` then any number of letters/digits/spaces (without entering a new `@`).
    const m = before.match(/(^|[\s\n])@([\w][\w ]{0,30})$/);
    if (!m) return null;
    const queryStart = before.length - m[2].length - 1; // index of the `@`
    return { queryStart, query: m[2] };
  }

  async function fetchMatches(q) {
    setSearching(true);
    try {
      const token = localStorage.getItem("siglacast_token") || "";
      const res = await fetch(
        `${API_BASE}/api/users/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      setResults(Array.isArray(data) ? data.slice(0, 6) : []);
      setActiveIndex(0);
    } finally {
      setSearching(false);
    }
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    const pos = e.target.selectionStart ?? text.length;
    const trigger = detectTrigger(text, pos);
    if (trigger) {
      setTriggerStart(trigger.queryStart);
      if (trigger.query.trim().length > 0) {
        fetchMatches(trigger.query.trim());
        setOpen(true);
      } else {
        setOpen(false);
        setResults([]);
      }
    } else {
      setOpen(false);
      setResults([]);
    }
  }

  function pick(user) {
    if (!user || triggerStart < 0) return;
    const text = value;
    const pos = elRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, triggerStart);
    const after = text.slice(pos);
    const inserted = `@[${user.name}] `;
    const newText = before + inserted + after;
    onChange(newText);
    setOpen(false);
    setResults([]);
    setTriggerStart(-1);
    requestAnimationFrame(() => {
      if (elRef.current) {
        const caret = before.length + inserted.length;
        elRef.current.focus();
        elRef.current.setSelectionRange(caret, caret);
      }
    });
  }

  function handleKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(results[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Close popover when clicking outside.
  useEffect(() => {
    function onDoc(e) {
      if (!elRef.current) return;
      const wrap = elRef.current.closest(".mention-input-wrap");
      if (wrap && !wrap.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, elRef]);

  const sharedProps = {
    ref: elRef,
    value: value || "",
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    placeholder,
    autoFocus,
    name,
    disabled,
    className
  };

  return (
    <div className="mention-input-wrap">
      {as === "textarea" ? (
        <textarea rows={rows} {...sharedProps} />
      ) : (
        <input type="text" {...sharedProps} />
      )}
      {open && results.length > 0 ? (
        <div className="mention-popover">
          {results.map((u, i) => (
            <button
              type="button"
              key={u.id}
              className={`mention-row ${i === activeIndex ? "active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(u)}
            >
              {u.avatarUrl ? (
                <img className="msg-avatar sm" src={mediaUrl(u.avatarUrl)} alt="" />
              ) : (
                <div className="msg-avatar sm placeholder">{u.name?.charAt(0) || "?"}</div>
              )}
              <span className="mention-row-info">
                <strong>{u.name}</strong>
                <small>{u.email}</small>
              </span>
            </button>
          ))}
          {searching ? <p className="mention-row muted small">Searching…</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function mediaUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}
