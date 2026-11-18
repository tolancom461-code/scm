import { useRef, useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { businessDate } from "@shared/date";
import { holidayCalendarSettingsInput } from "@shared/work-calendar";
import type { AppRouter } from "../../../../server/routers";
import type { Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import "./holiday-calendar.css";

type Calendar =
  inferRouterOutputs<AppRouter>["projectManagement"]["holidayCalendar"];
type Holiday = Calendar["holidays"][number];
type HolidayRow = Holiday & { rowKey: string };
type Draft = {
  version: number;
  weeklyDaysOff: number[];
  holidays: HolidayRow[];
};

const weekdays = {
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  ur: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
};

const text = (locale: Locale) => (ar: string, en: string, ur: string) =>
  locale === "ar" ? ar : locale === "en" ? en : ur;

function settingsFrom(draft: Draft) {
  return {
    weeklyDaysOff: draft.weeklyDaysOff,
    holidays: draft.holidays.map(({ name, startDate, endDate }) => ({
      name,
      startDate,
      endDate,
    })),
  };
}

export function HolidayCalendar({ locale }: { locale: Locale }) {
  const t = text(locale);
  const calendar = trpc.projectManagement.holidayCalendar.useQuery();

  if (calendar.isPending)
    return (
      <p role="status">
        {t(
          "جارٍ تحميل تقويم الإجازات…",
          "Loading the holiday calendar…",
          "تعطیلات کا کیلنڈر لوڈ ہو رہا ہے…"
        )}
      </p>
    );

  if (!calendar.data)
    return (
      <div className="pm-holidays-error" role="alert">
        <p>
          {t(
            "تعذّر تحميل تقويم الإجازات.",
            "Could not load the holiday calendar.",
            "تعطیلات کا کیلنڈر لوڈ نہیں ہو سکا۔"
          )}
        </p>
        <button type="button" onClick={() => void calendar.refetch()}>
          {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
        </button>
      </div>
    );

  return <HolidayCalendarForm calendar={calendar.data} locale={locale} />;
}

function HolidayCalendarForm({
  calendar,
  locale,
}: {
  calendar: Calendar;
  locale: Locale;
}) {
  const t = text(locale);
  const utils = trpc.useUtils();
  const [edited, setEdited] = useState<Draft | null>(null);
  const [validationError, setValidationError] = useState("");
  const [saved, setSaved] = useState(false);
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const original: Draft = {
    version: calendar.version,
    weeklyDaysOff: calendar.weeklyDaysOff,
    holidays: calendar.holidays.map((item, index) => ({
      ...item,
      rowKey: `saved-${calendar.version}-${index}`,
    })),
  };
  const draft = edited ?? original;
  const stale = edited !== null && edited.version !== calendar.version;
  const save = trpc.projectManagement.saveHolidayCalendar.useMutation({
    onSuccess: async data => {
      utils.projectManagement.holidayCalendar.setData(undefined, current =>
        !current || current.version <= data.version ? data : current
      );
      setEdited(null);
      setSaved(true);
      operation.current = null;
      await Promise.all([
        utils.projectManagement.holidayCalendar.invalidate(),
        utils.projectManagement.detail.invalidate(),
        utils.gantt.invalidate(),
      ]);
    },
    onError: error => {
      if (error.data?.code === "CONFLICT")
        void utils.projectManagement.holidayCalendar.invalidate();
    },
  });
  const editable = calendar.canEdit && !save.isPending;

  const update = (change: (current: Draft) => Draft) => {
    setValidationError("");
    setSaved(false);
    save.reset();
    setEdited(current => {
      const next = change(current ?? original);
      return JSON.stringify(settingsFrom(next)) ===
        JSON.stringify(settingsFrom(original))
        ? null
        : next;
    });
  };
  const setHoliday = (rowKey: string, patch: Partial<Holiday>) =>
    update(current => ({
      ...current,
      holidays: current.holidays.map(holiday =>
        holiday.rowKey === rowKey ? { ...holiday, ...patch } : holiday
      ),
    }));

  function addHoliday() {
    const today = businessDate();
    const row = {
      rowKey: crypto.randomUUID(),
      name: "",
      startDate: today,
      endDate: today,
    };
    update(current => ({ ...current, holidays: [...current.holidays, row] }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || stale || (!edited && calendar.configured)) return;
    const values = holidayCalendarSettingsInput.safeParse(settingsFrom(draft));
    if (!values.success) {
      const issue = values.error.issues[0];
      setValidationError(
        issue?.path[0] === "weeklyDaysOff"
          ? t(
              "اترك يوم عمل واحدًا على الأقل كل أسبوع.",
              "Keep at least one working day each week.",
              "ہر ہفتے کم از کم ایک کام کا دن رکھیں۔"
            )
          : t(
              "راجع أسماء الإجازات وتواريخها ومددها.",
              "Check holiday names, dates and lengths.",
              "تعطیلات کے نام، تاریخیں اور مدت چیک کریں۔"
            )
      );
      return;
    }
    const payload = { ...values.data, version: draft.version };
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    const key = operation.current.key;
    setValidationError("");
    save.mutate({ ...payload, key });
  }

  return (
    <form
      className="pm-holidays"
      onSubmit={submit}
      aria-busy={save.isPending}
      aria-labelledby="pm-holidays-title"
    >
      <header>
        <h2 id="pm-holidays-title">{t("الإجازات", "Holidays", "تعطیلات")}</h2>
        <p className="pm-help">
          {t(
            "تقويم عمل موحّد للمشاريع الحالية والجديدة في PSCM.",
            "One work calendar for existing and new projects in PSCM.",
            "PSCM میں موجودہ اور نئے منصوبوں کے لیے ایک کام کا کیلنڈر۔"
          )}
        </p>
      </header>
      <fieldset className="pm-holidays-panel" disabled={!editable}>
        <legend>
          {t("الإجازات الأسبوعية", "Weekly days off", "ہفتہ وار چھٹیاں")}
        </legend>
        <p className="pm-help">
          {t(
            "حدّد أيام الإجازة التي تتكرر كل أسبوع.",
            "Select the recurring days off each week.",
            "ہر ہفتے دہرائی جانے والی چھٹیوں کے دن منتخب کریں۔"
          )}
        </p>
        <div className="pm-holidays-weekdays">
          {weekdays[locale].map((name, index) => (
            <label className="pm-holidays-day" key={index}>
              <input
                type="checkbox"
                checked={draft.weeklyDaysOff.includes(index)}
                onChange={() =>
                  update(current => ({
                    ...current,
                    weeklyDaysOff: current.weeklyDaysOff.includes(index)
                      ? current.weeklyDaysOff.filter(day => day !== index)
                      : [...current.weeklyDaysOff, index].sort((a, b) => a - b),
                  }))
                }
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="pm-holidays-panel" disabled={!editable}>
        <legend>
          {t(
            "الإجازات السنوية والمناسبات",
            "Annual holidays and occasions",
            "سالانہ چھٹیاں اور تقریبات"
          )}
        </legend>
        <div className="pm-holidays-ranges">
          {draft.holidays.length === 0 && (
            <p className="pm-help">
              {t(
                "لا توجد إجازات سنوية مسجّلة.",
                "No annual holidays are recorded.",
                "کوئی سالانہ تعطیل درج نہیں ہے۔"
              )}
            </p>
          )}
          {draft.holidays.map(holiday => (
            <div className="pm-holidays-range" key={holiday.rowKey}>
              <label className="pm-field pm-holidays-name">
                <span>{t("اسم الإجازة", "Holiday name", "تعطیل کا نام")}</span>
                <input
                  type="text"
                  value={holiday.name}
                  onChange={event =>
                    setHoliday(holiday.rowKey, { name: event.target.value })
                  }
                  required
                />
              </label>
              <label className="pm-field">
                <span>{t("من تاريخ", "Start date", "شروع ہونے کی تاریخ")}</span>
                <input
                  type="date"
                  value={holiday.startDate}
                  onChange={event => {
                    const startDate = event.target.value;
                    setHoliday(holiday.rowKey, {
                      startDate,
                      ...(startDate && holiday.startDate === holiday.endDate
                        ? { endDate: startDate }
                        : {}),
                    });
                  }}
                  required
                />
              </label>
              <label className="pm-field">
                <span>{t("إلى تاريخ", "End date", "اختتامی تاریخ")}</span>
                <input
                  type="date"
                  value={holiday.endDate}
                  min={holiday.startDate}
                  onChange={event =>
                    setHoliday(holiday.rowKey, { endDate: event.target.value })
                  }
                  required
                />
              </label>
              {calendar.canEdit && (
                <button
                  type="button"
                  className="pm-holidays-remove"
                  onClick={() =>
                    update(current => ({
                      ...current,
                      holidays: current.holidays.filter(
                        item => item.rowKey !== holiday.rowKey
                      ),
                    }))
                  }
                >
                  {t("حذف", "Remove", "ہٹائیں")}
                </button>
              )}
            </div>
          ))}
        </div>
        {calendar.canEdit && (
          <button
            className="pm-holidays-add"
            type="button"
            onClick={addHoliday}
          >
            {t("+ إضافة إجازة", "+ Add holiday", "+ تعطیل شامل کریں")}
          </button>
        )}
      </fieldset>
      {calendar.canEdit ? (
        <footer className="pm-holidays-footer">
          <button
            type="submit"
            className="primary"
            disabled={!editable || stale || (!edited && calendar.configured)}
          >
            {save.isPending
              ? t("جارٍ الحفظ…", "Saving…", "محفوظ ہو رہا ہے…")
              : t("حفظ الإجازات", "Save holidays", "تعطیلات محفوظ کریں")}
          </button>
          {edited && !save.isPending && (
            <button
              type="button"
              onClick={() => {
                setEdited(null);
                setValidationError("");
                save.reset();
              }}
            >
              {t(
                "العودة إلى المحفوظ",
                "Restore saved settings",
                "محفوظ ترتیبات بحال کریں"
              )}
            </button>
          )}
          <span className="pm-help" role="status">
            {edited
              ? t("تغييرات غير محفوظة", "Unsaved changes", "غیر محفوظ تبدیلیاں")
              : saved
                ? t(
                    "تم حفظ الإجازات",
                    "Holidays saved",
                    "تعطیلات محفوظ ہو گئیں"
                  )
                : !calendar.configured
                  ? t(
                      "احفظ الإعدادات لتطبيقها على جميع المشاريع.",
                      "Save these settings to apply them to all projects.",
                      "تمام منصوبوں پر لاگو کرنے کے لیے ترتیبات محفوظ کریں۔"
                    )
                  : ""}
          </span>
        </footer>
      ) : (
        <p className="pm-help">
          {t(
            "يمكنك عرض التقويم. يتطلب تعديله صلاحية إدارة التقويم.",
            "You can view the calendar. Editing requires calendar management access.",
            "آپ کیلنڈر دیکھ سکتے ہیں۔ ترمیم کے لیے انتظامی اختیار درکار ہے۔"
          )}
        </p>
      )}
      {stale && !save.isPending ? (
        <p className="pm-holidays-error" role="alert">
          {t(
            "تغيّر التقويم أثناء التحرير. ارجع إلى المحفوظ قبل التعديل.",
            "The calendar changed while you were editing. Restore the saved settings before editing.",
            "ترمیم کے دوران کیلنڈر بدل گیا۔ پہلے محفوظ ترتیبات بحال کریں۔"
          )}
        </p>
      ) : validationError || save.error ? (
        <p className="pm-holidays-error" role="alert">
          {validationError || save.error?.message}
        </p>
      ) : null}
    </form>
  );
}
