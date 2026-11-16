import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { mrText, type MrKey } from "./copy";

export function localImageUrl(value: string | null | undefined) {
  if (!value || !value.startsWith("/material-requisitions/")) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

export function ItemImage({
  url,
  name,
  locale,
}: {
  url?: string | null;
  name: string;
  locale: Locale;
}) {
  const c = (key: MrKey) => mrText(locale, key),
    source = localImageUrl(url);
  const [enlarged, setEnlarged] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [source]);
  if (!source || failed)
    return <span className="mr-no-image">{c("noImage")}</span>;
  return (
    <>
      <button
        type="button"
        className="mr-image-button"
        aria-label={`${c("enlargeImage")} — ${name}`}
        title={c("enlargeImage")}
        onClick={() => setEnlarged(true)}
      >
        <img
          className="mr-item-image"
          src={source}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
      {enlarged && (
        <div
          className="mr-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={c("itemImage")}
          onClick={() => setEnlarged(false)}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEnlarged(false);
            }
          }}
        >
          <button type="button" autoFocus onClick={() => setEnlarged(false)}>
            {c("close")}
          </button>
          <figure onClick={event => event.stopPropagation()}>
            <img src={source} alt={name} />
            <figcaption>{name}</figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
