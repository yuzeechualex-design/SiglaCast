import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModalPortal from "./ModalPortal.jsx";

const VIEW_SIZE = 300;
const EXPORT_SIZE = 512;

function rotatedSize(w, h, deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return {
    bw: w * cos + h * sin,
    bh: w * sin + h * cos
  };
}

function coverBaseScale(imgW, imgH, rotationDeg, viewSide) {
  const { bw, bh } = rotatedSize(imgW, imgH, rotationDeg);
  if (!(bw > 0) || !(bh > 0)) return 1;
  return Math.max(viewSide / bw, viewSide / bh);
}

function clampPan(px, py, imgW, imgH, effScale, rotDeg, radius) {
  const { bw, bh } = rotatedSize(imgW * effScale, imgH * effScale, rotDeg);
  const cx = bw / 2;
  const cy = bh / 2;
  const maxX = Math.max(0, cx - radius);
  const maxY = Math.max(0, cy - radius);
  return {
    px: Math.max(-maxX, Math.min(maxX, px)),
    py: Math.max(-maxY, Math.min(maxY, py))
  };
}

function drawPreviewCanvas(ctx, width, img, panX, panY, zoomMul, baseScale, rotationDeg, bgFill) {
  const cx = width / 2;
  const cy = width / 2;
  const R = width / 2 - 1;
  const rot = (rotationDeg * Math.PI) / 180;
  const effScale = baseScale * zoomMul;

  ctx.fillStyle = bgFill;
  ctx.fillRect(0, 0, width, width);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.translate(panX, panY);
  ctx.scale(effScale, effScale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = Math.max(2, width / 140);
  ctx.stroke();
}

function blobFromCanvas(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Could not encode image"));
    }, "image/jpeg", quality);
  });
}

/**
 * Circular crop overlay (Discord-style): drag to frame, slider zooms, rotate 90° steps.
 * Animated GIFs upload without re-encoding so motion is preserved (crop/zoom only apply to still images).
 */
export default function AvatarEditModal({ file, onClose, onApply, uploading = false }) {
  const [img, setImg] = useState(null);
  const [gifPreviewUrl, setGifPreviewUrl] = useState("");
  const isGif = file?.type === "image/gif";
  const [zoomMul, setZoomMul] = useState(1);
  const [rotQuarter, setRotQuarter] = useState(0);
  const rotationDeg = rotQuarter * 90;
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const previewRef = useRef(null);
  const dragRef = useRef(null);

  const baseScale = useMemo(() => {
    if (!img) return 1;
    return coverBaseScale(img.naturalWidth, img.naturalHeight, rotationDeg, VIEW_SIZE);
  }, [img, rotationDeg]);

  useEffect(() => {
    if (isGif) {
      const u = URL.createObjectURL(file);
      setGifPreviewUrl(u);
      setImg(null);
      return () => {
        URL.revokeObjectURL(u);
        setGifPreviewUrl("");
      };
    }
    setGifPreviewUrl("");
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
  }, [rotationDeg]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !img?.naturalWidth) return;
    canvas.width = VIEW_SIZE;
    canvas.height = VIEW_SIZE;
    const ctx = canvas.getContext("2d");
    const effScale = baseScale * zoomMul;
    const R = VIEW_SIZE / 2 - 1;
    const c = clampPan(panX, panY, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, R);
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    drawPreviewCanvas(ctx, VIEW_SIZE, img, c.px, c.py, zoomMul, baseScale, rotationDeg, "rgba(20,26,42,0.92)");
  }, [img, rotationDeg, panX, panY, zoomMul, baseScale]);

  const applyClampedPan = useCallback(
    (nx, ny) => {
      if (!img?.naturalWidth) return;
      const effScale = baseScale * zoomMul;
      const R = VIEW_SIZE / 2 - 1;
      const c = clampPan(nx, ny, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, R);
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
      /* upload failed — parent may show notice; keep modal open */
    }
  }

  async function handleApply() {
    if (!img?.naturalWidth || uploading) return;
    const effScale = baseScale * zoomMul;
    const Rpreview = VIEW_SIZE / 2 - 1;
    const clamped = clampPan(panX, panY, img.naturalWidth, img.naturalHeight, effScale, rotationDeg, Rpreview);

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f5f8ff";
    ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);

    const ratio = EXPORT_SIZE / VIEW_SIZE;
    ctx.save();
    ctx.beginPath();
    ctx.arc(EXPORT_SIZE / 2, EXPORT_SIZE / 2, EXPORT_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    const rot = (rotationDeg * Math.PI) / 180;
    ctx.translate(EXPORT_SIZE / 2, EXPORT_SIZE / 2);
    ctx.rotate(rot);
    ctx.translate(clamped.px * ratio, clamped.py * ratio);
    ctx.scale(effScale * ratio, effScale * ratio);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    try {
      const blob = await blobFromCanvas(canvas);
      const outFile = new File([blob], `avatar-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onApply?.(outFile);
      onClose?.();
    } catch {
      /* JPEG encode or upload failed — leave modal open; parent may show notice */
    }
  }

  return (
    <ModalPortal>
      <div
        className="modal-backdrop modal-backdrop--portal avatar-edit-overlay"
        role="presentation"
        onClick={() => !uploading && onClose?.()}
      >
        <div className="modal-card avatar-edit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>{isGif ? "GIF profile photo" : "Edit image"}</h3>
            <button type="button" className="modal-close" onClick={() => !uploading && onClose?.()} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="modal-body avatar-edit-body">
            {isGif ? (
              !gifPreviewUrl ? (
                <p className="muted">Loading preview…</p>
              ) : (
                <>
                  <div className="avatar-edit-stage-wrap">
                    <img
                      className="avatar-edit-gif-preview"
                      src={gifPreviewUrl}
                      alt=""
                    />
                  </div>
                  <p className="muted small avatar-edit-hint gif-edit-hint">
                    GIF uploads keep animation — your whole file is sent as-is. Use JPG / PNG / WebP if you want to crop or zoom inside the circle.
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
              )
            ) : !img?.naturalWidth ? (
              <p className="muted">Loading preview…</p>
            ) : (
              <>
                <div className="avatar-edit-stage-wrap">
                  <canvas
                    ref={previewRef}
                    className="avatar-edit-canvas"
                    width={VIEW_SIZE}
                    height={VIEW_SIZE}
                    role="presentation"
                    style={{ touchAction: "none" }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                  />
                  <p className="muted small avatar-edit-hint">Drag inside the circle to frame your photo · use zoom &amp; rotate if needed</p>
                </div>

                <div className="avatar-edit-controls">
                  <label className="avatar-edit-zoom-label muted small" htmlFor="avatar-zoom-range">
                    Zoom
                  </label>
                  <div className="avatar-edit-zoom-row">
                    <span className="muted" aria-hidden>
                      −
                    </span>
                    <input
                      id="avatar-zoom-range"
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
                      aria-label="Zoom image"
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
