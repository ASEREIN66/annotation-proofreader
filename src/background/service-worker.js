// MV3 Service Worker：所有模型请求的唯一出口，并协调"页面面板摘要 + 侧边栏详情"的分工
// 在这里发请求可以绕开页面侧 CORS 限制（需用户已在设置页授权对应站点权限）

import { loadConfig, getActiveBackend, validateBackend, buildChatRequest, extractReplyText } from "../lib/backends.js";
import { buildMessages, buildTestMessages } from "../lib/prompt.js";
import { runRules } from "../lib/rules.js";
import { formatRulesAsLines } from "../lib/rule-format.js";
import { buildReport, isCleanModelText } from "../lib/report.js";

// contextMenus 在扩展重载时不会自动清理已注册的菜单，重复 create 会触发
// chrome.runtime.lastError 警告（不是抛异常，try/catch 抓不到）。
// 必须先 removeAll 再 create，并在 SW 启动、onInstalled、onStartup 三种时机都执行一次。
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    try {
      chrome.contextMenus.create({
        id: "proofread-selection",
        title: "校对选中文本",
        contexts: ["selection"],
      });
    } catch (e) {
      console.warn("[annotation-proofreader] contextMenus.create:", e?.message);
    }
  });
}
setupContextMenu();
chrome.runtime.onInstalled.addListener(() => setupContextMenu());
chrome.runtime.onStartup.addListener(() => setupContextMenu());

// 启动日志：方便排查 SW 是否被正常唤醒
// 在 chrome://extensions → Service Worker 控制台可见
console.log("[annotation-proofreader] SW started, runtime id:", chrome.runtime?.id);

// ---------- 侧边栏行为：双保险确保"点击插件图标 = 打开侧边栏" ----------
// Chrome 116+ 默认 openPanelOnActionClick=true，但不同小版本表现不一致。
// 显式声明 + 显式监听，避免依赖默认行为带来的"点了没反应"。
async function ensureSidePanelBehavior() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (e) { console.warn("[annotation-proofreader] setPanelBehavior:", e?.message); }
}
ensureSidePanelBehavior();
chrome.runtime.onInstalled.addListener(() => ensureSidePanelBehavior());
chrome.runtime.onStartup.addListener(() => ensureSidePanelBehavior());

// 显式监听 action 点击：用户手势由点击事件自带，可直接 open 侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab?.id && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (e) { console.warn("[annotation-proofreader] action.onClicked → sidePanel.open:", e?.message); }
});

// ---------- 模型调用 ----------
async function callModel(cfg, text) {
  const backend = getActiveBackend(cfg);
  if (!backend) throw new Error("未配置任何校对后端，请点击右上角设置进行配置");
  const errs = validateBackend(backend);
  if (errs.length) throw new Error(errs.join("；"));
  if (cfg.sensitiveMode && backend.kind === "cloud") {
    throw new Error("敏感数据模式已开启：文本禁止发往公有云后端。请在设置中切换到公司内网模型。");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const req = buildChatRequest(backend, buildMessages(text), { signal: ctrl.signal });
    const resp = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`后端返回 ${resp.status}：${detail.slice(0, 180)}`);
    }
    const data = await resp.json();
    const reply = extractReplyText(data);
    if (reply == null) throw new Error("后端返回格式无法解析（未找到 choices[0].message.content）");
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

async function testBackend(backend) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const req = buildChatRequest(backend, buildTestMessages(), { signal: ctrl.signal, temperature: 0 });
    const resp = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`返回 ${resp.status}：${detail.slice(0, 180)}`);
    }
    const data = await resp.json();
    const reply = extractReplyText(data);
    return { ok: true, reply: (reply || "").slice(0, 40) };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "请求超时（30秒）" : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 暂存最近一次报告（侧边栏唤起时拉取） ----------
async function saveLastReport(report) {
  await chrome.storage.session.set({ lastProofread: { ...report, at: Date.now() } });
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "PROOFREAD_TEXT") {
      const { text } = msg;
      const cfg = await loadConfig();
      const baseResult = {
        text,
        lines: [],
        counts: { typo: 0, ambiguity: 0, punctuation: 0, semantic: 0, logic: 0, total: 0 },
        summary: "",
        cleanModel: false,
        ruleLineCount: 0,
        modelLineCount: 0,
        modelUsed: false,
        modelEnabled: !!cfg.modelEnabled,
        modelError: null,
        sensitiveBlocked: false,
      };

      // 1) 规则层先跑一遍（离线、零成本）
      let ruleLines = [];
      try {
        const ruleIssues = runRules(text, cfg.ruleOptions);
        ruleLines = formatRulesAsLines(ruleIssues);
        baseResult.ruleLineCount = ruleLines.length;
      } catch (e) {
        console.warn("规则层异常", e);
      }

      // 2) 模型层按配置与敏感模式决定是否调用
      let modelText = "";
      if (cfg.modelEnabled) {
        const backend = getActiveBackend(cfg);
        if (cfg.sensitiveMode && backend?.kind === "cloud") {
          baseResult.sensitiveBlocked = true;
          baseResult.modelError = "敏感数据模式已开启，公有云后端已停用";
        } else {
          baseResult.modelUsed = true;
          try {
            modelText = await callModel(cfg, text);
            baseResult.cleanModel = isCleanModelText(modelText);
          } catch (e) {
            baseResult.modelError = String(e.message || e);
          }
        }
      }

      // 3) 合并规则层与模型层结果
      const report = buildReport({ modelText, ruleLines });
      baseResult.lines = report.lines;
      baseResult.counts = report.counts;
      baseResult.summary = report.summary;
      const modelDerived = Math.max(0, report.lines.length - ruleLines.length);
      baseResult.modelLineCount = baseResult.modelUsed && !baseResult.modelError ? modelDerived : 0;

      // 4) 暂存，供侧边栏唤起时拉取
      await saveLastReport(baseResult);
      sendResponse({ ok: true, ...baseResult });
      return;
    }

    if (msg?.type === "TEST_BACKEND") {
      sendResponse(await testBackend(msg.backend));
      return;
    }

    if (msg?.type === "GET_LATEST") {
      const { lastProofread } = await chrome.storage.session.get("lastProofread");
      sendResponse({ ok: true, report: lastProofread || null });
      return;
    }

    if (msg?.type === "OPEN_SIDE_PANEL") {
      try {
        const tabId = sender.tab?.id;
        if (tabId) await chrome.sidePanel.open({ tabId });
        else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
        return;
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "PROOFREAD_REQUESTED") {
      await chrome.storage.session.set({ pendingProofread: { text: msg.text || "", at: Date.now() } });
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
      } catch (_) { /* 无手势可能失败；侧边栏下次打开时会消费 pendingProofread */ }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "GET_CONFIG") {
      sendResponse({ ok: true, config: await loadConfig() });
      return;
    }

    sendResponse({ ok: false, error: "未知消息类型" });
  })();
  return true; // 异步响应
});