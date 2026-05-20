import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EMOJI_TABS = [
  {
    id: "smileys",
    label: "Smileys",
    emojis:
      "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🙈 🙉 🙊 💀 👻 👽 🤖 💩 😺 😸 😹 😻 🤝 👏 🙌 👍 👎 ✌️ 🤞 🤟 🤘 🤙 👌 🤌 ✋ 🙏 💪 ❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❤️‍🔥 💯 ✨ 🔥 🌟 💫 ⭐ 🎉 🎊 🏆 🎯 ✅ ❌ ❓ 💬 💭 🔔 📌 📎 🎵 🎶 ☕ 🍕 🍰 🎂 🍎 🍊 🚀 ✈️ 🌍 ⚽ 🏀 🎮 🐶 🐱 🐻 🦁 🐼 🌸 🌈 ☀️ 🌙 ⚡ 💧 🔒 🔑".split(
        /\s+/
      )
  },
  {
    id: "hearts",
    label: "Hearts & hands",
    emojis:
      "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💖 💗 💘 💝 💞 💕 💟 ❣️ 💔 ❤️‍🔥 💯 🤍 🤎 💋 👄 👅 🦷 👂 🦻 👃 👣 👀 👁️ 🧠 💭 💬 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶".split(
        /\s+/
      )
  },
  {
    id: "fun",
    label: "Fun & misc",
    emojis:
      "🎉 🎊 🥳 🎈 🎁 🏆 🥇 🥈 🥉 ⚽ 🏀 🏈 ⚾ 🎾 🎮 🕹️ 🎲 🃏 🀄 🎯 🎳 🎪 🎭 🖼️ 🎨 🧩 📷 📸 📹 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎻 🔊 📣 📢 💤 💭 💤 👻 🤡 👽 🤖 💩 🔮 🎃 🕷️ 🕸️ 👑 💎 👔 👗 🎒 💼 🌟 ✨ ⚡ 🔥 💧 🌊 🌈 ☀️ 🌙 🌍 🗺️ 🏠 🏫 ❗ ❓ 💯 🆗 🆒 🆕 🔝 👀 🤝 💪 🙌 🙏".split(
        /\s+/
      )
  }
];

/**
 * Opens a tabbed emoji grid (portal + fixed position). Inserts picked emoji via `onPick`.
 */
export default function EmojiPickerButton({ onPick, title = "Insert emoji", className = "" }) {
  const [open, setOpen] = useState(false);
  const [tabIdx, setTabIdx] = useState(0);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [panelBox, setPanelBox] = useState(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const panelW = Math.min(300, window.innerWidth - 16);
    const panelH = 248;
    let left = r.left + r.width / 2 - panelW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
    let top = r.top - panelH - 10;
    if (top < 8) top = r.bottom + 10;
    if (top + panelH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - panelH - 8);
    }
    setPanelBox({ left, top, width: panelW, height: panelH });
  }, [open, tabIdx]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocDown(e) {
      const t = e.target;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  function handlePick(emoji) {
    onPick?.(emoji);
    setOpen(false);
  }

  const panel =
    open && panelBox
      ? createPortal(
          <div
            ref={panelRef}
            className={`emoji-picker-panel ${className}`.trim()}
            role="dialog"
            aria-label="Emoji picker"
            style={{
              position: "fixed",
              left: panelBox.left,
              top: panelBox.top,
              width: panelBox.width,
              zIndex: 10002
            }}
          >
            <div className="emoji-picker-tabs" role="tablist">
              {EMOJI_TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={tabIdx === i}
                  className={`emoji-picker-tab ${tabIdx === i ? "active" : ""}`}
                  onClick={() => setTabIdx(i)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="emoji-picker-grid" role="tabpanel">
              {(EMOJI_TABS[tabIdx]?.emojis || [])
                .filter((ch) => ch && ch.length > 0)
                .map((emoji, idx) => (
                  <button
                    key={`${EMOJI_TABS[tabIdx].id}-${idx}`}
                    type="button"
                    className="emoji-picker-cell"
                    title={emoji}
                    onClick={() => handlePick(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-icon emoji-picker-trigger"
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        😊
      </button>
      {panel}
    </>
  );
}
