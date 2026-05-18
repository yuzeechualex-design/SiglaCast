import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Render modal UI at document.body so position:fixed is viewport-relative (not clipped by
 * .messages-panel, .messages-layout, fullscreen chat, etc.).
 */
export default function ModalPortal({ children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(children, document.body);
}
