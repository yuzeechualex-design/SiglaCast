import { useEffect, useRef, useState } from "react";

/**
 * WelcomeGiftPopup — shown once after a new user registers and logs in.
 * Props:
 *   onClaim   – async fn called when the user clicks "Claim 300 Coins" (backend credit)
 *   onClose   – called when the popup should close
 *   onDrawNow – called when the user clicks "Draw Now" (navigates to shop)
 */
export default function WelcomeGiftPopup({ onClaim, onClose, onDrawNow }) {
  const [phase, setPhase] = useState("idle"); // idle | claiming | claimed
  const [particles, setParticles] = useState([]);
  const videoRef = useRef(null);
  const popupRef = useRef(null);

  /* Fade in on mount */
  useEffect(() => {
    const t = setTimeout(() => {
      if (popupRef.current) popupRef.current.classList.add("wgp-visible");
    }, 30);
    return () => clearTimeout(t);
  }, []);

  /* Generate coin burst particles */
  function spawnParticles() {
    const count = 28;
    const list = Array.from({ length: count }, (_, i) => ({
      id: i,
      angle: (360 / count) * i + Math.random() * 10,
      distance: 80 + Math.random() * 80,
      delay: Math.random() * 0.18,
      size: 10 + Math.random() * 12,
    }));
    setParticles(list);
    setTimeout(() => setParticles([]), 1400);
  }

  async function handleClaim() {
    if (phase !== "idle") return;
    setPhase("claiming");
    spawnParticles();
    try {
      await onClaim?.();
    } catch (_) {
      // best-effort — coin credit might silently fail
    }
    setTimeout(() => setPhase("claimed"), 900);
  }

  function handleDrawNow() {
    if (popupRef.current) {
      popupRef.current.classList.remove("wgp-visible");
    }
    setTimeout(() => {
      onDrawNow?.();
      onClose?.();
    }, 380);
  }

  function handleClose() {
    if (popupRef.current) {
      popupRef.current.classList.remove("wgp-visible");
    }
    setTimeout(() => onClose?.(), 380);
  }

  return (
    <div className="wgp-overlay" aria-modal="true" role="dialog" aria-label="Welcome Gift">
      <div className="wgp-popup" ref={popupRef}>

        {/* ── Animated video background ── */}
        <video
          ref={videoRef}
          className="wgp-bg-video"
          src="/assets/exe-profile-background.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />

        {/* ── Dim gradient overlay so text stays readable ── */}
        <div className="wgp-bg-dimmer" />

        {/* ── Floating sparkles decoration ── */}
        <div className="wgp-sparkles" aria-hidden="true">
          {[...Array(12)].map((_, i) => (
            <span key={i} className="wgp-sparkle" style={{ "--i": i }} />
          ))}
        </div>

        {/* ── Close button ── */}
        <button className="wgp-close-btn" onClick={handleClose} aria-label="Close">
          ✕
        </button>

        {/* ── Header ── */}
        <div className="wgp-header">
          <div className="wgp-gift-icon" aria-hidden="true">🎁</div>
          <h2 className="wgp-title">Gift Arrived For You</h2>
          <p className="wgp-subtitle">Welcome to purxu — here's a little something to get you started!</p>
        </div>

        {/* ── Reward card ── */}
        <div className="wgp-reward-card">
          <div className="wgp-coin-icon" aria-hidden="true">
            <img src="/assets/purxu-coins-large.png" alt="Coins" draggable="false" />
          </div>
          <div className="wgp-reward-label">
            <span className="wgp-reward-amount">300</span>
            <span className="wgp-reward-unit">Purxu Coins</span>
          </div>
        </div>

        {/* ── Claim section ── */}
        <div className="wgp-actions">
          {phase !== "claimed" ? (
            <div className="wgp-claim-wrapper">
              {/* Burst particles */}
              {particles.map((p) => (
                <span
                  key={p.id}
                  className="wgp-particle"
                  style={{
                    "--angle": `${p.angle}deg`,
                    "--dist": `${p.distance}px`,
                    "--delay": `${p.delay}s`,
                    "--size": `${p.size}px`,
                  }}
                />
              ))}
              <button
                id="wgp-claim-btn"
                className={`wgp-claim-btn${phase === "claiming" ? " wgp-claiming" : ""}`}
                onClick={handleClaim}
                disabled={phase === "claiming"}
              >
                <span className="wgp-claim-btn-inner">
                  <span className="wgp-coin-mini" aria-hidden="true">🪙</span>
                  {phase === "claiming" ? "Claiming…" : "Claim 300 Coins"}
                </span>
              </button>
            </div>
          ) : (
            <div className="wgp-claimed-state">
              <div className="wgp-claimed-badge">
                <span>✅</span>
                <p>You have claimed 300 coins!</p>
              </div>
              <button
                id="wgp-draw-btn"
                className="wgp-draw-btn"
                onClick={handleDrawNow}
              >
                <span>Draw Now</span>
                <span className="wgp-draw-arrow">→</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Bottom ribbon ── */}
        <p className="wgp-footer">Coins can be spent in the Shop on gacha, frames &amp; more.</p>
      </div>
    </div>
  );
}
