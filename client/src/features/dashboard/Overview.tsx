import { trpc } from "@/lib/trpc";
import {
  chrome,
  localeMeta,
  t,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import {
  Building2,
  CircleDollarSign,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
export function StatsCard({
  icon: Icon,
  label,
  value,
  accent,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
  detail: string;
}) {
  return (
    <article className={`stat-card ${accent}`}>
      <div className="stat-top">
        <span className="stat-icon">
          <Icon size={18} />
        </span>
        <span className="stat-pulse" />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function Overview({ locale }: { locale: Locale }) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const overview = trpc.dashboard.overview.useQuery();
  if (overview.isLoading)
    return <div className="loading-screen">{chrome(locale, "syncing")}</div>;
  const data = overview.data;
  const number = (value: number) =>
    new Intl.NumberFormat(localeMeta[locale].formatting, {
      maximumFractionDigits: 0,
    }).format(value);
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">{t9("operationalPulse")}</p>
          <h1>{t9("overview")}</h1>
          <p>{t9("welcomeBack")}</p>
        </div>
        <div className="hero-signal">
          <span>{chrome(locale, "live")}</span>
          <div className="signal-bars">
            {Array.from({ length: 18 }).map((_, i) => (
              <b key={i} style={{ height: `${16 + ((i * 17) % 38)}px` }} />
            ))}
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <StatsCard
          icon={ClipboardList}
          label={t9("purchaseRequests")}
          value={data?.purchaseRequests ?? 0}
          accent="cyan"
          detail="PR//FLOW"
        />
        <StatsCard
          icon={ShieldCheck}
          label={t9("approvals")}
          value={data?.pendingApprovals ?? 0}
          accent="magenta"
          detail={chrome(locale, "actionRequired")}
        />
        <StatsCard
          icon={Building2}
          label={t9("suppliersCount")}
          value={data?.suppliers ?? 0}
          accent="violet"
          detail={chrome(locale, "masterData")}
        />
        <StatsCard
          icon={CircleDollarSign}
          label={t9("totalValue")}
          value={`${number(data?.totalContractValue ?? 0)} SAR`}
          accent="pink"
          detail={chrome(locale, "commitment")}
        />
      </div>
      <section className="wide-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{chrome(locale, "radar")}</p>
            <h2>{t9("operationalPulse")}</h2>
          </div>
          <span className="legend">
            <i className="dot cyan" /> PR <i className="dot magenta" />{" "}
            {t9("deliveries")}
          </span>
        </div>
        <div className="radar">
          <div className="radar-rings" />
          <div className="radar-line" />
          <div className="radar-points">
            <span style={{ insetInlineStart: "21%", top: "34%" }} />
            <span style={{ insetInlineStart: "47%", top: "55%" }} />
            <span style={{ insetInlineStart: "73%", top: "28%" }} />
            <span style={{ insetInlineStart: "82%", top: "67%" }} />
          </div>
          <div className="radar-summary">
            <p>
              <b>{data?.activeContracts ?? 0}</b>
              {t9("active")}
            </p>
            <p>
              <b>{number(data?.deliveredValue ?? 0)}</b>
              {t9("deliveredValue")}
            </p>
            <p>
              <b>{data?.lateDeliveries ?? 0}</b>
              {chrome(locale, "lateDelivery")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
