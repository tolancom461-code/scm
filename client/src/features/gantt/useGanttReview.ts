import { useCallback, useEffect, useRef, useState } from "react";

export function useGanttReview() {
  const [expanded, setExpanded] = useState(false);
  const active = useRef(false);
  const ownsFullscreen = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const escapeHandler = useRef<(() => boolean) | null>(null);
  const escapeHandledAt = useRef(0);
  const setEscapeHandler = useCallback((handler: (() => boolean) | null) => {
    escapeHandler.current = handler;
  }, []);
  const noteEscape = useCallback((handled: boolean) => {
    escapeHandledAt.current = handled ? Date.now() : 0;
  }, []);

  const exitNativeFullscreen = useCallback(() => {
    if (
      ownsFullscreen.current &&
      document.fullscreenElement === document.documentElement
    ) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const setReviewMode = useCallback(
    (next: boolean) => {
      if (active.current === next) return;
      active.current = next;
      setExpanded(next);

      if (!next) {
        exitNativeFullscreen();
        return;
      }
      if (
        !document.fullscreenEnabled ||
        document.fullscreenElement ||
        pending.current
      )
        return;

      try {
        const request = document.documentElement.requestFullscreen({
          navigationUI: "hide",
        });
        pending.current = request;
        void request
          .then(() => {
            ownsFullscreen.current =
              document.fullscreenElement === document.documentElement;
            if (!active.current) exitNativeFullscreen();
          })
          .catch(() => {
            // The board is already expanded to the browser viewport.
          })
          .finally(() => {
            pending.current = null;
          });
      } catch {
        // Some embedded browsers expose the API but block fullscreen.
      }
    },
    [exitNativeFullscreen]
  );

  useEffect(() => {
    const openDialog = () =>
      document.querySelector(
        'dialog[open], [role="dialog"][aria-modal="true"]'
      );
    const alreadyHandled = () =>
      escapeHandledAt.current > 0 && Date.now() - escapeHandledAt.current < 350;
    function synchronizeFullscreen() {
      if (document.fullscreenElement === document.documentElement) {
        if (pending.current) ownsFullscreen.current = true;
      } else if (ownsFullscreen.current) {
        ownsFullscreen.current = false;
        if (!active.current || alreadyHandled()) return;
        // Native fullscreen may consume Escape before the iframe sees it.
        // Keep the board expanded while closing a dialog or its Today filter.
        if (openDialog()) {
          noteEscape(true);
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape" })
          );
        } else if (escapeHandler.current?.()) noteEscape(true);
        else {
          noteEscape(true);
          setReviewMode(false);
        }
      }
    }
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openDialog()) {
        if (!event.repeat) noteEscape(true);
        return;
      }
      if (event.repeat || alreadyHandled()) {
        if (active.current || alreadyHandled()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      const handled = escapeHandler.current?.() ?? false;
      if (!handled && !active.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      noteEscape(true);
      if (!handled) setReviewMode(false);
    }
    function releaseEscape(event: KeyboardEvent) {
      if (event.key === "Escape") noteEscape(false);
    }
    document.addEventListener("fullscreenchange", synchronizeFullscreen);
    window.addEventListener("keydown", exitOnEscape, true);
    window.addEventListener("keyup", releaseEscape, true);
    return () => {
      document.removeEventListener("fullscreenchange", synchronizeFullscreen);
      window.removeEventListener("keydown", exitOnEscape, true);
      window.removeEventListener("keyup", releaseEscape, true);
      active.current = false;
      exitNativeFullscreen();
    };
  }, [exitNativeFullscreen, noteEscape, setReviewMode]);

  return { expanded, setReviewMode, setEscapeHandler, noteEscape };
}
