// 把模型输出与规则层结果合并成结构化报告
// 核心改动：不再解析 JSON、不再定位 start/end——改为按行解析 + 原文片段去重
//
// 输入：
//   modelText: 模型层返回的纯文本（按【输出格式】输出）
//   ruleLines: 规则层格式化后的条目数组（来自 rule-format.formatRulesAsLines）
// 输出：
//   { lines, summary, report } ——
//     lines 为结构化条目数组（侧边栏按此渲染卡片）
//     summary 为末尾一句话统计行（悬浮面板直接展示）
//     report  为拼好的完整文本报告（备用，目前主要靠 lines 渲染）

import { CATEGORY_LABEL, ISSUE_CATEGORIES } from "./prompt.js";

// 从一行模型输出中解析：- 【类】"原文" → "建议"（说明）
// 容错处理：模型输出格式可能略有偏差（多余空格、缺少括号等）
function parseModelLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("-")) return null;

  // 抽类别标签：【xxx】
  const catMatch = trimmed.match(/【\s*([^\]]+?)\s*】/);
  if (!catMatch) return null;
  const catLabel = catMatch[1].trim();

  // 把标签翻成 category key（容错：模型可能写"错别字/错字/typo"等）
  let category = null;
  for (const [k, label] of Object.entries(CATEGORY_LABEL)) {
    if (label === catLabel || k === catLabel.toLowerCase()) { category = k; break; }
  }
  if (!category) {
    // 容错：模型偶尔写"错字"等近义词
    if (/错别字|错字|typo/i.test(catLabel)) category = "typo";
    else if (/歧义|ambiguity/i.test(catLabel)) category = "ambiguity";
    else if (/标点|punctuation/i.test(catLabel)) category = "punctuation";
    else if (/语病|semantic/i.test(catLabel)) category = "semantic";
    else if (/逻辑|logic/i.test(catLabel)) category = "logic";
    else return null; // 未知类别直接丢弃，避免污染报告
  }

  // 抽两个引号片段："原文" → "建议"
  const quoted = [...trimmed.matchAll(/[“"']([^”"']+)[”"']/g)].map((m) => m[1]);
  if (quoted.length < 2) return null;
  const original = quoted[0];
  const suggestion = quoted[1];

  // 歧义词/逻辑问题可能有括号说明
  const noteMatch = trimmed.match(/[（(]([^）)]+)[）)]\s*$/);
  const note = noteMatch ? noteMatch[1].trim() : "";

  return {
    source: "model",
    category,
    original,
    suggestion,
    note,
    severity: "warning",
    raw: trimmed,
  };
}

// 从整段模型文本中抽取条目行
export function parseModelText(modelText) {
  if (!modelText || typeof modelText !== "string") return [];
  const out = [];
  const lines = modelText.split(/\r?\n/);
  for (const ln of lines) {
    if (!/^[\s\-]*【/.test(ln)) continue; // 只处理条目行
    const parsed = parseModelLine(ln);
    if (parsed) out.push(parsed);
  }
  return out;
}

// 整段是否属于"未发现问题"类表述（用于空结果文案）
export function isCleanModelText(modelText) {
  if (!modelText) return false;
  const t = modelText.trim();
  return /^未发现错误/.test(t) || /^未发现.{0,6}问题/.test(t);
}

// 按原文片段去重，模型层优先级高于规则层；同 source 内按严重度优先
function dedup(all) {
  const byOriginal = new Map(); // original → best entry
  const sevRank = { error: 0, warning: 1, hint: 2 };
  for (const e of all) {
    if (!e.original) continue;
    const prev = byOriginal.get(e.original);
    if (!prev) { byOriginal.set(e.original, e); continue; }
    // 同原文片段：模型层压倒规则层
    if (prev.source !== e.source) {
      if (e.source === "model" && prev.source === "rule") byOriginal.set(e.original, e);
      continue;
    }
    // 同源：严重度更小的优先
    if ((sevRank[e.severity] ?? 1) < (sevRank[prev.severity] ?? 1)) {
      byOriginal.set(e.original, e);
    }
  }
  return [...byOriginal.values()];
}

// 按类别固定顺序排序：错别字 → 歧义词 → 标点 → 语病 → 逻辑
function sortByCategory(lines) {
  const order = ISSUE_CATEGORIES;
  return [...lines].sort((a, b) => {
    const oa = order.indexOf(a.category);
    const ob = order.indexOf(b.category);
    if (oa !== ob) return oa - ob;
    return a.original.localeCompare(b.original, "zh-CN");
  });
}

function buildSummary(counts) {
  return `共发现 ${counts.total} 处问题（其中错别字 ${counts.typo} 处、歧义词 ${counts.ambiguity} 处、标点 ${counts.punctuation} 处、语病 ${counts.semantic} 处、逻辑 ${counts.logic} 处）`;
}

function summarize(lines) {
  const counts = { typo: 0, ambiguity: 0, punctuation: 0, semantic: 0, logic: 0, total: 0 };
  for (const l of lines) counts[l.category] = (counts[l.category] || 0) + 1;
  counts.total = lines.length;
  return counts;
}

function renderReport(lines) {
  if (!lines.length) return "";
  return lines.map((l) => l.raw).join("\n");
}

// 主入口：合并规则层条目与模型层原始文本，产出报告
export function buildReport({ modelText, ruleLines = [] }) {
  const modelLines = parseModelText(modelText);
  const merged = dedup([...ruleLines, ...modelLines]);
  const sorted = sortByCategory(merged);
  const counts = summarize(sorted);
  return {
    lines: sorted,
    counts,
    summary: buildSummary(counts),
    report: renderReport(sorted),
  };
}

// 单独从模型文本生成统计行（模型输出末尾应该有；若无则从条目数算出）
export function summaryFromText(modelText, ruleLineCount = 0) {
  const modelLines = parseModelText(modelText);
  const total = modelLines.length + ruleLineCount;
  const counts = { typo: 0, ambiguity: 0, punctuation: 0, semantic: 0, logic: 0, total };
  for (const l of modelLines) counts[l.category] = (counts[l.category] || 0) + 1;
  return buildSummary(counts);
}