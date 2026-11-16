import { useId } from "react";
import type { Locale } from "@/lib/i18n";
import { isWholeRequisitionQuantity } from "@shared/material-requisitions";
import { ItemImage } from "./CatalogItemImage";
import { mrText, type MrKey } from "./copy";

type Unit = {
  code: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
};

export type ItemDraft = {
  rowKey: string;
  catalogEntryId: number | null;
  catalogCode: string;
  imageUrl: string | null;
  unit: Unit;
  itemName: string;
  quantity: string;
  unitId: number;
  specifications: string;
  notes: string;
  needDate: string;
  cmmsCategoryId: number | null;
  cmmsCategoryName: string | null;
  cmmsReviewRole: string | null;
  cmmsReviewRoleName: string | null;
};

type PurchaseOptions = {
  categories: { id: number; name: string }[];
  reviewRoles: { code: string; name: string }[];
};

export function RequisitionItemCard({
  item,
  number,
  locale,
  unitLabel,
  maxNeedDate,
  project,
  options,
  update,
  remove,
}: {
  item: ItemDraft;
  number: number;
  locale: Locale;
  unitLabel: string;
  maxNeedDate?: string;
  project?: {
    cmmsSiteName: string | null;
    cmmsSectionName: string | null;
    cmmsAssetName: string | null;
  };
  options?: PurchaseOptions;
  update(changes: Partial<ItemDraft>): void;
  remove(): void;
}) {
  const c = (key: MrKey) => mrText(locale, key);
  const field = (key: MrKey) => c(key) + " " + number;
  const quantityErrorId = useId();
  const invalidQuantity =
    item.quantity !== "" && !isWholeRequisitionQuantity(item.quantity);
  const categories = options?.categories ?? [];
  const reviewRoles = options?.reviewRoles ?? [];
  const unavailableCategory =
    item.cmmsCategoryId !== null &&
    !categories.some(option => option.id === item.cmmsCategoryId);
  const unavailableReviewRole =
    item.cmmsReviewRole !== null &&
    !reviewRoles.some(option => option.code === item.cmmsReviewRole);

  return (
    <article className="mr-line-card" aria-label={field("item")}>
      <header className="mr-line-header">
        <ItemImage url={item.imageUrl} name={item.itemName} locale={locale} />
        <div className="mr-line-identity">
          <h3>
            <bdi>{item.itemName}</bdi>
          </h3>
          <dl className="mr-line-meta">
            <div>
              <dt>{c("catalogCode")}</dt>
              <dd>
                <bdi>{item.catalogCode || "—"}</bdi>
              </dd>
            </div>
            <div>
              <dt>{c("unit")}</dt>
              <dd>
                <bdi>{unitLabel}</bdi>
              </dd>
            </div>
          </dl>
        </div>
        <button
          type="button"
          className="mr-line-remove"
          aria-label={field("remove")}
          onClick={remove}
        >
          {c("remove")}
        </button>
      </header>
      <div className="mr-line-grid">
        <label>
          <span>{c("quantity")} *</span>
          <input
            aria-label={field("quantity")}
            aria-invalid={invalidQuantity || undefined}
            aria-describedby={invalidQuantity ? quantityErrorId : undefined}
            required
            dir="ltr"
            lang="en"
            type="number"
            inputMode="numeric"
            min={1}
            max={999999999}
            step={1}
            value={item.quantity}
            onChange={event => update({ quantity: event.target.value })}
          />
          {invalidQuantity && (
            <small id={quantityErrorId} className="mr-field-error">
              {c("wholeQuantityRequired")}
            </small>
          )}
        </label>
        <label>
          <span>{c("needDate")} *</span>
          <input
            aria-label={field("needDate")}
            required
            type="date"
            lang="en-CA"
            max={maxNeedDate}
            value={item.needDate}
            onChange={event => update({ needDate: event.target.value })}
          />
        </label>
        <label>
          <span>{c("cmmsCategory")} *</span>
          <select
            aria-label={field("cmmsCategory")}
            aria-invalid={options && unavailableCategory ? true : undefined}
            value={item.cmmsCategoryId ?? ""}
            disabled={!options}
            required
            onChange={event => {
              const selected = categories.find(
                option => String(option.id) === event.target.value
              );
              update({
                cmmsCategoryId: selected?.id ?? null,
                cmmsCategoryName: selected?.name ?? null,
              });
            }}
          >
            <option value="">{c("select")}</option>
            {unavailableCategory && (
              <option value={item.cmmsCategoryId ?? ""} disabled>
                {item.cmmsCategoryName ?? item.cmmsCategoryId}
              </option>
            )}
            {categories.map(option => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{c("cmmsReviewRole")} *</span>
          <select
            aria-label={field("cmmsReviewRole")}
            aria-invalid={options && unavailableReviewRole ? true : undefined}
            value={item.cmmsReviewRole ?? ""}
            disabled={!options}
            required
            onChange={event => {
              const selected = reviewRoles.find(
                option => option.code === event.target.value
              );
              update({
                cmmsReviewRole: selected?.code ?? null,
                cmmsReviewRoleName: selected?.name ?? null,
              });
            }}
          >
            <option value="">{c("select")}</option>
            {unavailableReviewRole && (
              <option value={item.cmmsReviewRole ?? ""} disabled>
                {item.cmmsReviewRoleName ?? item.cmmsReviewRole}
              </option>
            )}
            {reviewRoles.map(option => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="mr-line-location">
        <div>
          <dt>{c("cmmsSite")} *</dt>
          <dd>
            <bdi>{project?.cmmsSiteName ?? "—"}</bdi>
          </dd>
        </div>
        <div>
          <dt>{c("cmmsSection")} *</dt>
          <dd>
            <bdi>{project?.cmmsSectionName ?? "—"}</bdi>
          </dd>
        </div>
        <div>
          <dt>{c("cmmsAssetOptional")}</dt>
          <dd>
            <bdi>{project?.cmmsAssetName ?? "—"}</bdi>
          </dd>
        </div>
      </dl>
      <div className="mr-line-grid mr-line-text">
        <label>
          <span>{c("specifications")}</span>
          <textarea
            aria-label={field("specifications")}
            maxLength={5000}
            value={item.specifications}
            onChange={event => update({ specifications: event.target.value })}
          />
        </label>
        <label>
          <span>{c("notes")}</span>
          <textarea
            aria-label={field("notes")}
            maxLength={5000}
            value={item.notes}
            onChange={event => update({ notes: event.target.value })}
          />
        </label>
      </div>
    </article>
  );
}
