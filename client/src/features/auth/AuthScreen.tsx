import { trpc } from "@/lib/trpc";
import { localeMeta, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/features/workspace/ui";
export function AuthScreen({
  locale,
  setLocale,
  setup,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  setup: boolean;
}) {
  const trpcUtils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const t9 = (key: TranslationKey) => t(locale, key);
  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
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
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (setup)
      bootstrap.mutate({
        username,
        password,
        name,
        email: email || undefined,
        locale,
      });
    else login.mutate({ username, password });
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
          <div>
            <strong>{t9("brand")}</strong>
            <small>{t9("strap")}</small>
          </div>
        </div>
        <div className="auth-heading">
          <p className="eyebrow">{setup ? t9("setup") : t9("signIn")}</p>
          <h1>{setup ? t9("initialize") : t9("welcomeBack")}</h1>
          <p>{setup ? t9("bootText") : t9("signinText")}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
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
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </Input>
          <Input label={t9("password")} required>
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={setup ? "new-password" : "current-password"}
              type="password"
              minLength={setup ? 12 : 1}
              required
            />
          </Input>
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
            disabled={login.isPending || bootstrap.isPending}
          >
            {setup ? t9("createAccount") : t9("login")}
            <ShieldCheck size={17} />
          </button>
        </form>
        <p className="auth-foot">
          LOCAL//AUTH <span /> ATOMIC//ACCESS
        </p>
      </section>
    </main>
  );
}
