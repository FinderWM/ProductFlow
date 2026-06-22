#!/usr/bin/env node
// U3 防回潮门禁（棘轮 ratchet）：组件层裸 Tailwind 颜色类计数不得「超过」基线。
// 迁移到 pf-* 语义类使计数下降 → 通过；新增裸色使计数上升 → 失败。与分支状态无关。
//   node scripts/check-bare-colors.mjs            校验（CI 用）
//   node scripts/check-bare-colors.mjs --update   迁移后重置基线（收紧棘轮）
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["src/pages", "src/components"];
const BASELINE = join(webRoot, "scripts", "bare-colors-baseline.json");
const PATTERN = /\b(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|slate|zinc|gray|neutral|stone)-(?:[0-9]{2,3})\b|\bbg-white\b|\btext-white\b|\bbg-black\b/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const counts = {};
for (const d of SCAN_DIRS) {
  const abs = join(webRoot, d);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const n = (readFileSync(file, "utf8").match(PATTERN) || []).length;
    if (n > 0) counts[relative(webRoot, file)] = n;
  }
}

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(counts, Object.keys(counts).sort(), 2) + "\n");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[check-bare-colors] 基线已更新：${Object.keys(counts).length} 文件 / ${total} 处裸色。`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const offenders = [];
for (const [file, n] of Object.entries(counts)) {
  const limit = baseline[file] ?? 0;
  if (n > limit) offenders.push(`${file}: ${n} > 基线 ${limit}`);
}

if (offenders.length > 0) {
  console.error(`[check-bare-colors] ${offenders.length} 个文件裸色计数超过基线，请改用 pf-* 语义类（pf-surface/pf-ink/pf-hairline 等）；迁移后用 --update 收紧基线：`);
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log(`[check-bare-colors] OK：无文件超过裸色基线（存量待 U3 增量迁移）。`);
