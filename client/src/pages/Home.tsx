import { lazy, Suspense, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { useLocale } from "@/features/auth/useLocale";
const PhaseOneWorkspace = lazy(() =>
  import("@/features/phase-one/Workspace").then(m => ({
    default: m.PhaseOneWorkspace,
  }))
);
const LegacyWorkspace = lazy(() => import("./LegacyWorkspace"));
type User = {
  id: number;
  username: string | null;
  name: string | null;
  email: string | null;
  locale: Locale;
  permissions: string[];
  role: "user" | "admin";
};
export default function Home() {
  const [previousMode, setPreviousMode] = useState(false);

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
  const [locale, setLocale] = useLocale((me.data?.locale ?? "ar") as Locale);
  if (!me.data)
    return (
      <AuthScreen
        locale={locale}
        setLocale={setLocale}
        setup={Boolean(setup.data?.needsSetup)}
        checking={
          me.isLoading || (me.data === null && !setup.data && !setup.error)
        }
        checkError={Boolean(me.error || setup.error)}
        retryChecks={() => {
          void me.refetch();
          void setup.refetch();
        }}
      />
    );
  return (
    <Suspense
      fallback={
        <div className="boot-screen">
          {locale === "ar"
            ? "جاري فتح البرنامج…"
            : locale === "en"
              ? "Opening workspace…"
              : "پروگرام کھل رہا ہے…"}
        </div>
      }
    >
      {previousMode &&
      me.data.policy?.legacyAccess &&
      me.data.policy.allProjects ? (
        <>
          <button
            style={{
              position: "fixed",
              bottom: 12,
              insetInlineEnd: 18,
              zIndex: 60,
              background: "#142e40",
              color: "#eefaff",
              border: "1px solid #406680",
              borderRadius: 8,
              padding: 10,
            }}
            onClick={() => setPreviousMode(false)}
          >
            {locale === "ar"
              ? "العودة إلى المرحلة الأولى"
              : locale === "en"
                ? "Return to phase one"
                : "پہلے مرحلے پر واپس جائیں"}
          </button>
          <LegacyWorkspace
            user={me.data as User}
            locale={locale}
            setLocale={setLocale}
          />
        </>
      ) : (
        <PhaseOneWorkspace
          user={me.data as User}
          locale={locale}
          setLocale={setLocale}
          previous={() => setPreviousMode(true)}
        />
      )}
    </Suspense>
  );
}
