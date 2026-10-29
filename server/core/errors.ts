export const domainMessages = {
  INSPECTION_REQUIRED: {
    ar: "اختر كميات من فحص أعمال مقبول قبل إعداد المستخلص.",
    en: "Select quantities from an accepted work inspection before creating a certificate.",
    ur: "مستخلص بنانے سے پہلے منظور شدہ معائنہ منتخب کریں۔",
  },
  INSPECTION_LOCKED: {
    ar: "هذا الفحص مرتبط بمستخلص أو إعادة فحص؛ لا يمكن تعديل بياناته.",
    en: "This inspection is linked to a certificate and cannot be edited.",
    ur: "مستخلص سے منسلک معائنہ تبدیل نہیں ہو سکتا۔",
  },
  RETENTION_NOT_DUE: {
    ar: "لا يمكن الإفراج عن الضمان قبل تسجيل التسليم النهائي وانتهاء مدة الضمان.",
    en: "Record final handover and wait for the warranty period to expire before releasing retention.",
    ur: "ضمانت جاری کرنے سے پہلے آخری حوالگی اور ضمانت کی مدت مکمل کریں۔",
  },
  USERNAME_TAKEN: {
    ar: "اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.",
    en: "This username is already in use. Choose another.",
    ur: "یہ صارف نام پہلے سے استعمال میں ہے۔ دوسرا نام منتخب کریں۔",
  },
  SELF_DEACTIVATION: {
    ar: "لا يمكنك تعطيل حسابك الحالي.",
    en: "You cannot deactivate your current account.",
    ur: "آپ اپنا موجودہ اکاؤنٹ غیر فعال نہیں کر سکتے۔",
  },
  USER_ADMIN_REQUIRED: {
    ar: "لا يمكنك إدارة هذا الحساب بهذه الصلاحيات.",
    en: "You are not authorized to manage this account.",
    ur: "آپ کو اس اکاؤنٹ کا انتظام کرنے کی اجازت نہیں۔",
  },
  PAYMENT_EXCEEDED: {
    ar: "الدفعة تتجاوز الاستحقاق أو المرحلة أو رصيد المقدّم غير المخصص.",
    en: "Payment exceeds the payable, milestone or unallocated advance balance.",
    ur: "ادائیگی واجب رقم، مرحلے یا دستیاب پیشگی رقم سے زیادہ ہے۔",
  },
  QUANTITY_EXCEEDED: {
    ar: "الكمية تتجاوز المتبقي في البند المصدر.",
    en: "Quantity exceeds the remaining source line quantity.",
    ur: "مقدار اصل شاخ میں باقی مقدار سے زیادہ ہے۔",
  },
  SERVICE_UNAVAILABLE: {
    ar: "الخدمة غير متاحة حاليًا. حاول لاحقًا.",
    en: "Service is temporarily unavailable. Try again later.",
    ur: "سروس عارضی طور پر دستیاب نہیں۔ بعد میں کوشش کریں۔",
  },
  NOT_FOUND: {
    ar: "السجل المطلوب غير موجود.",
    en: "The requested record was not found.",
    ur: "مطلوبہ ریکارڈ نہیں ملا۔",
  },
  CONFLICT: {
    ar: "تغيّر السجل أو استُخدم هذا الرمز مسبقًا. حدّث البيانات.",
    en: "The record changed or the code is already in use. Refresh the data.",
    ur: "ریکارڈ تبدیل ہو گیا یا یہ کوڈ پہلے سے استعمال میں ہے۔",
  },
  INVALID_REFERENCE: {
    ar: "المرجع غير موجود أو غير نشط أو لا يتبع الموقع المحدد.",
    en: "A reference is missing, inactive or belongs to another location.",
    ur: "حوالہ موجود نہیں، غیر فعال ہے یا دوسرے مقام سے متعلق ہے۔",
  },
  INVALID_INPUT: {
    ar: "تحقق من الحقول والقيم المدخلة.",
    en: "Check the supplied fields and values.",
    ur: "درج کردہ معلومات کی جانچ کریں۔",
  },
  DUTY_CONFLICT: {
    ar: "لا يمكنك اعتماد المعاملة التي أنشأتها.",
    en: "You cannot approve your own transaction.",
    ur: "آپ اپنی بنائی ہوئی کارروائی منظور نہیں کر سکتے۔",
  },
  INVALID_TRANSITION: {
    ar: "هذا الإجراء غير مسموح في الحالة الحالية.",
    en: "This action is not permitted in the current status.",
    ur: "موجودہ حالت میں یہ کارروائی ممکن نہیں۔",
  },
} as const;
export type DomainCode = keyof typeof domainMessages;
export class DomainError extends Error {
  constructor(public readonly domainCode: DomainCode) {
    super(domainCode);
    this.name = "DomainError";
  }
}
