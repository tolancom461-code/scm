import type { Locale } from "@/lib/i18n";
const labels = {
  fullAccess: [
    "مدير النظام — كامل الصلاحيات",
    "System administrator — full access",
    "سسٹم منتظم — مکمل رسائی",
  ],
  configurePolicy: [
    "تحديد الدور والمشاريع",
    "Assign role & projects",
    "کردار اور منصوبے مقرر کریں",
  ],
  policyHint: [
    "اختر الدور ثم خصص صلاحيات المستخدم ومشاريعه. تُحفظ البيانات والصلاحيات معًا. الدور وحده لا يمنح الوصول إلى مشاريع غير محددة.",
    "Choose a role, then customize this user's permissions and projects. Details and access are saved together. A role alone does not grant access to unassigned projects.",
    "کردار منتخب کریں پھر صارف کی اجازتیں اور منصوبے مقرر کریں۔ معلومات اور اجازتیں ساتھ محفوظ ہوتی ہیں۔ کردار غیر منتخب منصوبوں کی رسائی نہیں دیتا۔",
  ],
  edit: ["تعديل البيانات", "Edit details", "معلومات تبدیل کریں"],
  password: ["تغيير كلمة المرور", "Change password", "پاس ورڈ تبدیل کریں"],
  deactivate: ["تعطيل المستخدم", "Deactivate user", "صارف غیر فعال کریں"],
  activate: ["تفعيل المستخدم", "Activate user", "صارف فعال کریں"],
  actions: ["الإجراءات", "Actions", "کارروائیاں"],
  active: ["نشط", "Active", "فعال"],
  inactive: ["معطل", "Inactive", "غیر فعال"],
  newPassword: ["كلمة المرور الجديدة", "New password", "نیا پاس ورڈ"],
  confirmation: ["تأكيد كلمة المرور", "Confirm password", "پاس ورڈ کی تصدیق"],
  passwordHint: [
    "12 حرفًا على الأقل. ستنتهي الجلسات السابقة لهذا الحساب بعد الحفظ.",
    "At least 12 characters. Existing sessions for this account end when saved.",
    "کم از کم 12 حروف۔ محفوظ کرنے پر اس اکاؤنٹ کے سابقہ سیشن ختم ہوں گے۔",
  ],
  selfPasswordHint: [
    "بعد تغيير كلمة مرورك، سجّل الدخول مجددًا بالكلمة الجديدة.",
    "After changing your password, sign in again with the new password.",
    "پاس ورڈ تبدیل کرنے کے بعد نئے پاس ورڈ سے دوبارہ سائن ان کریں۔",
  ],
  mismatch: [
    "كلمة المرور وتأكيدها غير متطابقين.",
    "The passwords do not match.",
    "پاس ورڈ اور تصدیق مماثل نہیں ہیں۔",
  ],
  saved: [
    "تم تحديث بيانات المستخدم.",
    "User details updated.",
    "صارف کی معلومات تبدیل ہو گئیں۔",
  ],
  passwordSaved: [
    "تم تغيير كلمة المرور.",
    "Password changed.",
    "پاس ورڈ تبدیل ہو گیا۔",
  ],
  deactivated: [
    "تم تعطيل المستخدم وإنهاء جلساته.",
    "User deactivated and sessions ended.",
    "صارف غیر فعال ہو گیا اور سیشن ختم ہوئے۔",
  ],
  activated: [
    "تم تفعيل المستخدم. يمكنه تسجيل الدخول مجددًا.",
    "User activated. They can sign in again.",
    "صارف فعال ہو گیا۔ اب دوبارہ سائن ان کر سکتا ہے۔",
  ],
  deactivateHint: [
    "سيُمنع هذا المستخدم من الدخول، وتُنهي العملية جلساته الحالية. تبقى سجلاته محفوظة.",
    "This user will be unable to sign in and existing sessions will end. Their records are retained.",
    "صارف سائن ان نہیں کر سکے گا اور موجودہ سیشن ختم ہوں گے۔ ریکارڈ محفوظ رہیں گے۔",
  ],
  activateHint: [
    "سيُسمح لهذا المستخدم بتسجيل الدخول بكلمة مروره الحالية.",
    "This user can sign in with their current password.",
    "صارف اپنے موجودہ پاس ورڈ سے سائن ان کر سکے گا۔",
  ],
  selfDisable: [
    "لا يمكنك تعطيل حسابك الحالي.",
    "You cannot deactivate your current account.",
    "آپ اپنا موجودہ اکاؤنٹ غیر فعال نہیں کر سکتے۔",
  ],
  error: [
    "تعذر تحميل المستخدمين.",
    "Unable to load users.",
    "صارفین لوڈ نہیں ہو سکے۔",
  ],
  retry: ["إعادة المحاولة", "Retry", "دوبارہ کوشش"],
} as const;
export function userText(locale: Locale, key: keyof typeof labels) {
  return labels[key][locale === "en" ? 1 : locale === "ur" ? 2 : 0];
}
