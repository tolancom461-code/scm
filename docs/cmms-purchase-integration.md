# ربط طلبات احتياج PSCM بالمشتريات في CMMS

يتطلب حفظ مسودة المشروع اختيار الموقع والقسم من CMMS. الأصل اختياري. تعرض بنود الاحتياج اختيارات المشروع للقراءة فقط. يتطلب حفظ مسودة الاحتياج مشروعًا مرتبطًا بموقع وقسم، واختيار التصنيف وجهة المراجعة من CMMS لكل بند.

عند اعتماد احتياج لمشروع مرتبط، يحفظ PSCM القيم مع النسخة المعتمدة ويجدولها للإرسال. يبقى الاعتماد محفوظًا عندما يتعذر الاتصال، وتُعاد المحاولة تلقائيًا عند الأعطال المؤقتة. يظهر رقم الشراء `PR-…` في PSCM بعد تأكيد الإنشاء من CMMS. يُستخدم مرجع احتياج واحد في الإرسال وإعادته.

## التفعيل

طبّق ترحيل PSCM رقم `0008_cmms_requisition_integration` إذا كانت قاعدة PSCM المستهدفة تحتاجه. تستخدم واجهة القوائم الأعمدة التي أضافها ذلك الترحيل.

شغّل أمر Node.js التالي في طرفية خاصة لإنشاء رمز قراءة القوائم. احفظ القيمة نفسها في خدمة CMMS باسم `PSCM_REFERENCE_READ_TOKEN` وفي خدمة PSCM باسم `CMMS_REFERENCE_API_TOKEN`.

```sh
node -e "console.log('cmms_ref_' + require('node:crypto').randomBytes(32).toString('base64url'))"
```

اضبط عنوان واجهة القوائم على نطاق CMMS المستهدف، وانشر خدمة CMMS أولًا ثم PSCM.

```dotenv
CMMS_REFERENCE_API_URL=https://cmms.example.com/api/v1/pscm/references
CMMS_REFERENCE_API_TOKEN=<reference-read-token>
```

تُضبط متغيرات الإرسال أدناه عند تجهيز واجهة استقبال طلبات الشراء في CMMS. استخدم رمز إنشاء شراء مستقلًا عن رمز قراءة القوائم.

```dotenv
CMMS_PURCHASE_API_URL=https://cmms.example.com/api/v1/pscm/purchase-requests
CMMS_PURCHASE_API_TOKEN=<purchase-write-token>
CMMS_PURCHASE_SOURCE_ID=pscm-production
```

يحدد `CMMS_PURCHASE_SOURCE_ID` نسخة PSCM في مفتاح منع التكرار. يحفظ كل احتياج معرّف المصدر عند أول محاولة ويستخدمه عند الإعادة. استخدم قيمة مختلفة لكل نسخة PSCM ترسل إلى نفس CMMS. القيمة الافتراضية هي `pscm`. استخدم نفس بيئة CMMS في إعداد الكتالوج والقوائم والشراء، حتى تشير المعرّفات إلى السجلات نفسها.

يستطيع المستخدم استكمال الموقع والقسم للمشروع السابق إذا كانت حالة المشروع تسمح بالتعديل. تتطلب مسودات الاحتياج السابقة استكمال التصنيف وجهة المراجعة عند إعادة الحفظ.

## عقد واجهة القوائم

ترسل جميع الطلبات عبر `GET` مع ترويسة `Authorization: Bearer <token>`. يحدد الاستعلام `type`، و`locale` بقيمة `ar` أو `en` أو `ur`.

| النوع | معلمات إضافية | الاستجابة |
| --- | --- | --- |
| `sites` | — | مصفوفة `[{id, name}]` |
| `sections` | `siteId` | مصفوفة الأقسام التابعة للموقع بصيغة `[{id, name}]` |
| `assets` | `siteId` و`sectionId` | مصفوفة الأصول المطابقة بصيغة `[{id, name}]` |
| `purchaseOptions` | — | `{categories: [{id, name}], reviewRoles: [{code, name}]}` |
| `projectLocation` | `siteId` و`sectionId` و`assetId` الاختياري | `{site, section, asset}` بقيم `{id, name}`، ويكون `asset` فارغًا عند تركه. تُرجع الواجهة `null` إذا لم يتطابق الاختيار. |

تستخدم المعرفات الرقمية معرّفات CMMS. تمثل التصنيفات تصنيفات طلبات الشراء، وتمثل رموز جهات المراجعة القيم التي يقبلها CMMS في بند طلب الشراء.

عند إنشاء المشروع أو تغيير موقعه، يتحقق PSCM من الموقع والقسم والأصل المختار باستدعاء `projectLocation` مرة واحدة. عند تعذّر القراءة تظهر في رسالة الخطأ إشارة إلى نوع الطلب وحالة HTTP أو سبب فشل الاتصال.

## عقد إنشاء طلب الشراء

يرسل PSCM طلب `POST` عبر HTTPS مع رمز الشراء، وترويسة `Idempotency-Key` التي تطابق `idempotencyKey` في البيانات. يحفظ CMMS نتيجة الإنشاء بهذا المفتاح ويعيد نفس رقم الطلب عند إعادة الإرسال. يصدر CMMS الرقم من تسلسل طلبات الشراء الحالي ويحفظ مصدر الاحتياج.

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "pscm-production:MR-26-11-0008",
  "source": {
    "system": "PSCM",
    "instanceId": "pscm-production",
    "requisitionId": 8,
    "requisitionNumber": "MR-26-11-0008",
    "approvedAt": "2026-11-15T08:30:00.000Z",
    "project": {"id": 12, "number": "PRJ-26-11-0001", "name": "المشروع"},
    "task": {"id": 9, "name": "المهمة"}
  },
  "items": [{
    "sequence": 1,
    "catalogItemId": "204",
    "catalogCode": "000204",
    "itemName": "مادة",
    "quantity": "5.000000000",
    "unit": {"code": "CMMS_UNIT_7", "nameAr": "لتر", "nameEn": "Litre", "nameUr": "لیٹر"},
    "specifications": "",
    "notes": "",
    "needDate": "2026-11-20",
    "siteId": 32,
    "sectionId": 41,
    "assetId": null,
    "categoryId": 39,
    "reviewRole": "construction_procurement_manager"
  }]
}
```

يرجع CMMS عند النجاح بيانات مثل `{"purchaseRequestId":45,"purchaseRequestNumber":"PR-2026-12450"}`. يستخدم PSCM المعرّف لإنشاء رابط التفاصيل على نفس عنوان CMMS. يمكن أن تكون `task` أو `assetId` فارغة. يبقى `catalogItemId` فارغًا للبند المدخل يدويًا. يعيد PSCM المحاولة مع الأعطال المؤقتة، ويعرض فشل الإرسال عند رفض البيانات.

الكمية تُرسل كما حُفظت كنص عشري دقيق. حقل الكمية الحالي في CMMS عدد صحيح، لذلك تحتاج مرحلة الاستقبال إلى قرار صريح للكسور قبل تفعيل هذا المسار على بيانات فعلية.
