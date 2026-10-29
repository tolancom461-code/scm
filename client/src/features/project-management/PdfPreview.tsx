import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Locale } from "@/lib/i18n";
GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfPreview({ url, locale }: { url: string; locale: Locale }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [rendering, setRendering] = useState(false),
    canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef<HTMLDivElement>(null),
    t = (ar: string, en: string) => (locale === "ar" ? ar : en);
  useEffect(() => {
    let alive = true;
    const task = getDocument({ url, withCredentials: true });
    void task.promise
      .then(pdf => {
        if (alive) setDoc(pdf);
      })
      .catch(() => {
        if (alive)
          setError(
            locale === "ar"
              ? "تعذر قراءة مستند PDF."
              : "Unable to read the PDF document."
          );
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [url, locale]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let alive = true;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setRendering(true);
    void doc
      .getPage(page)
      .then(async pdfPage => {
        if (!alive || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 }),
          available = Math.max(200, (frame.current?.clientWidth ?? 800) - 32),
          scale = Math.min((available / base.width) * zoom, 5),
          viewport = pdfPage.getViewport({ scale }),
          element = canvas.current;
        const context = element.getContext("2d");
        if (!context) throw Error("Canvas unavailable");
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        context.direction = "ltr";
        context.textAlign = "left";
        render = pdfPage.render({
          canvas: element,
          canvasContext: context,
          viewport,
        });
        await render.promise;
        if (alive) setRendering(false);
      })
      .catch(e => {
        if (alive && e?.name !== "RenderingCancelledException") {
          setError(
            locale === "ar"
              ? "تعذر عرض صفحة PDF."
              : "Unable to display this PDF page."
          );
          setRendering(false);
        }
      });
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [doc, page, zoom, locale]);
  return (
    <section>
      <div className="pm-pdf-tools">
        <button
          disabled={!doc || page <= 1}
          onClick={() => setPage(p => p - 1)}
        >
          {t("السابقة", "Previous")}
        </button>
        <span>
          {t("صفحة", "Page")} {page} / {doc?.numPages ?? "—"}
        </span>
        <button
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage(p => p + 1)}
        >
          {t("التالية", "Next")}
        </button>
        <button
          disabled={zoom <= 1}
          onClick={() => setZoom(z => Math.max(1, z - 0.25))}
        >
          −
        </button>
        <button
          disabled={zoom >= 3}
          onClick={() => setZoom(z => Math.min(3, z + 0.25))}
        >
          +
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          {(!doc || rendering) && (
            <p role="status">{t("جاري عرض الصفحة…", "Rendering page…")}</p>
          )}
          <div ref={frame} className="pm-pdf-frame">
            <canvas
              dir="ltr"
              ref={canvas}
              aria-label={t("صفحة مستند PDF", "PDF document page")}
            />
          </div>
        </>
      )}
    </section>
  );
}
