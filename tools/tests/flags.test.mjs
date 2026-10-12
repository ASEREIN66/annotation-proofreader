// 引擎状态字段测试：验证 modelEnabled / modelUsed / sensitiveBlocked 在不同配置下取值的正确性
const store = { sync: {}, session: {} };
const listeners = [];
global.chrome = {
  storage: {
    sync: { get: async k => ({[k]: store.sync[k]}), set: async o => Object.assign(store.sync,o) },
    session: { get: async k => ({[k]: store.session[k]}), set: async o => Object.assign(store.session,o), remove: async k=>{delete store.session[k]} },
  },
  runtime: { onInstalled:{addListener(){}}, onStartup:{addListener(){}}, onMessage:{addListener:f=>listeners.push(f)}, sendMessage: async()=>({}), getURL:p=>p, openOptionsPage(){} },
  contextMenus:{create(){},removeAll:(cb)=>cb&&cb(),onClicked:{addListener(){}}}, action:{onClicked:{addListener(){}}},
  sidePanel:{open:async()=>{}}, tabs:{query:async()=>[]}, scripting:{executeScript:async()=>{}}, permissions:{request:async()=>true},
};

// 模拟"模型层回复：未发现错误"
global.fetch = async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: "未发现错误" } }] }),
  text: async () => "",
});
await import("../../src/background/service-worker.js");
const send = m => new Promise(r => listeners[listeners.length-1](m,{},r));

store.sync.proofreaderConfig = {
  activeBackendId: "deepseek", modelEnabled: true, sensitiveMode: false,
  ruleOptions: { space: true, punctuation: true, dediao: true },
  backends: { deepseek: { id:"deepseek", name:"DeepSeek", kind:"cloud", baseUrl:"https://api.deepseek.com/v1", apiKey:"sk-x", model:"deepseek-flash", headers:[] } },
};

console.log("=== 场景 A：模型+规则都跑，未发现问题 ===");
const r = await send({ type: "PROOFREAD_TEXT", text: "这是一段完全正确的文本。" });
console.log("  fields:", { modelEnabled:r.modelEnabled, modelUsed:r.modelUsed, modelError:r.modelError, cleanModel:r.cleanModel, total:r.counts.total });
console.log("  → 摘要:", r.summary);

console.log("\n=== 场景 B：模型层关闭 ===");
store.sync.proofreaderConfig.modelEnabled = false;
const r2 = await send({ type: "PROOFREAD_TEXT", text: "这是一段完全正确的文本。" });
console.log("  fields:", { modelEnabled:r2.modelEnabled, modelUsed:r2.modelUsed });
console.log("  → 摘要:", r2.summary);

console.log("\n=== 场景 C：敏感模式 + 公有云 ===");
store.sync.proofreaderConfig.sensitiveMode = true;
store.sync.proofreaderConfig.modelEnabled = true;
const r3 = await send({ type: "PROOFREAD_TEXT", text: "这是一段完全正确的文本。" });
console.log("  fields:", { sensitiveBlocked:r3.sensitiveBlocked, modelError:r3.modelError });
console.log("  → 摘要:", r3.summary);

console.log("\n=== 场景 D：规则命中、模型未发现错误 ===");
store.sync.proofreaderConfig.sensitiveMode = false;
const r4 = await send({ type: "PROOFREAD_TEXT", text: "他时侯再处理这项工程，因该马上按装。" });
console.log("  fields:", { ruleLineCount:r4.ruleLineCount, modelLineCount:r4.modelLineCount, cleanModel:r4.cleanModel, total:r4.counts.total });
console.log("  → 摘要:", r4.summary);
console.log("  → lines:");
for (const l of r4.lines) console.log(`     [${l.category}|${l.source}] ${l.original} → ${l.suggestion}`);