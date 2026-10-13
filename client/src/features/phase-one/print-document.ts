/** Generate the printable page area directly, independent of printer margins. */
import { systemBrand } from "@/lib/branding";
let printFont: Promise<FontFace> | undefined;
const printLayout = {
  top: 5,
  bottom: 10,
  left: 10,
  width: 190,
  verticalScale: 0.9,
};
export async function printablePdf(source: HTMLElement, title: string) {
  printFont ??= new FontFace(
    "ProcurePrintArabic",
    "url(/fonts/NotoSansArabic.ttf)",
    { weight: "100 900" }
  )
    .load()
    .then(font => {
      document.fonts.add(font);
      return font;
    })
    .catch(error => {
      printFont = undefined;
      throw error;
    });
  await printFont;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const printRules: string[] = [];
  const baseRules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (
          !(rule instanceof CSSImportRule) &&
          !(rule instanceof CSSFontFaceRule)
        )
          baseRules.push(rule.cssText);
        if (
          rule instanceof CSSMediaRule &&
          rule.media.mediaText.includes("print")
        )
          printRules.push(
            Array.from(rule.cssRules)
              .map(r => r.cssText)
              .join("\n")
          );
      }
    } catch {
      /* Cross-origin font sheets are already applied by the browser. */
    }
  }
  const host = document.createElement("div"),
    node = source.cloneNode(true) as HTMLElement;
  host.style.cssText =
    "position:absolute;left:-20000px;top:0;width:190mm;pointer-events:none;";
  node.style.cssText =
    "width:190mm!important;max-width:190mm!important;min-width:0!important;padding:0!important;margin:0!important;background:white;";
  node.dataset.pdfSurface = "true";
  host.append(node);
  document.body.append(host);
  let boundaries: number[] = [];
  let tables: {
    top: number;
    bottom: number;
    headerTop: number;
    headerBottom: number;
  }[] = [];
  let height = 0;
  try {
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      imageTimeout: 3000,
      // Avoid loading external font/style resources again in the cloned frame.
      ignoreElements: element =>
        element.tagName === "LINK" || element.tagName === "STYLE",
      onclone: async doc => {
        const style = doc.createElement("style");
        style.textContent =
          baseRules.join("\n") +
          "\n" +
          printRules.join("\n") +
          "\n@font-face{font-family:ProcurePrintArabic;src:url('/fonts/NotoSansArabic.ttf');font-weight:100 900} [data-pdf-surface],[data-pdf-surface] *{font-family:ProcurePrintArabic,Arial,sans-serif!important}" +
          "\n[data-pdf-surface]{width:190mm!important;padding:0!important;margin:0!important} [data-pdf-surface] .p1-table-wrap{overflow:visible!important} [data-pdf-surface] .p1-no-print,[data-pdf-surface] button,[data-pdf-surface] form{display:none!important}";
        doc.head.append(style);
        await doc.fonts.load("10pt ProcurePrintArabic");
        await doc.fonts.ready;
        const surface = doc.querySelector<HTMLElement>("[data-pdf-surface]")!;
        const box = surface.getBoundingClientRect();
        height = box.height;
        boundaries = Array.from(
          surface.querySelectorAll<HTMLElement>(
            "p,tr,.p1-print-intro,.p1-signatures"
          )
        )
          .filter(e => {
            if (e.closest("thead")) return false;
            if (e.tagName === "P" && e.closest("table")) return false;
            const group = e.closest(".p1-print-intro,.p1-signatures");
            return !group || group === e;
          })
          .map(
            e =>
              e.getBoundingClientRect().bottom -
              box.top +
              (e.tagName === "P"
                ? Math.max(
                    4,
                    parseFloat(
                      doc.defaultView!.getComputedStyle(e).marginBottom
                    ) || 0
                  )
                : 0)
          )
          .filter(y => y > 0);
        tables = Array.from(surface.querySelectorAll("table")).flatMap(
          table => {
            const head = table.querySelector("thead");
            if (!head) return [];
            const t = table.getBoundingClientRect(),
              h = head.getBoundingClientRect();
            return [
              {
                top: t.top - box.top,
                bottom: t.bottom - box.top,
                headerTop: h.top - box.top,
                headerBottom: h.bottom - box.top,
              },
            ];
          }
        );
      },
    });
    const pdf = new jsPDF({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });
    pdf.setProperties({
      title,
      creator: `${systemBrand.en} - ${systemBrand.abbreviation}`,
    });
    const pixelsPerMm = canvas.width / printLayout.width,
      ratio = canvas.height / height;
    const breaks = boundaries
      .map(y => Math.round(y * ratio))
      .sort((a, b) => a - b);
    let start = 0,
      page = 0;
    while (start < canvas.height) {
      if (page++) pdf.addPage();
      const continued = tables.find(
        t => start / ratio > t.headerBottom + 1 && start / ratio < t.bottom - 1
      );
      const repeat = continued
        ? Math.ceil((continued.headerBottom - continued.headerTop) * ratio)
        : 0;
      const capacity =
        Math.floor(
          ((297 - printLayout.top - printLayout.bottom) /
            printLayout.verticalScale) *
            pixelsPerMm
        ) - repeat;
      const limit = Math.min(start + capacity, canvas.height);
      const legal = breaks.filter(y => y > start + 1 && y <= limit);
      let end = limit === canvas.height ? limit : (legal.at(-1) ?? limit);
      // Move a short table intact to the next page rather than leaving one row.
      const shortTable = tables.find(
        t =>
          t.top * ratio > start &&
          t.top * ratio < limit &&
          t.bottom * ratio > limit &&
          (t.bottom - t.top) * ratio <= capacity
      );
      if (shortTable)
        end =
          breaks
            .filter(y => y > start + 1 && y <= shortTable.top * ratio)
            .at(-1) ?? Math.floor(shortTable.top * ratio);
      const fragment = document.createElement("canvas");
      fragment.width = canvas.width;
      fragment.height = end - start + repeat;
      const ctx = fragment.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, fragment.width, fragment.height);
      if (continued)
        ctx.drawImage(
          canvas,
          0,
          Math.round(continued.headerTop * ratio),
          canvas.width,
          repeat,
          0,
          0,
          canvas.width,
          repeat
        );
      ctx.drawImage(
        canvas,
        0,
        start,
        canvas.width,
        end - start,
        0,
        repeat,
        canvas.width,
        end - start
      );
      pdf.addImage(
        fragment.toDataURL("image/png"),
        "PNG",
        printLayout.left,
        printLayout.top,
        printLayout.width,
        (fragment.height / pixelsPerMm) * printLayout.verticalScale,
        undefined,
        "FAST"
      );
      start = end;
    }
    return pdf.output("blob");
  } finally {
    host.remove();
  }
}
