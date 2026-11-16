import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { ItemImage } from "./CatalogItemImage";
import { mrText, type MrKey } from "./copy";
import "./catalog-picker.css";

type Catalog = inferRouterOutputs<AppRouter>["materialRequisitions"];
type Category = Catalog["catalogTree"]["nodes"][number];
type Browse = { q: string; page: number; nodeId?: number };
const pageSize = 20;

const labels = {
  ar: {
    categories: "تصنيفات الكتالوج",
    all: "جميع الأصناف",
    unavailable: "تعذّر تحميل التصنيفات. يمكنك البحث في جميع الأصناف.",
    expand: "توسيع",
    collapse: "طي",
  },
  en: {
    categories: "Catalog categories",
    all: "All items",
    unavailable: "Categories could not be loaded. You can search all items.",
    expand: "Expand",
    collapse: "Collapse",
  },
  ur: {
    categories: "کیٹلاگ کے زمرے",
    all: "تمام اشیا",
    unavailable: "زمرے لوڈ نہیں ہو سکے۔ آپ تمام اشیا میں تلاش کر سکتے ہیں۔",
    expand: "کھولیں",
    collapse: "بند کریں",
  },
} as const;

function CategoryBranches({
  locale,
  nodes,
  selected,
  disabled,
  select,
}: {
  locale: Locale;
  nodes: Category[];
  selected: number | undefined;
  disabled: boolean;
  select: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const byParent = useMemo(() => {
    const groups = new Map<number | null, Category[]>();
    for (const node of nodes) {
      const group = groups.get(node.parentId);
      if (group) group.push(node);
      else groups.set(node.parentId, [node]);
    }
    return groups;
  }, [nodes]);
  const ClosedIcon =
    localeMeta[locale].direction === "rtl" ? ChevronLeft : ChevronRight;
  const copy = labels[locale];

  function renderBranches(branches: Category[]): ReactNode {
    if (!branches.length) return null;
    return (
      <ul>
        {branches.map(node => {
          const children = byParent.get(node.id) ?? [];
          const open = expanded.has(node.id);
          const Icon = open ? ChevronDown : ClosedIcon;
          return (
            <li key={node.id}>
              <div className="mr-catalog-branch">
                {children.length ? (
                  <button
                    type="button"
                    className="mr-catalog-branch-toggle"
                    aria-label={`${open ? copy.collapse : copy.expand} ${node.name}`}
                    aria-expanded={open}
                    disabled={disabled}
                    onClick={() =>
                      setExpanded(current => {
                        const next = new Set(current);
                        if (!next.delete(node.id)) next.add(node.id);
                        return next;
                      })
                    }
                  >
                    <Icon size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="mr-catalog-branch-toggle" />
                )}
                <button
                  type="button"
                  className="mr-catalog-branch-select"
                  aria-pressed={selected === node.id}
                  disabled={disabled}
                  title={node.name}
                  onClick={() => select(node.id)}
                >
                  {node.code && (
                    <bdi dir="ltr" title={node.code}>
                      {node.code}
                    </bdi>
                  )}
                  <span dir="auto">{node.name}</span>
                </button>
              </div>
              {open && renderBranches(children)}
            </li>
          );
        })}
      </ul>
    );
  }

  return renderBranches(byParent.get(null) ?? []);
}

function LoadError({
  message,
  retry,
  disabled,
  children,
}: {
  message: string;
  retry: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <div className="mr-error mr-catalog-load-error" role="alert">
      <span>{message}</span>
      <button type="button" disabled={disabled} onClick={retry}>
        {children}
      </button>
    </div>
  );
}

export function CatalogPicker({
  locale,
  capacity,
  close,
  imported,
}: {
  locale: Locale;
  capacity: number;
  close: () => void;
  imported: (items: Catalog["catalogImport"]) => void;
}) {
  const c = (key: MrKey) => mrText(locale, key);
  const copy = labels[locale];
  const [searchText, setSearchText] = useState("");
  const [browse, setBrowse] = useState<Browse>({ q: "", page: 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const status = trpc.materialRequisitions.catalogStatus.useQuery();
  const enabled = status.data?.configured === true;
  const queryOptions = { enabled, refetchOnWindowFocus: false, retry: false };
  const tree = trpc.materialRequisitions.catalogTree.useQuery(
    { locale },
    queryOptions
  );
  const catalog = trpc.materialRequisitions.catalogSearch.useQuery(
    { ...browse, pageSize, locale },
    queryOptions
  );
  const importItems = trpc.materialRequisitions.catalogImport.useMutation({
    onSuccess: imported,
  });
  const locked = importItems.isPending;
  const pages = catalog.data
    ? Math.max(1, Math.ceil(catalog.data.total / pageSize))
    : browse.page;

  function changeBranch(nodeId?: number) {
    setBrowse({ q: searchText.trim(), page: 1, nodeId });
  }
  const applySearch = useCallback((q: string) => {
    setBrowse(current =>
      current.q === q ? current : { ...current, q, page: 1 }
    );
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => applySearch(searchText.trim()),
      350
    );
    return () => window.clearTimeout(timeout);
  }, [applySearch, searchText]);

  return (
    <section className="mr-catalog" aria-label={c("catalog")}>
      <div className="mr-heading">
        <h3>{c("catalog")}</h3>
        <button type="button" disabled={locked} onClick={close}>
          {c("backToRequest")}
        </button>
      </div>
      {status.isLoading ? (
        <p role="status">{c("loadingCatalog")}</p>
      ) : status.error ? (
        <LoadError
          message={status.error.message}
          retry={() => void status.refetch()}
        >
          {c("retry")}
        </LoadError>
      ) : !enabled ? (
        <p className="mr-help" role="status">
          {c("catalogNotConfigured")}
        </p>
      ) : (
        <>
          <div className="mr-catalog-browser">
            <nav className="mr-catalog-tree" aria-label={copy.categories}>
              <h4>{copy.categories}</h4>
              <div className="mr-catalog-branches">
                <button
                  type="button"
                  className="mr-catalog-branch-select mr-catalog-all"
                  aria-pressed={browse.nodeId === undefined}
                  disabled={locked}
                  onClick={() => changeBranch()}
                >
                  {copy.all}
                </button>
                {tree.error ? (
                  <LoadError
                    message={copy.unavailable}
                    retry={() => void tree.refetch()}
                    disabled={locked || tree.isFetching}
                  >
                    {c("retry")}
                  </LoadError>
                ) : tree.isLoading ? (
                  <p role="status">{c("loadingCatalog")}</p>
                ) : tree.data ? (
                  <CategoryBranches
                    locale={locale}
                    nodes={tree.data.nodes}
                    selected={browse.nodeId}
                    disabled={locked}
                    select={changeBranch}
                  />
                ) : null}
              </div>
            </nav>
            <div className="mr-catalog-main">
              <div className="mr-catalog-browser-search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  aria-label={c("catalogSearch")}
                  placeholder={c("catalogSearch")}
                  maxLength={150}
                  value={searchText}
                  disabled={locked}
                  autoFocus
                  onChange={event => setSearchText(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!event.nativeEvent.isComposing) {
                      applySearch(searchText.trim());
                    }
                  }}
                />
              </div>
              <div
                className="mr-catalog-results"
                aria-busy={catalog.isFetching}
              >
                {catalog.isFetching ? (
                  <p role="status">{c("loadingCatalog")}</p>
                ) : catalog.error ? (
                  <LoadError
                    message={catalog.error.message}
                    retry={() => void catalog.refetch()}
                  >
                    {c("retry")}
                  </LoadError>
                ) : !catalog.data?.items.length ? (
                  <p>{c("catalogEmpty")}</p>
                ) : (
                  <ul>
                    {catalog.data.items.map(item => {
                      const checked = selected.includes(item.id);
                      const unitName =
                        locale === "ar"
                          ? item.unit.nameAr
                          : locale === "en"
                            ? item.unit.nameEn
                            : item.unit.nameUr;
                      return (
                        <li className="mr-catalog-result" key={item.id}>
                          <ItemImage
                            url={item.previewUrl}
                            name={item.name}
                            locale={locale}
                          />
                          <label className="mr-catalog-result-select">
                            <span className="mr-catalog-result-text">
                              <strong dir="auto">{item.name}</strong>
                              <small dir="auto">
                                {item.specifications || unitName}
                              </small>
                            </span>
                            <bdi dir="ltr" title={item.code}>
                              {item.code}
                            </bdi>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                locked ||
                                (!checked && selected.length >= capacity)
                              }
                              aria-label={`${item.name} (${item.code})`}
                              onChange={event => {
                                const choose = event.currentTarget.checked;
                                setSelected(current => {
                                  if (!choose)
                                    return current.filter(id => id !== item.id);
                                  if (
                                    current.length >= capacity ||
                                    current.includes(item.id)
                                  )
                                    return current;
                                  return [...current, item.id];
                                });
                              }}
                            />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="mr-actions mr-catalog-pagination">
                <button
                  type="button"
                  disabled={browse.page <= 1 || catalog.isFetching || locked}
                  onClick={() =>
                    setBrowse(current => ({
                      ...current,
                      page: current.page - 1,
                    }))
                  }
                >
                  {c("previous")}
                </button>
                <bdi dir="ltr">
                  {browse.page} / {pages}
                </bdi>
                <button
                  type="button"
                  disabled={
                    browse.page >= pages || catalog.isFetching || locked
                  }
                  onClick={() =>
                    setBrowse(current => ({
                      ...current,
                      page: current.page + 1,
                    }))
                  }
                >
                  {c("next")}
                </button>
              </div>
            </div>
          </div>
          {importItems.error && (
            <p role="alert" className="mr-error">
              {importItems.error.message}
            </p>
          )}
          <div className="mr-actions mr-catalog-footer">
            <p className="mr-catalog-count" aria-live="polite">
              {c("selectedItems")} <bdi>{selected.length}</bdi>
              <span aria-hidden="true"> · </span>
              {c("catalogCapacity")} <bdi>{capacity}</bdi>
            </p>
            <button
              type="button"
              className="primary"
              disabled={
                !selected.length || selected.length > capacity || locked
              }
              onClick={() => importItems.mutate({ ids: selected, locale })}
            >
              {locked ? c("importing") : c("importSelected")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
