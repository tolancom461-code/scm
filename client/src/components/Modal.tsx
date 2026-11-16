import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
export function Modal({
  title,
  children,
  close,
  eyebrow,
  closeDisabled = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  eyebrow?: string;
  closeDisabled?: boolean;
}) {
  const locale = (document.documentElement.lang || "ar") as Locale;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close, closeDisabled]);
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-card"
      >
        <header>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={closeDisabled}
            aria-label={t(locale, "close")}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
