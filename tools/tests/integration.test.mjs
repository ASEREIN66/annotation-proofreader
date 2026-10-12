// 集成冒烟测试：用 stub 模拟 chrome API 与模型后端，跑通整条消息链路
// 适配新的"按格式输出"协议：lines / counts / summary / ruleLineCount / modelLineCount

const listeners = [];
const store = { sync: {}, session: {} };

const calls = { sidePanelOpen: 0, lastTabId: null };

global.chrome = {
  storage: {
    sync: {
      get: async (k) => ({ [k]: store.sync[k] }),
      set: async (o) => Object.assign(store.sync, o),
    },
    session: {
      get: async (k) => ({ [k]: store.session[k] }),
      set: async (o) => Object.assign(store.session, o),
      remove: async (k) => { delete store.session[k]; },
    },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage: async () => ({}),
    getURL: (p) => `chrome-extension://test/${p}`,
    openOptionsPage: () => {},
  },
  contextMenus: { create: () => {}, removeAll: (cb) => cb && cb(), onClicked: { addListener: () => {} } },
  action: { onClicked: { addListener: () => {} } },
  sidePanel: {
    open: async (opts) => { calls.sidePanelOpen++; calls.lastTabId = opts?.tabId ?? null; return; },
  },
  tabs: { query: async () => [{ id: 42 }] },
  scripting: { executeScript: async () => {} },
  permissions: { request: async () => true },
};

let lastRequest = null;
let fakeModelContent = '```json\n{"issues":[{"type":"semantic","original":"语义重复的短语","suggestion":"精简版","message":"成分冗余","severity":"warning","excerpt":"这里语义重复的短语出现了"}]}\n```';
global.fetch = async (url, opts) => {
  lastRequest = { url, opts };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: fakeModelContent } }],
    }),
    text: async () => "",
  };
};

await import("../../src/background/service-worker.js");

const send = (msg, sender = {}) =>
  new Promise((resolve) => {
    const done = (r) => resolve(r);
    listeners[listeners.length - 1](msg, sender, done);
  });

const TEXT = "这里因该按装软件，语义重复的短语出现了。";

console.log("=== 场景 1：未配置密钥 ===");
let r = await send({ type: "PROOFREAD_TEXT", text: TEXT });
console.log("ok:", r.ok, "| modelError:", r.modelError);
console.log("ruleLineCount:", r.ruleLineCount, "| modelLineCount:", r.modelLineCount);
console.log("lines:", r.lines.map((l) => `${l.category}:${l.original}→${l.suggestion}`));
console.log("summary:", r.summary);

console.log("\n=== 场景 2：配密钥 + 模型按新协议返回（按格式输出）===");
fakeModelContent = `- 【错别字】"语义重复的短语" → "精简版"
- 【歧义词】"时态混乱" → "时态清晰"（语境下"时态混乱"易误解为时间问题）
- 【语病】"应该" → "应当"（与前文重复使用）
共发现 3 处问题（其中错别字 1 处、歧义词 1 处、标点 0 处、语病 1 处、逻辑 0 处）`;

store.sync.proofreaderConfig = {
  activeBackendId: "deepseek",
  modelEnabled: true,
  sensitiveMode: false,
  ruleOptions: { space: true, punctuation: true, dediao: true },
  backends: {
    deepseek: {
      id: "deepseek", name: "DeepSeek", kind: "cloud",
      baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-flash", headers: [],
    },
  },
};
r = await send({ type: "PROOFREAD_TEXT", text: TEXT });
console.log("请求地址:", lastRequest.url);
console.log("Authorization:", lastRequest.opts.headers.Authorization);
console.log("counts:", JSON.stringify(r.counts));
console.log("lines:");
for (const l of r.lines) console.log(`  [${l.category}|${l.source}] ${l.original} → ${l.suggestion}${l.note ? "（" + l.note + "）" : ""}`);
console.log("summary:", r.summary);

console.log("\n=== 场景 3：敏感数据模式 + 公有云（应拦截）===");
store.sync.proofreaderConfig.sensitiveMode = true;
r = await send({ type: "PROOFREAD_TEXT", text: TEXT });
console.log("sensitiveBlocked:", r.sensitiveBlocked, "| modelError:", r.modelError);
console.log("modelUsed:", r.modelUsed, "| ruleLineCount:", r.ruleLineCount);

console.log("\n=== 场景 4：敏感模式 + 内网（应放行）===");
store.sync.proofreaderConfig.backends.internal = {
  id: "internal", name: "公司内网模型", kind: "internal",
  baseUrl: "https://llm-gateway.internal.example.com/v1/",
  apiKey: "", model: "hunyuan-internal",
  headers: [{ key: "Authorization", value: "Bearer internal-token" }],
};
store.sync.proofreaderConfig.activeBackendId = "internal";
r = await send({ type: "PROOFREAD_TEXT", text: TEXT });
console.log("请求地址:", lastRequest.url);
console.log("自定义鉴权头:", lastRequest.opts.headers.Authorization);
console.log("sensitiveBlocked:", r.sensitiveBlocked);

console.log("\n=== 场景 5：PROOFREAD_REQUESTED → 暂存 ===");
r = await send({ type: "PROOFREAD_REQUESTED" }, { tab: { id: 42 } });
console.log("ok:", r.ok, "| sidePanelOpen calls:", calls.sidePanelOpen, "| tabId:", calls.lastTabId);
console.log("暂存:", store.session.pendingProofread);

console.log("\n=== 场景 6：OPEN_SIDE_PANEL 唤起 ===");
calls.sidePanelOpen = 0; calls.lastTabId = null;
r = await send({ type: "OPEN_SIDE_PANEL" }, { tab: { id: 99 } });
console.log("ok:", r.ok, "| sidePanelOpen calls:", calls.sidePanelOpen, "| tabId:", calls.lastTabId);

console.log("\n=== 场景 7：GET_LATEST 拉取最近报告 ===");
r = await send({ type: "GET_LATEST" });
console.log("ok:", r.ok, "| has report:", !!r.report, "| summary:", r.report?.summary);

console.log("\n=== 场景 8：TEST_BACKEND ===");
console.log(await send({ type: "TEST_BACKEND", backend: store.sync.proofreaderConfig.backends.internal }));