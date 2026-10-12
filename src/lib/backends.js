// 后端适配层：统一"公有云 API"与"公司内网模型"两条通道
// 设计目标：所有后端都归一化为 OpenAI 兼容的调用方式；
// 内网接口若非标准路径/鉴权，通过 baseUrl + 自定义请求头 + 模型名三项配置适配，
// 绝大多数内部推理服务（vLLM / TGI / 网关代理）都提供 OpenAI 兼容端点。

export const DEFAULT_CONFIG = {
  activeBackendId: "deepseek",
  // 敏感数据模式：开启后禁止将文本发送到任何 kind=cloud 的后端
  sensitiveMode: false,
  modelEnabled: true,
  ruleOptions: { space: true, punctuation: true, dediao: true },
  backends: {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      kind: "cloud",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-flash",
      headers: [],
    },
    qwen: {
      id: "qwen",
      name: "通义千问（百炼）",
      kind: "cloud",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "",
      model: "qwen3.5-flash",
      headers: [],
    },
    zhipu: {
      id: "zhipu",
      name: "智谱清言",
      kind: "cloud",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "",
      model: "glm-4-flash",
      headers: [],
    },
    doubao: {
      id: "doubao",
      name: "豆包（火山方舟）",
      kind: "cloud",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "",
      model: "",
      headers: [],
    },
    "custom-cloud": {
      id: "custom-cloud",
      name: "自定义公有云（OpenAI 兼容）",
      kind: "cloud",
      baseUrl: "",
      apiKey: "",
      model: "",
      headers: [],
    },
    internal: {
      id: "internal",
      name: "公司内网模型",
      kind: "internal",
      baseUrl: "",        // 例如 https://llm-gateway.internal.example.com/v1
      apiKey: "",         // 可空：改用下方自定义请求头携带鉴权
      model: "",
      headers: [],        // 例如 [{key:"Authorization", value:"Bearer xxx"}]
    },
  },
};

export async function loadConfig() {
  const stored = await chrome.storage.sync.get("proofreaderConfig");
  if (!stored || !stored.proofreaderConfig) return structuredClone(DEFAULT_CONFIG);
  // 浅合并：保留新增的默认后端
  const cfg = { ...structuredClone(DEFAULT_CONFIG), ...stored.proofreaderConfig };
  cfg.backends = { ...structuredClone(DEFAULT_CONFIG.backends), ...(stored.proofreaderConfig.backends || {}) };
  cfg.ruleOptions = { ...DEFAULT_CONFIG.ruleOptions, ...(stored.proofreaderConfig.ruleOptions || {}) };
  return cfg;
}

export async function saveConfig(cfg) {
  await chrome.storage.sync.set({ proofreaderConfig: cfg });
}

export function getActiveBackend(cfg) {
  const b = cfg.backends[cfg.activeBackendId];
  if (!b) return null;
  return { ...b };
}

// 校验一个后端配置是否可用于发请求
// 每条错误都带上后端名，便于用户判断自己是否填错了卡片
export function validateBackend(b) {
  const errs = [];
  if (!b) return ["尚未选择后端，请在设置页选择一个后端"];
  const tag = `【${b.name || b.id || "当前后端"}】`;
  if (!b.baseUrl) errs.push(`${tag}未填写接口地址（baseUrl）`);
  else if (!/^https?:\/\//.test(b.baseUrl)) errs.push(`${tag}接口地址需以 http:// 或 https:// 开头`);
  if (b.kind === "cloud" && !b.apiKey) errs.push(`${tag}未填写接口密钥（API Key）`);
  if (b.kind === "internal" && !b.apiKey && !(b.headers || []).length)
    errs.push(`${tag}内网后端需要密钥或至少一条自定义鉴权请求头（若服务无需鉴权可加一条占位头）`);
  if (!b.model) errs.push(`${tag}未填写模型名（model）`);
  if (errs.length) errs.push("排查：确认填写的是设置页当前高亮的那个后端，且点击过“保存配置”");
  return errs;
}

// 归一化 baseUrl：去掉尾部斜杠
export function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

// 构造 OpenAI 兼容请求
export function buildChatRequest(backend, messages, { temperature = 0.1, timeoutMs = 60000, signal } = {}) {
  const url = `${normalizeBaseUrl(backend.baseUrl)}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (backend.apiKey) headers["Authorization"] = `Bearer ${backend.apiKey}`;
  for (const h of backend.headers || []) {
    if (h && h.key && h.key.trim()) headers[h.key.trim()] = h.value ?? "";
  }
  const body = JSON.stringify({
    model: backend.model,
    messages,
    temperature,
    stream: false,
  });
  return { url, headers, body, timeoutMs, signal };
}

// 从各家可能的返回形态中提取回复文本
export function extractReplyText(data) {
  try {
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (typeof msg?.content === "string") return msg.content;
    if (Array.isArray(msg?.content)) {
      return msg.content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
    }
    if (choice?.text) return choice.text;
  } catch (_) { /* ignore */ }
  return null;
}

// 从模型输出中稳健地提取 JSON（容忍 markdown 代码块包裹）
export function extractJsonLoose(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}
