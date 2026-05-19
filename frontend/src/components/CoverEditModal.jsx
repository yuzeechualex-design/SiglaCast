import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModalPortal from "./ModalPortal.jsx";

/** Preview crop viewport (~3:1 — matches profile banner strip). */
const VIEW_W = 360;
const VIEW_H = 120;
/** Exported JPEG dimensions (same aspect ratio). */
const EXPORT_W = 1080;
const EXPORT_H = 360;

function rotatedSize(w, h, deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return {
    bw: w * cos + h * sin,
    bh: w * sin + h * cos
  };
}

/** Uniform scale so rotated image covers the rectangular viewport. */
function rectCoverBaseScale(imgW, imgH, rotationDeg, viewW, viewH) {
  const { bw, bh } = rotatedSize(imgW, imgH, rotationDeg);
  if (!(bw > 0) || !(bh > 0)) return 1;
  return Math.max(viewW / bw, viewH / bh);
}

function clampPanRect(px, py, imgW, imgH, effScale, rotDeg, viewW, viewH) {
  const { bw, bh } = rotatedSize(imgW * effScale, imgH * effScale, rotDeg);
  const maxX = Math.max(0, bw / 2 - viewW / 2);
  const maxY = Math.max(0, bh / 2 - viewH / 2);
  return {
    px: Math.max(-maxX, Math.min(maxX, px)),
    py: Math.max(-maxY, Math.min(maxY, py))
  };
}

function drawCoverPreview(ctx, viewW, viewH, img, panX, panY, zoomMul, baseScale, rotationDeg, bgFill) {
  const cx = viewW / 2;
  const cy = viewH / 2;
  const rot = (rotationDeg * Math.PI) / 180;
  const effScale = baseScale * zoomMul;

  ctx.fillStyle = bgFill;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, viewW, viewH);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.translate(panX, panY);
  ctx.scale(effScale, effScale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1.5, 1.5, viewW - 3, viewH - 3);
}

function blobFromCanvas(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Could not encode image"));
    }, "image/jpeg", quality);
  });
}

/**
 * Wide rectangular banner crop — drag / zoom / rotate, same workflow as avatar editor.
 * Animated GIFs upload without re-encoding so motion is preserved (crop/zoom apply to still images only).
 */
