import type { Locale } from "@/lib/i18n";
const labels = {
  active: ["نشط", "Active", "فعال"],
  inactive: ["معطل", "Inactive", "غیر فعال"],
  title: [
    "مركز السياسات والصلاحيات",
    "Policy & access center",
    "پالیسی اور رسائی کا مرکز",
  ],
  hint: [
    "حدد دور المستخدم والمشاريع التي يعمل عليها. تطبق الصلاحيات على الخادم في كل طلب.",
    "Choose each user's role and project scope. Access is checked by the server on every request.",
    "صارف کا کردار اور منصوبوں کا دائرہ منتخب کریں۔ ہر درخواست پر سرور اجازت چیک کرتا ہے۔",
  ],
  user: ["المستخدم", "User", "صارف"],
  role: ["الدور", "Role", "کردار"],
  scope: ["نطاق المشاريع", "Project scope", "منصوبوں کا دائرہ"],
  edit: ["إعداد الصلاحيات", "Configure access", "رسائی مقرر کریں"],
  close: ["إغلاق", "Close", "بند کریں"],
  save: ["حفظ السياسة", "Save policy", "پالیسی محفوظ کریں"],
  all: [
    "جميع المشاريع الحالية والمستقبلية",
    "All current and future projects",
    "تمام موجودہ اور آئندہ منصوبے",
  ],
  assigned: [
    "المشاريع المحددة فقط",
    "Selected projects only",
    "صرف منتخب منصوبے",
  ],
  projects: [
    "اختر المشاريع المسموح بها",
    "Choose allowed projects",
    "مجاز منصوبے منتخب کریں",
  ],
  legacy: [
    "السماح بالدورة السابقة — يتطلب نطاق جميع المشاريع",
    "Allow previous workflow — requires all-project scope",
    "پچھلا طریقہ کار — تمام منصوبوں کا دائرہ لازم ہے",
  ],
  permissions: ["الصلاحيات الفعلية", "Effective permissions", "اصل اجازتیں"],
  extra: [
    "القالب نقطة بداية. أضف أو اسحب صلاحيات لهذا المستخدم فقط. إضافة إجراء تضيف متطلباته، وسحب متطلب يسحب الإجراءات التابعة له. تغيير الدور يعيد تحميل قالب الدور المختار.",
    "The template is a starting point. Add or remove permissions for this user only. Actions include their prerequisites; removing a prerequisite removes dependent actions. Changing the role reloads its template.",
    "قالب ابتدائی نقطہ ہے۔ صرف اس صارف کی اجازتیں شامل یا ختم کریں۔ عمل کی ضروری اجازتیں شامل ہوتی ہیں؛ ضرورت ختم کرنے سے متعلقہ عمل بھی ختم ہوتا ہے۔ کردار بدلنے سے اس کا قالب دوبارہ لوڈ ہوتا ہے۔",
  ],
  owner: [
    "مدير النظام — كامل الصلاحيات",
    "System administrator — full access",
    "نظام منتظم — مکمل رسائی",
  ],
  ownerHint: [
    "هذا الحساب مدير نظام كامل الصلاحيات. لإيقاف وصوله استخدم تعطيل المستخدم من صفحة المستخدمين.",
    "This administrator has full access. Use Deactivate user in Users to stop access.",
    "اس منتظم کو مکمل رسائی ہے۔ رسائی روکنے کے لیے صارف غیر فعال کریں۔",
  ],
  none: [
    "لا توجد مشاريع محددة؛ لن تظهر له مشاريع قائمة. إذا مُنح إضافة مشروع، يُضاف المشروع الذي ينشئه إلى نطاقه.",
    "No projects selected: existing projects are hidden. If allowed to create a project, the new project is added to their scope.",
    "کوئی منصوبہ منتخب نہیں؛ موجودہ منصوبے نہیں دکھیں گے۔ اجازت ہونے پر بنایا ہوا منصوبہ اس کے دائرے میں شامل ہوگا۔",
  ],
  saved: [
    "حُفظت السياسة. تسري على الطلبات التالية مباشرة.",
    "Policy saved. It applies to subsequent requests immediately.",
    "پالیسی محفوظ ہوئی۔ اگلی درخواستوں پر فوراً لاگو ہوگی۔",
  ],
  error: [
    "تعذر تحميل المركز أو حفظ التغيير.",
    "Could not load the center or save changes.",
    "مرکز لوڈ یا تبدیلی محفوظ نہیں ہوئی۔",
  ],
  noUsers: ["لا يوجد مستخدمون.", "No users.", "کوئی صارف نہیں۔"],
  audit: [
    "آخر محاولات الوصول المرفوضة",
    "Recent denied access attempts",
    "حالیہ مسترد رسائی کی کوششیں",
  ],
  path: ["الإجراء", "Action", "عمل"],
  reason: ["سبب المنع", "Denial reason", "انکار کی وجہ"],
  date: ["الوقت", "Time", "وقت"],
  noDenials: [
    "لا توجد محاولات مرفوضة مسجلة.",
    "No denied attempts recorded.",
    "کوئی مسترد کوشش درج نہیں۔",
  ],
  shared: [
    "بيانات مشتركة وإدارة المستخدمين",
    "Shared data & user administration",
    "مشترکہ ڈیٹا اور صارف انتظام",
  ],
  current: [
    "المشاريع والعقود والمستخلصات والصرف",
    "Projects, contracts, certificates & payments",
    "منصوبے، معاہدے، مستخلص اور ادائیگی",
  ],
  previous: [
    "صلاحيات الدورة السابقة",
    "Previous workflow permissions",
    "پچھلے طریقے کی اجازتیں",
  ],
  ownerAccount: ["حساب مدير نظام", "Administrator account", "منتظم اکاؤنٹ"],
  scopeWarning: [
    "صلاحية تسجيل الصرف مستقلة عن اعتماد المستخلص والإفراج عن الضمان. لا يستطيع المُعد اعتماد مستخلصه.",
    "Recording payment is separate from approving a certificate and releasing retention. A creator cannot approve their own certificate.",
    "ادائیگی درج کرنا، مستخلص منظور کرنا اور ضمانت جاری کرنا الگ اجازتیں ہیں۔ بنانے والا اپنا مستخلص منظور نہیں کر سکتا۔",
  ],
  permissionDenied: [
    "الصلاحية غير متاحة",
    "Permission unavailable",
    "اجازت دستیاب نہیں",
  ],
  projectDenied: [
    "المشروع خارج النطاق",
    "Project outside scope",
    "منصوبہ دائرے سے باہر",
  ],
  legacyDenied: [
    "الدورة السابقة خارج النطاق",
    "Previous workflow outside scope",
    "پچھلا طریقہ دائرے سے باہر",
  ],
  selfDenied: [
    "منع اعتماد عمل أنشأه المستخدم",
    "Creator cannot approve own work",
    "بنانے والا اپنا کام منظور نہیں کر سکتا",
  ],
  targetDenied: [
    "المرفق خارج صلاحيات المستخدم",
    "Attachment outside access scope",
    "دستاویز رسائی کے دائرے سے باہر",
  ],
  grantDenied: [
    "تجاوز سلطة منح الصلاحيات",
    "Permission delegation exceeds authority",
    "اجازت دینے کے اختیار سے تجاوز",
  ],
  businessDenied: [
    "شروط العملية غير متحققة",
    "Business rule not satisfied",
    "عمل کی شرائط پوری نہیں",
  ],
  unknownDenied: [
    "إجراء بلا سياسة مسجلة",
    "Action has no registered policy",
    "عمل کی پالیسی درج نہیں",
  ],
};
export type PolicyLabel = keyof typeof labels;
export function policyText(locale: Locale, key: PolicyLabel) {
  return labels[key][locale === "en" ? 1 : locale === "ur" ? 2 : 0];
}
