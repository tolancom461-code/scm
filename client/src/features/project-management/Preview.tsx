import { lazy, Suspense, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import type { Locale } from "@/lib/i18n";
const PdfPreview = lazy(() =>
  import("./PdfPreview").then(m => ({ default: m.PdfPreview }))
);
export function FilePreview({
  file,
  locale,
  close,
}: {
  file: { fileName: string; url: string };
  locale: Locale;
  close: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    dwg = /\.dwg$/i.test(file.fileName),
    pdf = /\.pdf$/i.test(file.fileName),
    t = (ar: string, en: string) => (locale === "ar" ? ar : en);
  useEffect(() => {
    let alive = true,
      objectUrl = "",
      worker: Worker | undefined;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (timeout) clearTimeout(timeout);
      worker?.terminate();
      if (alive)
        setError(
          locale === "ar"
            ? "تعذر استعراض هذا الملف. قد يكون إصدار الرسم أو بعض عناصره غير مدعومة."
            : "Unable to preview this file. Its drawing version or entities may be unsupported."
        );
    };
    const ready = (blob: Blob) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      if (timeout) clearTimeout(timeout);
    };
    if (pdf)
      return () => {
        alive = false;
        controller.abort();
      };
    void (async () => {
      try {
        const response = await fetch(file.url, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Attachment unavailable");
        const buffer = await response.arrayBuffer();
        if (dwg) {
          worker = new Worker(new URL("./dwg.worker.ts", import.meta.url), {
            type: "module",
          });
          timeout = setTimeout(() => {
            worker?.terminate();
            fail();
          }, 45000);
          worker.onmessage = e => {
            if (e.data.error) {
              fail();
              return;
            }
            const svg = String(e.data.svg);
            if (!svg.includes("<svg")) {
              fail();
              return;
            }
            ready(new Blob([svg], { type: "image/svg+xml" }));
            worker?.terminate();
          };
          worker.onerror = fail;
          worker.postMessage(buffer, [buffer]);
        } else {
          const ext = file.fileName.split(".").at(-1)?.toLowerCase(),
            mime = pdf
              ? "application/pdf"
              : ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "png"
                  ? "image/png"
                  : ext === "gif"
                    ? "image/gif"
                    : "image/webp";
          ready(new Blob([buffer], { type: mime }));
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) fail();
      }
    })();
    return () => {
      alive = false;
      controller.abort();
      worker?.terminate();
      if (timeout) clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url, file.fileName, dwg, pdf, locale]);
  return (
    <div className="pm-preview-wrap">
      <Modal
        title={
          t("استعراض المرفق", "Attachment preview") + " — " + file.fileName
        }
        close={close}
      >
        {dwg && (
          <p className="pm-preview-note">
            {t(
              "معاينة ثنائية الأبعاد داخل البرنامج. قد تختلف النصوص أو العناصر المتقدمة عن الملف الأصلي.",
              "In-app 2D preview. Text and advanced entities may differ from the original drawing."
            )}
          </p>
        )}
        {!pdf && url && (
          <div className="pm-preview-toolbar">
            <label>
              {t("التكبير", "Zoom")}{" "}
              <input
                aria-label={t("تكبير الرسم", "Drawing zoom")}
                type="range"
                min="1"
                max="6"
                step="0.25"
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
              />
            </label>
            <button onClick={() => setZoom(1)}>
              {t("ملاءمة الشاشة", "Fit to screen")}
            </button>
          </div>
        )}
        {pdf ? (
          <Suspense fallback={<p>…</p>}>
            <PdfPreview url={file.url} locale={locale} />
          </Suspense>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : !url ? (
          <p role="status">
            {t("جاري تجهيز الاستعراض…", "Preparing preview…")}
          </p>
        ) : (
          <div className={"pm-preview-frame" + (dwg ? " pm-cad-frame" : "")}>
            <img
              src={url}
              alt={file.fileName}
              style={{
                width: zoom * 100 + "%",
                maxWidth: "none",
                height: dwg ? zoom * 100 + "%" : undefined,
                objectFit: dwg ? "contain" : undefined,
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
