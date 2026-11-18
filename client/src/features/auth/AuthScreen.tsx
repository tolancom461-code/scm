import { trpc } from "@/lib/trpc";
import { localeMeta, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/features/workspace/ui";
import { SystemBrand, useSystemTitle } from "@/components/SystemBrand";
import { systemBrand } from "@/lib/branding";

function offerPasswordSave(username: string, password: string) {
  const { PasswordCredential } = window as Window & {
    PasswordCredential?: new (data: {
      id: string;
      password: string;
    }) => Credential;
  };
  if (!PasswordCredential || !navigator.credentials) return;
  try {
    const credential = new PasswordCredential({ id: username, password });
    void navigator.credentials.store(credential).catch(() => undefined);
  } catch {
    // The browser may disallow saving credentials even when it exposes the API.
  }
}

export function AuthScreen({
  locale,
  setLocale,
  setup,
  checking = false,
  checkError = false,
  retryChecks,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  setup: boolean;
  checking?: boolean;
  checkError?: boolean;
  retryChecks?: () => void;
}) {
  const trpcUtils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const t9 = (key: TranslationKey) => t(locale, key);
  useSystemTitle(setup ? t9("setup") : t9("login"));
  const login = trpc.auth.login.useMutation({
    onSuccess: (_, { username, password, rememberMe }) => {
      if (rememberMe) offerPasswordSave(username, password);
      void trpcUtils.auth.me.invalidate();
      toast.success(t9("actionDone"));
    },
    onError: error => toast.error(error.message),
  });
  const bootstrap = trpc.auth.bootstrap.useMutation({
    onSuccess: () => {
      void trpcUtils.auth.me.invalidate();
      void trpcUtils.auth.firstRunStatus.invalidate();
      toast.success(t9("actionDone"));
    },
    onError: error => toast.error(error.message),
  });
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const username = String(fields.get("username") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    if (setup)
      bootstrap.mutate({
        username,
        password,
        name,
        email: email || undefined,
        locale,
      });
    else
      login.mutate({
        username,
        password,
        rememberMe: fields.has("rememberMe"),
      });
  };
  return (
    <main className="auth-shell">
      <div className="auth-grid" />
      <section className="auth-orbit">
        <div className="orbit-core" />
        <span className="pulse p1" />
        <span className="pulse p2" />
        <span className="pulse p3" />
      </section>
      <section className="auth-panel">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span />
          </div>
          <SystemBrand locale={locale} landing />
        </div>
        <div className="auth-heading">
          <p className="eyebrow">{setup ? t9("setup") : t9("signIn")}</p>
          <h1>{setup ? t9("initialize") : t9("welcomeBack")}</h1>
          {setup && <p>{t9("bootText")}</p>}
        </div>
        <form method="post" onSubmit={submit} className="auth-form">
          {checking && (
            <p role="status">
              {locale === "ar"
                ? "جاري التحقق من جاهزية الدخول…"
                : locale === "en"
                  ? "Checking sign-in availability…"
                  : "لاگ ان کی دستیابی کی جانچ…"}
            </p>
          )}
          {checkError && (
            <div role="alert">
              <p>
                {locale === "ar"
                  ? "تعذر الاتصال بالخادم. أعد المحاولة."
                  : locale === "en"
                    ? "Could not reach the server. Please retry."
                    : "سرور سے رابطہ نہیں ہو سکا۔ دوبارہ کوشش کریں۔"}
              </p>
              <button type="button" onClick={retryChecks}>
                {locale === "ar"
                  ? "إعادة المحاولة"
                  : locale === "en"
                    ? "Retry"
                    : "دوبارہ کوشش"}
              </button>
            </div>
          )}
          {setup ? (
            <>
              <Input label={t9("name")} required>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </Input>
              <Input label={t9("email")}>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  type="email"
                />
              </Input>
            </>
          ) : null}
          <Input label={t9("username")} required>
            <input name="username" autoComplete="username" required />
          </Input>
          <Input label={t9("password")} required>
            <input
              name="password"
              autoComplete={setup ? "new-password" : "current-password"}
              type="password"
              minLength={setup ? 12 : 1}
              required
            />
          </Input>
          {!setup && (
            <label className="auth-remember">
              <input type="checkbox" name="rememberMe" />
              {t9("rememberLogin")}
            </label>
          )}
          <Input label={t9("language")}>
            <select
              value={locale}
              onChange={e => setLocale(e.target.value as Locale)}
            >
              {(Object.keys(localeMeta) as Locale[]).map(item => (
                <option key={item} value={item}>
                  {localeMeta[item].label}
                </option>
              ))}
            </select>
          </Input>
          <button
            className="neo-button full"
            disabled={
              checking || checkError || login.isPending || bootstrap.isPending
            }
          >
            {setup ? t9("createAccount") : t9("login")}
            <ShieldCheck size={17} />
          </button>
        </form>
        <p className="auth-wordmark" dir="ltr">
          {systemBrand.abbreviation}
        </p>
      </section>
    </main>
  );
}
