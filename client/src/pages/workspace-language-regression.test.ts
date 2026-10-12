import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const homeSource = readFileSync(
  resolve(projectRoot, "client/src/pages/Home.tsx"),
  "utf8"
);
const appSource = readFileSync(
  resolve(projectRoot, "client/src/App.tsx"),
  "utf8"
);
const rfqSource = readFileSync(
  resolve(projectRoot, "client/src/components/RfqOperationsPage.tsx"),
  "utf8"
);
const contractSource = readFileSync(
  resolve(projectRoot, "client/src/components/ContractOperationsPage.tsx"),
  "utf8"
);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(target)
      : /\.(ts|tsx)$/.test(entry.name)
        ? [target]
        : [];
  });
}

describe("انحدار تبديل لغة مساحة العمل", () => {
  it("يبقي RFQ والعقود في مكوّنات React مستقلة عند تبديل اللغة", () => {
    expect(homeSource).toMatch(
      /page === "rfqs"[\s\S]*?<RfqOperationsPage\s+locale=\{locale\}\s*\/>/
    );
    expect(homeSource).toMatch(
      /page === "contracts"[\s\S]*?<ContractOperationsPage\s+locale=\{locale\}\s*\/>/
    );
    expect(homeSource).not.toContain("<Workspace key={locale}");
  });

  it("لا يستخدم مراقبة DOM أو مترجم النصوص السابق", () => {
    expect(appSource).not.toContain("TechnicalCopyLocalization");
    expect(rfqSource).not.toContain("MutationObserver");
    expect(contractSource).not.toContain("MutationObserver");
    const clientSource = sourceFiles(resolve(projectRoot, "client/src"))
      .filter(
        file =>
          !file.endsWith("workspace-language-regression.test.ts") &&
          !file.endsWith("DecimalStepFix.tsx")
      )
      .map(file => readFileSync(file, "utf8"))
      .join("\n");
    expect(clientSource).not.toContain("MutationObserver");
    expect(clientSource).not.toContain("TechnicalCopyLocalization");
  });
});
