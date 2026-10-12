import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { Locale } from "@/lib/i18n";
import {
  roleTemplates,
  completePermissions,
  togglePermission,
  type AccessTemplate,
} from "@shared/policy";
import { policyText, type PolicyLabel } from "./copy";
import "./policy.css";
export type UserAccessForm = {
  template: AccessTemplate;
  permissions: string[];
  allProjects: boolean;
  projectIds: number[];
  legacyAccess: boolean;
};
type Catalog = inferRouterOutputs<AppRouter>["policy"]["catalog"];
export function UserAccessFields({
  locale,
  form,
  onChange,
  catalog,
}: {
  locale: Locale;
  form: UserAccessForm;
  onChange: (value: UserAccessForm) => void;
  catalog: Catalog;
}) {
  const p = (key: PolicyLabel) => policyText(locale, key);
  const languageIndex = locale === "en" ? 1 : locale === "ur" ? 2 : 0;
  const checked = completePermissions(form.permissions);
  return (
    <div className="policy-form user-access-fields">
      <label>
        {p("role")}
        <select
          aria-label={p("role")}
          value={form.template}
          onChange={e => {
            const template = e.target.value as AccessTemplate;
            onChange({
              ...form,
              template,
              permissions: [...roleTemplates[template].permissions],
              legacyAccess: false,
            });
          }}
        >
          {catalog?.templates.map(t => (
            <option
              key={t.code}
              value={t.code}
              disabled={completePermissions(t.permissions).some(
                code =>
                  !catalog?.permissions.some(
                    permission => permission.code === code
                  )
              )}
            >
              {t.labels[languageIndex]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{p("scope")}</legend>
        <label>
          <input
            type="radio"
            name="scope"
            checked={!form.allProjects}
            onChange={() =>
              onChange({
                ...form,
                allProjects: false,
                legacyAccess: false,
              })
            }
          />
          {p("assigned")}
        </label>
        <label>
          <input
            type="radio"
            name="scope"
            checked={form.allProjects}
            disabled={!catalog?.canDelegateAll}
            onChange={() =>
              onChange({ ...form, allProjects: true, projectIds: [] })
            }
          />
          {p("all")}
        </label>
        {!form.allProjects && (
          <>
            <b>{p("projects")}</b>
            <div className="policy-options">
              {catalog?.projects.map(project => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    checked={form.projectIds.includes(project.id)}
                    onChange={() =>
                      onChange({
                        ...form,
                        projectIds: form.projectIds.includes(project.id)
                          ? form.projectIds.filter(id => id !== project.id)
                          : [...form.projectIds, project.id],
                      })
                    }
                  />
                  <span>
                    <bdi>{project.number}</bdi> — {project.name}
                  </span>
                </label>
              ))}
            </div>
            {!form.projectIds.length && <p className="p1-hint">{p("none")}</p>}
          </>
        )}
        {catalog?.canDelegateLegacy && (
          <label>
            <input
              type="checkbox"
              checked={form.legacyAccess}
              disabled={!form.allProjects}
              onChange={e =>
                onChange({ ...form, legacyAccess: e.target.checked })
              }
            />
            {p("legacy")}
          </label>
        )}
      </fieldset>
      <h3>{p("permissions")}</h3>
      <p className="p1-hint">{p("extra")}</p>
      {(["current", "shared", "previous"] as const)
        .filter(group => group !== "previous" || form.legacyAccess)
        .map(group => (
          <fieldset key={group}>
            <legend>{p(group)}</legend>
            <div className="policy-options">
              {catalog?.permissions
                .filter(permission =>
                  group === "current"
                    ? permission.code.startsWith("p1.")
                    : group === "shared"
                      ? [
                          "users",
                          "suppliers",
                          "documents",
                          "policy",
                          "permissions",
                        ].includes(permission.module)
                      : !permission.code.startsWith("p1.") &&
                        ![
                          "users",
                          "suppliers",
                          "documents",
                          "policy",
                          "permissions",
                        ].includes(permission.module)
                )
                .map(permission => (
                  <label key={permission.code}>
                    <input
                      type="checkbox"
                      checked={checked.includes(permission.code)}
                      onChange={e =>
                        onChange({
                          ...form,
                          permissions: togglePermission(
                            form.permissions,
                            permission.code,
                            e.target.checked
                          ),
                        })
                      }
                    />
                    <span>
                      {
                        permission[
                          locale === "en" ? "en" : locale === "ur" ? "ur" : "ar"
                        ]
                      }
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
      <p className="p1-hint">{p("scopeWarning")}</p>
    </div>
  );
}
