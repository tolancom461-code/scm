import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import {
  closure,
  importSpecifiers,
  resolveLocal,
} from "./source-dependencies.mjs";
const root = process.cwd(),
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}
const code = ["client/src", "server", "shared", "scripts"]
  .flatMap(walk)
  .filter(f => /\.[cm]?[jt]sx?$/.test(f));
const support = [
  ...code.filter(
    f => f.endsWith(".test.ts") || f.startsWith("scripts" + path.sep)
  ),
  "vite.config.ts",
  "vitest.config.ts",
  "drizzle.config.ts",
];
const runtime = closure(["client/src/main.tsx", "server/_core/index.ts"]),
  all = closure([...support, ...runtime]);
const errors = [];
for (const f of code) {
  if (!all.has(path.resolve(f))) errors.push("Unreachable source: " + f);
  for (const s of importSpecifiers(path.resolve(f))) {
    if (s.startsWith(".") || s.startsWith("@/") || s.startsWith("@shared/")) {
      if (!resolveLocal(s, path.resolve(f)))
        errors.push(`Missing local import: ${f} -> ${s}`);
    } else if (!s.startsWith("node:") && !builtinModules.includes(s)) {
      const name = s.startsWith("@")
        ? s.split("/").slice(0, 2).join("/")
        : s.split("/")[0];
      if (!pkg.dependencies[name] && !pkg.devDependencies[name])
        errors.push(`Undeclared package: ${f} -> ${name}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      runtimeFiles: runtime.size,
      checkedSourceFiles: code.length,
      unreachableSourceFiles: 0,
      missingImports: 0,
    })
  );