export default function CoverEditModal({ file, onClose, onApply, uploading = false }) {
  const [img, setImg] = useState(null);
  const isGif = file?.type === "image/gif";

  /** Sync blob URL — avoids an extra React commit before the GIF <img> can render (GIF branch never depended on raster decode). */
  const gifBlobUrl = useMemo(() => {
    if (!file || !isGif) return "";
    return URL.createObjectURL(file);
  }, [file, isGif]);

  useEffect(() => {
    return () => {
      if (gifBlobUrl) URL.revokeObjectURL(gifBlobUrl);
    };
  }, [gifBlobUrl]);

  const [zoomMul, setZoomMul] = useState(1);
  const [rotQuarter, setRotQuarter] = useState(0);
  const rotationDeg = rotQuarter * 90;
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const previewRef = useRef(null);
  const dragRef = useRef(null);

  const baseScale = useMemo(() => {
    if (!img) return 1;
    return rectCoverBaseScale(img.naturalWidth, img.naturalHeight, rotationDeg, VIEW_W, VIEW_H);
  }, [img, rotationDeg]);

  useEffect(() => {
    if (isGif) {
      setImg(null);
      return undefined;
    }
    const u = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => setImg(image);
    image.src = u;
    return () => {
      URL.revokeObjectURL(u);
      setImg(null);
    };
  }, [file, isGif]);

  useEffect(() => {
    setPanX(0);
    setPanY(0);
  }, [rotationDeg, isGif]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !img?.naturalWidth || isGif) return;
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d");
    const effScale = baseScale * zoomMul;
    const c = clampPanRect(panX, panY, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, VIEW_W, VIEW_H);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawCoverPreview(ctx, VIEW_W, VIEW_H, img, c.px, c.py, zoomMul, baseScale, rotationDeg, "rgba(20,26,42,0.92)");
  }, [img, rotationDeg, panX, panY, zoomMul, baseScale, isGif]);

  const applyClampedPan = useCallback(
    (nx, ny) => {
      if (!img?.naturalWidth) return;
      const effScale = baseScale * zoomMul;
      const c = clampPanRect(nx, ny, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, VIEW_W, VIEW_H);
      setPanX(c.px);
      setPanY(c.py);
    },
    [img, baseScale, zoomMul, rotationDeg]
  );

  function onPointerDown(e) {
    if (!img || uploading) return;
    dragRef.current = { sx: panX - e.clientX, sy: panY - e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
  }

  function onPointerMove(e) {
    if (!dragRef.current || !img || uploading) return;
    applyClampedPan(dragRef.current.sx + e.clientX, dragRef.current.sy + e.clientY);
  }

  function onPointerEnd(e) {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
  }

  function handleReset() {
    setZoomMul(1);
    setRotQuarter(0);
    setPanX(0);
    setPanY(0);
  }

  function handleRotate() {
    setRotQuarter((v) => (v + 1) % 4);
  }

  async function handleApplyGif() {
    if (!file || uploading) return;
    try {
      await onApply?.(file);
      onClose?.();
    } catch {
      /* leave modal open */
    }
  }

  async function handleApply() {
    if (!img?.naturalWidth || uploading) return;
    const effScale = baseScale * zoomMul;
    const clamped = clampPanRect(panX, panY, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, VIEW_W, VIEW_H);

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f5f8ff";
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

    const ratio = EXPORT_W / VIEW_W;
    const rot = (rotationDeg * Math.PI) / 180;
    ctx.save();
    ctx.translate(EXPORT_W / 2, EXPORT_H / 2);
    ctx.rotate(rot);
    ctx.translate(clamped.px * ratio, clamped.py * ratio);
    ctx.scale(effScale * ratio, effScale * ratio);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    try {
      const blob = await blobFromCanvas(canvas);
      const outFile = new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onApply?.(outFile);
      onClose?.();
    } catch {
      /* Encode/upload failure — leave modal open */
    }
  }

  return (
    <ModalPortal>
      <div
        className="modal-backdrop modal-backdrop--portal avatar-edit-overlay"
        role="presentation"
        onClick={() => !uploading && onClose?.()}
      >
        <div className="modal-card cover-edit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>{isGif ? "GIF profile cover" : "Edit cover"}</h3>
            <button type="button" className="modal-close" onClick={() => !uploading && onClose?.()} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="modal-body avatar-edit-body">
            {isGif ? (
              <>
                <div className="avatar-edit-stage-wrap">
                  <img className="cover-edit-gif-preview" src={gifBlobUrl || undefined} alt="" decoding="async" />
                </div>
                <p className="muted small avatar-edit-hint gif-edit-hint">
                  GIF uploads keep animation — your whole file is sent as-is. Use JPG / PNG / WebP if you want crop, zoom, or rotate for the banner strip.
                </p>
                <div className="avatar-edit-footer avatar-edit-footer--gif-only">
                  <div className="avatar-edit-footer-actions avatar-edit-footer-actions--gif">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => onClose?.()}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={uploading} onClick={() => void handleApplyGif()}>
                      {uploading ? "Uploading…" : "Upload GIF"}
                    </button>
                  </div>
                </div>
              </>
            ) : !img?.naturalWidth ? (
              <p className="muted">Loading preview…</p>
            ) : (
              <>
                <div className="avatar-edit-stage-wrap">
                  <canvas
                    ref={previewRef}
                    className="cover-edit-canvas"
                    width={VIEW_W}
                    height={VIEW_H}
                    role="presentation"
                    style={{ touchAction: "none" }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                  />
                  <p className="muted small avatar-edit-hint">
                    Drag to reposition · slider zooms · rotate if needed · matches your profile banner strip
                  </p>
                </div>

                <div className="avatar-edit-controls">
                  <label className="avatar-edit-zoom-label muted small" htmlFor="cover-zoom-range">
                    Zoom
                  </label>
                  <div className="avatar-edit-zoom-row">
                    <span className="muted" aria-hidden>
                      −
                    </span>
                    <input
                      id="cover-zoom-range"
                      type="range"
                      min={1}
                      max={4}
                      step={0.01}
                      value={zoomMul}
                      onChange={(e) => setZoomMul(Number(e.target.value))}
                      disabled={uploading}
                      aria-valuemin={1}
                      aria-valuemax={4}
                      aria-valuenow={zoomMul}
                      aria-label="Zoom cover image"
                    />
                    <span className="muted" aria-hidden>
                      +
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm avatar-edit-rotate"
                      title="Rotate 90°"
                      aria-label="Rotate 90 degrees"
                      disabled={uploading}
                      onClick={handleRotate}
                    >
                      ↻
                    </button>
                  </div>
                </div>

                <div className="avatar-edit-footer">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={uploading || !img} onClick={handleReset}>
                    Reset
                  </button>
                  <div className="avatar-edit-footer-actions">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => onClose?.()}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={uploading || !img} onClick={() => void handleApply()}>
                      {uploading ? "Uploading…" : "Apply"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
