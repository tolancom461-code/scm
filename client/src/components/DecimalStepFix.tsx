import { useEffect } from "react";

/** Ensures currency inputs accept decimal values consistently across operational forms. */
export function DecimalStepFix() {
  useEffect(() => {
    const apply = () => document.querySelectorAll<HTMLInputElement>('input[type="number"][min="0.01"]').forEach((input) => {
      if (!input.getAttribute("step")) input.setAttribute("step", "0.01");
    });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
