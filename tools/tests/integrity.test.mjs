import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, normalize } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
let bad = 0;
const check = (rel, from, kind) => {
  const p = normalize(resolve(dirname(resolve(ROOT, from)), rel));
  const ok = existsSync(p);
  if (!ok) { console.log(`缺失 [${kind}] ${rel}  <- ${from}`); bad++; }
  return ok;
};

// 1. manifest 中声明的资源
const mf = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));
const mfFiles = [
  mf.background.service_worker,
  mf.side_panel.default_path,
  mf.options_page,
  ...mf.icons ? Object.values(mf.icons) : [],
  ...(mf.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
];
for (const f of mfFiles) check(f, "manifest.json", "manifest");
console.log(`manifest 声明 ${mfFiles.length} 个文件`);

// 2. HTML 里引用的 css/js
for (const html of ["src/sidepanel/sidepanel.html", "src/options/options.html"]) {
  const src = readFileSync(resolve(ROOT, html), "utf8");
  const refs = [...src.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^#/.test(u));
  for (const r of refs) check(r, html, "html");
  console.log(`${html} 引用 ${refs.length} 个本地资源`);
}

// 3. JS 里的相对 import
const jsFiles = [
  "src/background/service-worker.js", "src/content/content.js",
  "src/sidepanel/sidepanel.js", "src/options/options.js",
  "src/lib/backends.js", "src/lib/prompt.js", "src/lib/rules.js", "src/lib/report.js", "src/lib/rule-format.js",
];
let imports = 0;
for (const f of jsFiles) {
  const src = readFileSync(resolve(ROOT, f), "utf8");
  const refs = [...src.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) { check(r, f, "import"); imports++; }
}
console.log(`JS 相对导入 ${imports} 处`);

console.log(bad === 0 ? "\n全部引用完整 ✓" : `\n存在 ${bad} 处缺失 ✗`);
process.exit(bad === 0 ? 0 : 1);
