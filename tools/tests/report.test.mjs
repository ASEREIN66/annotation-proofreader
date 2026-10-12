// 报告合并 + 解析的单测
import { runRules } from "../../src/lib/rules.js";
import { formatRulesAsLines } from "../../src/lib/rule-format.js";
import { buildReport, parseModelText, isCleanModelText } from "../../src/lib/report.js";

// ===== 1. 规则层格式化 =====
const ruleIssues = runRules("这个方案因该马上按装，因该处理。所谓的鬼鬼崇崇行为不可取。");
const lines = formatRulesAsLines(ruleIssues);
console.log("规则层格式化输出:");
for (const l of lines) {
  console.log(`  [${l.source}] ${l.category} | ${l.original} → ${l.suggestion}`);
  console.log(`    raw: ${l.raw}`);
}

// ===== 2. 模型层解析（含容错） =====
const modelText = `- 【错别字】"按装" → "安装"
- 【歧义词】"权利" → "权力"（在治理语境下"权利"指个人权益，与"权力"易混）
- 【标点符号】"中文，english." → "中文，english。"
- 【语病】"凯旋而归" → "凯旋"
- 【逻辑问题】"因为下雨所以没带伞" → 因果关系与时序矛盾，建议改为 "因为下雨，所以没带伞"
未发现其他错误

共发现 5 处问题（其中错别字 1 处、歧义词 1 处、标点 1 处、语病 1 处、逻辑 1 处）`;

const parsed = parseModelText(modelText);
console.log("\n模型层解析:");
for (const l of parsed) {
  console.log(`  [${l.category}] "${l.original}" → "${l.suggestion}" note="${l.note}"`);
}
console.log("cleanModel:", isCleanModelText(modelText));

// ===== 3. 容错：模型偶尔写"错字"近义词 / 多空格 =====
const messy = `- 【错字】"以身作责" → "以身作则"
- 【 标点符号 】"你好," → "你好，"（说明）`;
console.log("\n容错解析 messy:");
for (const l of parseModelText(messy)) console.log(`  [${l.category}] "${l.original}" → "${l.suggestion}"`);

// ===== 4. 合并 + 去重：同原文片段规则层与模型层冲突 =====
const ruleLines2 = formatRulesAsLines(runRules("这个工程已经按装完毕，需要马上竣工。"));
const merged = buildReport({
  modelText: `- 【错别字】"按装" → "安装"`,
  ruleLines: ruleLines2,
});
console.log("\n合并结果:");
for (const l of merged.lines) console.log(`  [${l.category}|${l.source}] ${l.original} → ${l.suggestion}`);
console.log("summary:", merged.summary);
console.log("counts:", JSON.stringify(merged.counts));

// ===== 5. 空报告 =====
const empty = buildReport({ modelText: "未发现错误", ruleLines: [] });
console.log("\n空报告 lines.length:", empty.lines.length);
console.log("empty summary:", empty.summary);

// ===== 6. 干净模型 + 规则命中 =====
const allClean = buildReport({
  modelText: "未发现错误，这段文本完全通顺。",
  ruleLines: formatRulesAsLines(runRules("他时侯再处理这项工程。")),
});
console.log("allClean summary:", allClean.summary);
console.log("counts:", JSON.stringify(allClean.counts));