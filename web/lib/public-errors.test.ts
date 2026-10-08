import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("public API errors stay fixed", () => {
  it("never serializes or interpolates caught exceptions into responses", () => {
    const apiDir = join(import.meta.dir, "..", "app", "api");
    const files = collectRouteFiles(apiDir);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const bindings = [...code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map((m) => m[1]);
      for (const name of new Set(bindings)) {
        const n = name.replace(/\$/g, "\\$");
        const checks: Array<[RegExp, string]> = [
          [new RegExp(`\\$\\{\\s*${n}\\b`), "caught error interpolated into template"],
          [new RegExp(`\\b${n}\\s*\\.\\s*message\\b`), "caught .message serialized"],
          [new RegExp(`\\b${n}\\s*\\?\\.\\s*message\\b`), "caught ?.message serialized"],
          [new RegExp(`\\b${n}\\s*\\.\\s*stack\\b`), "caught .stack serialized"],
          [new RegExp(`\\b${n}\\s*\\.\\s*cause\\b`), "caught .cause serialized"],
          [new RegExp(`\\bString\\s*\\(\\s*${n}\\b`), "caught error passed to String()"],
          [new RegExp(`\\bJSON\\s*\\.\\s*stringify\\s*\\(\\s*${n}\\b`), "caught error passed to JSON.stringify()"],
          [new RegExp(`\\berror\\s*:\\s*${n}\\b`), "caught error assigned to error field"],
          [new RegExp(`\\bResponse\\s*\\.\\s*json\\s*\\(\\s*${n}\\b`), "caught error passed to Response.json()"],
          [new RegExp(`\\bconsole\\s*\\.\\s*(log|error|warn|info|debug)\\s*\\([^)]*\\b${n}\\b`), "caught error logged"],
        ];
        for (const [re, label] of checks) {
          if (re.test(code)) violations.push(`${file}: ${label} (${name})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
