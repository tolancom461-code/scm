import { useCallback, useEffect, useRef, useState } from "react";

export function useGanttReview() {
  const [expanded, setExpanded] = useState(false);
  const active = useRef(false);
  const ownsFullscreen = useRef(false);
  const pending = useRef<Promise<void> | null>(null);

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
    let exitingWithEscape = false;
    function synchronizeFullscreen() {
      if (document.fullscreenElement === document.documentElement) {
        if (pending.current) ownsFullscreen.current = true;
      } else if (ownsFullscreen.current) {
        ownsFullscreen.current = false;
        if (active.current) exitingWithEscape = true;
        setReviewMode(false);
      }
    }
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!event.repeat) exitingWithEscape = active.current;
      if (!active.current && !exitingWithEscape) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setReviewMode(false);
    }
    function releaseEscape(event: KeyboardEvent) {
      if (event.key === "Escape") exitingWithEscape = false;
    }
    function preserveDialog(event: Event) {
      if (
        (!active.current && !exitingWithEscape) ||
        !(event.target instanceof HTMLDialogElement)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setReviewMode(false);
    }
    document.addEventListener("fullscreenchange", synchronizeFullscreen);
    window.addEventListener("keydown", exitOnEscape, true);
    window.addEventListener("keyup", releaseEscape, true);
    document.addEventListener("cancel", preserveDialog, true);
    return () => {
      document.removeEventListener("fullscreenchange", synchronizeFullscreen);
      window.removeEventListener("keydown", exitOnEscape, true);
      window.removeEventListener("keyup", releaseEscape, true);
      document.removeEventListener("cancel", preserveDialog, true);
      active.current = false;
      exitNativeFullscreen();
    };
  }, [exitNativeFullscreen, setReviewMode]);

  return { expanded, setReviewMode };
}
