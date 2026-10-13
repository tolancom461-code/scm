import { trpc } from "@/lib/trpc";
import { SystemBrand, useSystemTitle } from "@/components/SystemBrand";
import { systemBrand } from "@/lib/branding";
import {
  chrome,
  localeMeta,
  t,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import {
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  Users2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Overview } from "@/features/dashboard/Overview";
import { SupplierPage } from "@/features/suppliers/SupplierPage";
import { RequestPage } from "@/features/procurement/RequestPage";
import { DocumentsPage } from "@/features/documents/DocumentsPage";
import { UsersPage } from "@/features/users/UsersPage";
import { OrdersAndDeliveriesPage } from "@/features/purchasing/OrdersAndDeliveriesPage";
import { MasterDataPage } from "@/features/master-data/MasterDataPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";
import { ProcurementPage } from "@/features/procurement/ProcurementPage";
import { ReceivingPage } from "@/features/receiving/ReceivingPage";
import { InventoryPage } from "@/features/inventory/InventoryPage";
import { FinancePage } from "@/features/finance/FinancePage";
import { MvpOrdersPage } from "@/features/procurement/MvpOrdersPage";
import { MvpOverview } from "@/features/dashboard/MvpOverview";
import { RfqOperationsPage } from "@/components/RfqOperationsPage";
import { ContractOperationsPage } from "@/components/ContractOperationsPage";
import { ReportsPage } from "@/components/ReportsPage";
type Page =
  | "finance"
  | "receiving"
  | "inventory"
  | "procurement"
  | "projects"
  | "workflows"
  | "masterData"
  | "overview"
  | "requests"
  | "suppliers"
  | "contracts"
  | "rfqs"
  | "orders"
  | "deliveries"
  | "documents"
  | "reports"
  | "users";
type User = {
  id: number;
  username: string | null;
  name: string | null;
  email: string | null;
  locale: Locale;
  permissions: string[];
  role: "user" | "admin";
};
export default function Workspace({
  user,
  locale,
  setLocale,
}: {
  user: User;
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const [page, setPage] = useState<Page>("overview");
  useSystemTitle(t9(page));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => window.location.reload(),
  });
  const notifications = trpc.notifications.list.useQuery();
  const utils = trpc.useUtils();
  const read = trpc.notifications.markRead.useMutation({
    onSuccess: () => void utils.notifications.list.invalidate(),
  });
  const navigation = useMemo(
    () => [
      {
        page: "finance" as Page,
        icon: CircleDollarSign,
        label: "finance" as TranslationKey,
        permission: "finance.view",
      },
      {
        page: "receiving" as Page,
        icon: Truck,
        label: "receiving" as TranslationKey,
        permission: "receiving.view",
      },
      {
        page: "inventory" as Page,
        icon: PackageCheck,
        label: "inventory" as TranslationKey,
        permission: "inventory.view",
      },
      {
        page: "procurement" as Page,
        icon: ClipboardList,
        label: "procurement" as TranslationKey,
        permission: "procurement.view",
      },
      {
        page: "projects" as Page,
        icon: Building2,
        label: "projects" as TranslationKey,
        permission: "projects.view",
      },
      {
        page: "workflows" as Page,
        icon: CheckCircle2,
        label: "workflows" as TranslationKey,
        permission: "workflows.view",
      },
      {
        page: "masterData" as Page,
        icon: Building2,
        label: "masterData" as TranslationKey,
        permission: "master.view",
      },
      {
        page: "overview" as Page,
        icon: LayoutDashboard,
        label: "overview" as TranslationKey,
        permission: "dashboard.view",
      },
      {
        page: "requests" as Page,
        icon: ClipboardList,
        label: "requests" as TranslationKey,
        permission: "requests.view",
      },
      {
        page: "suppliers" as Page,
        icon: Building2,
        label: "suppliers" as TranslationKey,
        permission: "suppliers.view",
      },
      {
        page: "contracts" as Page,
        icon: FileText,
        label: "contracts" as TranslationKey,
        permission: "contracts.view",
      },
      {
        page: "rfqs" as Page,
        icon: FileText,
        label: "rfqs" as TranslationKey,
        permission: "rfqs.view",
      },
      {
        page: "orders" as Page,
        icon: PackageCheck,
        label: "orders" as TranslationKey,
        permission: "orders.view",
      },
      {
        page: "deliveries" as Page,
        icon: Truck,
        label: "deliveries" as TranslationKey,
        permission: "deliveries.view",
      },
      {
        page: "documents" as Page,
        icon: Upload,
        label: "documents" as TranslationKey,
        permission: "documents.view",
      },
      {
        page: "reports" as Page,
        icon: FileText,
        label: "reports" as TranslationKey,
        permission: "reports.export",
      },
      {
        page: "users" as Page,
        icon: Users2,
        label: "users" as TranslationKey,
        permission: "users.view",
      },
    ],
    []
  );
  const simplifiedNavigation = navigation.filter(
    item =>
      ![
        "requests",
        "contracts",
        "rfqs",
        "orders",
        "deliveries",
        "reports",
      ].includes(item.page)
  );
  const allowed = simplifiedNavigation.filter(
    item =>
      user.role === "admin" ||
      (user.permissions.includes(item.permission) &&
        (item.page !== "overview" ||
          user.permissions.includes("projects.view")))
  );
  const activePage = allowed.some(item => item.page === page)
    ? page
    : allowed[0]?.page;
  useEffect(() => {
    if (activePage && activePage !== page) setPage(activePage);
  }, [activePage, page]);
  const content = !activePage ? (
    <p role="alert">{t9("accessDenied")}</p>
  ) : activePage !== page ? null : page === "finance" ? (
    <FinancePage locale={locale} user={user} />
  ) : page === "receiving" ? (
    <ReceivingPage locale={locale} user={user} />
  ) : page === "inventory" ? (
    <InventoryPage locale={locale} user={user} />
  ) : page === "procurement" ? (
    <MvpOrdersPage locale={locale} user={user} />
  ) : page === "projects" ? (
    <ProjectsPage
      locale={locale}
      canManage={
        user.role === "admin" || user.permissions.includes("projects.manage")
      }
      canApprove={
        user.role === "admin" || user.permissions.includes("budgets.approve")
      }
      userId={user.id}
    />
  ) : page === "workflows" ? (
    <WorkflowsPage
      locale={locale}
      canManage={
        user.role === "admin" || user.permissions.includes("workflows.manage")
      }
    />
  ) : page === "masterData" ? (
    <MasterDataPage
      locale={locale}
      canManage={
        user.role === "admin" || user.permissions.includes("master.manage")
      }
    />
  ) : page === "overview" ? (
    <MvpOverview locale={locale} user={user} />
  ) : page === "requests" ? (
    <RequestPage locale={locale} />
  ) : page === "suppliers" ? (
    <SupplierPage locale={locale} />
  ) : page === "contracts" ? (
    <ContractOperationsPage locale={locale} />
  ) : page === "rfqs" ? (
    <RfqOperationsPage locale={locale} />
  ) : page === "reports" ? (
    <ReportsPage locale={locale} />
  ) : page === "documents" ? (
    <DocumentsPage locale={locale} />
  ) : page === "users" ? (
    <UsersPage locale={locale} />
  ) : (
    <OrdersAndDeliveriesPage locale={locale} page={page} />
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-glow" />
        <div className="brand-lockup">
          <div className="brand-mark">
            <span />
          </div>
          <SystemBrand locale={locale} />
        </div>
        <nav>
          {allowed.map(item => (
            <button
              key={item.page}
              className={page === item.page ? "active" : ""}
              onClick={() => {
                setPage(item.page);
                setSidebarOpen(false);
              }}
            >
              <item.icon size={18} />
              <span>{t9(item.label)}</span>
              <b />
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="access-chip">
            <ShieldCheck size={14} />
            <span>ATOMIC//ACCESS</span>
          </div>
          <button className="profile-row" onClick={() => logout.mutate()}>
            <div>{user.name?.slice(0, 1) || "U"}</div>
            <span>
              <b>{user.name}</b>
              <small>@{user.username}</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumb">
            <span dir="ltr">{systemBrand.abbreviation}</span>
            <i />{" "}
            <b>
              {t9(
                navigation.find(item => item.page === page)?.label ?? "overview"
              )}
            </b>
          </div>
          <div className="top-actions">
            <div className="locale-switch">
              <Globe2 size={15} />
              <select
                aria-label={t9("changeLanguage")}
                value={locale}
                onChange={e => setLocale(e.target.value as Locale)}
              >
                {(Object.keys(localeMeta) as Locale[]).map(item => (
                  <option key={item} value={item}>
                    {localeMeta[item].label}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                onClick={() => setNotifyOpen(!notifyOpen)}
                aria-label={t9("notifications")}
              >
                <Bell size={18} />
                {(notifications.data ?? []).some(item => !item.readAt) ? (
                  <i />
                ) : null}
              </button>
              {notifyOpen ? (
                <div className="notification-panel">
                  <header>
                    <b>{t9("notifications")}</b>
                    <span>
                      {
                        (notifications.data ?? []).filter(item => !item.readAt)
                          .length
                      }{" "}
                      NEW
                    </span>
                  </header>
                  {notifications.data?.length ? (
                    notifications.data.map(item => (
                      <button
                        key={item.id}
                        className={!item.readAt ? "unread" : ""}
                        onClick={() => read.mutate({ id: item.id })}
                      >
                        <span>
                          {locale === "en"
                            ? item.titleEn
                            : locale === "ur"
                              ? item.titleUr
                              : item.titleAr}
                        </span>
                        <small>
                          {new Date(item.createdAt).toLocaleString(
                            localeMeta[locale].formatting
                          )}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p>{t9("allClear")}</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="content-area">{content}</main>
      </div>
    </div>
  );
}
