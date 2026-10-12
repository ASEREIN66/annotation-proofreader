import { runRules, ruleStats } from "../../src/lib/rules.js";

const samples = [
  "他在说了一遍之后，因该马上按装软件，居然迫不急待地跑的很快。",
  "这个方案获得了凯旋而归，产品免费赠送给用户体验，涉及到了多个部门。",
  "报名截止日期是２０２６年１０月１日,请大家踊跃参加。所谓的鬼鬼崇崇行为不可取。",
  "慢慢来，不了了之也没办法，他时侯再处理这项峻工的工程。",
  "A lightweight mobile app for content review,支持Android和iOS系统。",
];

for (const s of samples) {
  console.log("原文:", s);
  const issues = runRules(s);
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.type} @${i.start}-${i.end} "${i.original}" -> "${i.suggestion}" ${i.message}`);
  }
  console.log("  共", issues.length, "处");
}
console.log(ruleStats());
