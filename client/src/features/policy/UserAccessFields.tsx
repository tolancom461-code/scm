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
  constructionProjectIds?: number[];
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
            <b>
              {locale === "en"
                ? "Project module"
                : locale === "ur"
                  ? "منصوبوں کی اکائی"
                  : "وحدة المشاريع"}
            </b>
            <div className="policy-options">
              {catalog.constructionProjects.map(project => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    checked={(form.constructionProjectIds ?? []).includes(
                      project.id
                    )}
                    onChange={() =>
                      onChange({
                        ...form,
                        constructionProjectIds: (
                          form.constructionProjectIds ?? []
                        ).includes(project.id)
                          ? (form.constructionProjectIds ?? []).filter(
                              id => id !== project.id
                            )
                          : [
                              ...(form.constructionProjectIds ?? []),
                              project.id,
                            ],
                      })
                    }
                  />
                  <span>
                    <bdi>{project.number}</bdi> — {project.name}
                  </span>
                </label>
              ))}
            </div>
            {!form.projectIds.length &&
              !form.constructionProjectIds?.length && (
                <p className="p1-hint">{p("none")}</p>
              )}
          </>
        )}
      </fieldset>
      <h3>{p("permissions")}</h3>
      <p className="p1-hint">{p("extra")}</p>
      {(["construction", "current", "shared"] as const).map(group => (
        <fieldset key={group}>
          <legend>{p(group)}</legend>
          <div className="policy-options">
            {catalog?.permissions
              .filter(permission =>
                group === "construction"
                  ? permission.code.startsWith("pm.")
                  : group === "current"
                    ? permission.code.startsWith("p1.")
                    : !permission.code.startsWith("p1.") &&
                      !permission.code.startsWith("pm.")
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
