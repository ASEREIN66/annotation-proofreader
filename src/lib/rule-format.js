// 把规则层 issue 列表按"输出格式"包装成结构化条目
// 新旧类型映射：
//   typo → 错别字
//   ambiguity（的得/在再） → 错别字（同音字混用提示）
//   redundancy → 语病（语义重复）
//   format → 标点符号
// 返回的对象结构与后台合并的解析结果一致，便于去重与渲染

import { CATEGORY_LABEL } from "./prompt.js";

const TYPE_TO_CATEGORY = {
  typo: "typo",
  ambiguity: "typo",
  redundancy: "semantic",
  format: "punctuation",
};

// 由规则类型决定建议行的格式（歧义词/逻辑问题需要括号说明，其余直接 X→Y）
export function formatRuleAsLine(rule) {
  const category = TYPE_TO_CATEGORY[rule.type] || "semantic";
  const catLabel = CATEGORY_LABEL[category];
  const original = rule.original || "";
  const suggestion = rule.suggestion || "";
  const note = rule.message || "";
  let raw;
  if (category === "ambiguity" || category === "logic") {
    raw = `- 【${catLabel}】"${original}" → "${suggestion}"（${note}）`;
  } else {
    raw = `- 【${catLabel}】"${original}" → "${suggestion}"`;
  }
  return {
    source: "rule",
    category,
    original,
    suggestion,
    note,
    severity: rule.severity,
    raw,
  };
}

export function formatRulesAsLines(ruleIssues) {
  return ruleIssues.map(formatRuleAsLine);
}