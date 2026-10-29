import ts from "typescript";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const extensions = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".json",
  "/index.ts",
  "/index.tsx",
];
export function resolveLocal(spec, from) {
  const base = spec.startsWith("@/")
    ? path.join(root, "client/src", spec.slice(2))
    : spec.startsWith("@shared/")
      ? path.join(root, "shared", spec.slice(8))
      : spec.startsWith(".")
        ? path.resolve(path.dirname(from), spec)
        : null;
  return base
    ? (extensions
        .map(ext => base + ext)
        .find(f => existsSync(f) && statSync(f).isFile()) ?? null)
    : null;
}
export function importSpecifiers(file) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    ),
    result = [];
  function visit(n) {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    )
      result.push(n.moduleSpecifier.text);
    if (
      ts.isCallExpression(n) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        n.expression.getText(ast) === "require")
    )
      result.push(n.arguments[0].text);
    if (
      ts.isNewExpression(n) &&
      n.expression.getText(ast) === "URL" &&
      n.arguments?.[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      n.arguments[0].text.startsWith(".")
    )
      result.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return result;
}
export function dependencies(file) {
  return importSpecifiers(file)
    .map(s => resolveLocal(s, file))
    .filter(Boolean);
}
export function closure(entries) {
  const used = new Set();
  function visit(f) {
    f = path.resolve(root, f);
    if (used.has(f) || !existsSync(f)) return;
    used.add(f);
    for (const d of dependencies(f)) visit(d);
  }
  entries.forEach(visit);
  return used;
}
