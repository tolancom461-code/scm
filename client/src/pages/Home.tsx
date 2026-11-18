import { lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { useLocale } from "@/features/auth/useLocale";
const PhaseOneWorkspace = lazy(() =>
  import("@/features/phase-one/Workspace").then(m => ({
    default: m.PhaseOneWorkspace,
  }))
);

export default function Home() {
  const me = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: query => (query.state.data ? 30000 : false),
  });
  const setup = trpc.auth.firstRunStatus.useQuery(undefined, {
    enabled: me.data === null,
    retry: false,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const [locale, setLocale] = useLocale(me.data?.locale, me.data?.id);
  const opening = (
    <div className="boot-screen" role="status">
      {locale === "ar"
        ? "جاري فتح البرنامج…"
        : locale === "en"
          ? "Opening workspace…"
          : "پروگرام کھل رہا ہے…"}
    </div>
  );
  if (me.data === undefined && me.isError)
    return (
      <div className="boot-screen" role="alert">
        <p>
          {locale === "ar"
            ? "تعذّر الاتصال بالخادم."
            : locale === "en"
              ? "Could not reach the server."
              : "سرور سے رابطہ نہیں ہو سکا۔"}
        </p>
        <button
          type="button"
          className="neo-button"
          onClick={() => void me.refetch()}
        >
          {locale === "ar"
            ? "إعادة المحاولة"
            : locale === "en"
              ? "Retry"
              : "دوبارہ کوشش"}
        </button>
      </div>
    );
  if (me.data === undefined || (me.data === null && setup.isPending))
    return opening;
  if (me.data === null)
    return (
      <AuthScreen
        locale={locale}
        setLocale={setLocale}
        setup={Boolean(setup.data?.needsSetup)}
        checkError={setup.isError}
        retryChecks={() => {
          void me.refetch();
          void setup.refetch();
        }}
      />
    );
  return (
    <Suspense fallback={opening}>
      <PhaseOneWorkspace
        key={me.data.id}
        user={me.data}
        locale={locale}
        setLocale={setLocale}
      />
    </Suspense>
  );
}
