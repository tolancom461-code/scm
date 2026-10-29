import type { Locale } from "@/lib/i18n";
const labels = {
  attachments: ["المرفقات", "Attachments", "منسلک دستاویزات"],
  fileTooLarge: [
    "الحد الأقصى للملف 6 ميغابايت",
    "Maximum file size is 6 MB",
    "فائل کی زیادہ سے زیادہ حد 6 MB ہے",
  ],
  title: ["العنوان", "Title", "عنوان"],
  error: ["تعذر تحميل البيانات", "Could not load data", "ڈیٹا لوڈ نہیں ہوا"],
  save: ["حفظ", "Save", "محفوظ کریں"],
} as const;
export function documentText(locale: Locale, key: keyof typeof labels) {
  return labels[key][locale === "ar" ? 0 : locale === "en" ? 1 : 2];
}
