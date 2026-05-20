import { createContext, useCallback, useContext, useEffect, useState } from "react";
import ModalPortal from "./ModalPortal.jsx";

const ImageLightboxContext = createContext(null);

export function ImageLightboxProvider({ children }) {
  const [src, setSrc] = useState(null);

  const openLightbox = useCallback((url) => {
    if (!url || typeof url !== "string") return;
    setSrc(url);
  }, []);

  const closeLightbox = useCallback(() => setSrc(null), []);

  useEffect(() => {
    if (!src) return undefined;
    function onKey(e) {
      if (e.key === "Escape") closeLightbox();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, closeLightbox]);

  return (
    <ImageLightboxContext.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      {src ? (
        <ModalPortal>
          <div
            className="image-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Full image"
            onClick={closeLightbox}
          >
            <button type="button" className="image-lightbox-close" onClick={closeLightbox} aria-label="Close">
              ✕
            </button>
            <img
              src={src}
              alt=""
              className="image-lightbox-img"
              onClick={(e) => e.stopPropagation()}
              decoding="async"
            />
          </div>
        </ModalPortal>
      ) : null}
    </ImageLightboxContext.Provider>
  );
}

export function useImageLightbox() {
  const ctx = useContext(ImageLightboxContext);
  if (!ctx) {
    throw new Error("useImageLightbox must be used within ImageLightboxProvider");
  }
  return ctx;
}
