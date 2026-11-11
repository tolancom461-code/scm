import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../client/public/gantt-studio/index.html", import.meta.url);
let html = await readFile(file, "utf8");

const replacements = new Map([
  ["محفوظ على هذا الجهاز", "محفوظ في قاعدة PSCM"],
  ["Saved on this device", "Saved in PSCM database"],
  ["بيئة تجريبية آمنة", "بيئة تخطيط المشاريع"],
  [
    "جميع الأسماء والمواعيد افتراضية. لا يوجد إرسال أو حفظ سحابي.",
    "تُحفظ بيانات المشروع في قاعدة PSCM وفق صلاحيات المستخدم.",
  ],
  ["نسخة محلية للمراجعة والتجربة", "وحدة التخطيط الزمني في PSCM"],
  ["بدون اتصال خارجي", "مرتبطة بقاعدة PSCM"],
]);

for (const [from, to] of replacements) {
  html = html.replaceAll(from, to);
}

await writeFile(file, html, "utf8");
