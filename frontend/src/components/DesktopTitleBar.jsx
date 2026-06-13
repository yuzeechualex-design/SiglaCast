import { useEffect, useState } from "react";

export default function DesktopTitleBar() {
  const desktop = typeof window !== "undefined" ? window.purxuDesktop : null;
  const [isDesktop, setIsDesktop] = useState(Boolean(desktop?.isDesktop));

  useEffect(() => {
    if (!desktop?.isDesktop) return undefined;
    setIsDesktop(true);
    document.body.classList.add("desktop-shell");
    return () => document.body.classList.remove("desktop-shell");
  }, [desktop]);

  if (!isDesktop) return null;

  const control = (action) => {
    void desktop?.windowControl?.(action);
  };

  return (
    <div className="desktop-titlebar">
      <div className="desktop-titlebar-left">
        <button type="button" className="desktop-nav-btn" onClick={() => window.history.back()} aria-label="Back">
          &larr;
        </button>
        <button type="button" className="desktop-nav-btn" onClick={() => window.history.forward()} aria-label="Forward">
          &rarr;
        </button>
      </div>

      <div className="desktop-titlebar-brand" aria-label="purxu desktop">
        <img src="/assets/purxu-logo.png" alt="" />
        <span>purxu</span>
      </div>

      <div className="desktop-window-controls">
        <button type="button" onClick={() => control("minimize")} aria-label="Minimize">
          <span />
        </button>
        <button type="button" onClick={() => control("maximize")} aria-label="Maximize">
          <i />
        </button>
        <button type="button" className="close" onClick={() => control("close")} aria-label="Close">
          &times;
        </button>
      </div>
    </div>
  );
}
