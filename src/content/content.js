// 内容脚本：选中文本 → 浮动"校对"按钮 → 页面内弹出简版结果
// 关键设计：Shadow DOM 与 stale-hint UI 在 try 块外面提前建好。
// 这样即使内部访问 chrome.runtime 时抛"Extension context invalidated"
// （Chrome 把这种错误标记为 unchecked，普通 try/catch 也无法捕获），
// catch 块依然能展示"请刷新页面"的提示。
// 注意：Extension context invalidated 在旧版 Chrome 上是 unchecked error，
// 整个 IIFE 必须用 try/catch 兜底，单点 try/catch 不可靠。

(() => {
  if (window.__apProofInjected) return;
  window.__apProofInjected = true;

  // ---------- Shadow DOM 宿主（提到 try 块外面，确保 catch 能用） ----------
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; }
  .fab {
    position: fixed; pointer-events: auto;
    padding: 5px 14px; background: #2563eb; color: #fff;
    font: 13px/1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    border-radius: 999px; cursor: pointer; user-select: none;
    box-shadow: 0 4px 14px rgba(37,99,235,.35);
  }
  .fab:hover { background: #1d4ed8; }
  .fab.busy { background: #64748b; }

  .panel {
    position: fixed; pointer-events: auto; width: 320px; max-width: 92vw;
    background: #fff; color: #1f2937;
    border: 1px solid #e5e7eb; border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15,23,42,.18);
    font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: 12px 14px;
  }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .panel-title { font-weight: 500; font-size: 14px; }
  .close { border: none; background: transparent; cursor: pointer; font-size: 16px; color: #6b7280; }
  .engine { margin-top: 6px; font-size: 12px; color: #6b7280; }
  .engine .ok { color: #137333; }
  .engine .bad { color: #b42318; }

  .summary {
    margin-top: 10px; padding: 10px 12px; border-radius: 10px;
    background: #f9fafb; border: 1px solid #eef2f7;
    font-size: 13px; color: #1f2937;
  }
  .summary.empty { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
  .summary.has { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }

  .detail-link {
    display: inline-block; margin-top: 8px;
    font-size: 13px; color: #2563eb; cursor: pointer;
    text-decoration: underline; user-select: none;
  }
  .detail-link:hover { color: #1d4ed8; }
  .detail-link.disabled { color: #9ca3af; cursor: default; text-decoration: none; }

  .errbar {
    margin-top: 10px; padding: 8px 10px; border-radius: 8px;
    background: #fdeaea; color: #b42318; border: 1px solid #f5c2c2; font-size: 12px;
    line-height: 1.6;
  }
  .errbar b { color: #7a1414; }

  .acts { margin-top: 8px; display: flex; gap: 6px; }
  .acts button {
    font-size: 12px; padding: 4px 12px; border-radius: 8px;
    border: 1px solid #2563eb; background: #2563eb; color: #fff; cursor: pointer;
  }
  .acts button:hover { background: #1d4ed8; }

  .toast {
    position: fixed; pointer-events: none; left: 50%; bottom: 40px; transform: translateX(-50%);
    background: rgba(17,24,39,.92); color: #f9fafb; padding: 9px 18px; border-radius: 10px;
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 70vw;
  }
  [hidden] { display: none !important; }
</style>
<div class="fab" hidden>校对</div>
<div class="panel" hidden></div>
<div class="toast" hidden></div>`;

  const fab = shadow.querySelector(".fab");
  const panel = shadow.querySelector(".panel");
  const toastEl = shadow.querySelector(".toast");

  function placePanel(rect) {
    const h = Math.min(panel.offsetHeight || 140, window.innerHeight * 0.6);
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - 340));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  // "扩展已失效"提示：在 try 块外定义，确保 catch 能用
  function showStaleHint(rect) {
    try {
      panel.innerHTML = `
        <div class="panel-head">
          <span class="panel-title">扩展已更新</span>
          <button class="close">✕</button>
        </div>
        <div class="errbar">
          本页加载的是旧版插件代码。请按 <b>Ctrl/Cmd + R</b> 刷新此页面后再校对。
          <div class="acts"><button data-a="reload">立即刷新页面</button></div>
        </div>`;
      panel.hidden = false;
      placePanel(rect || { bottom: 80, top: 0, left: 0, width: 0 });
      panel.querySelector(".close").addEventListener("click", () => (panel.hidden = true));
      panel.querySelector('[data-a="reload"]').addEventListener("click", () => location.reload());
    } catch (_) { /* swallow */ }
  }

  // ---------- 主逻辑放在 try 里：任何同步 unchecked error 都能被 catch ----------
  try {
    const SEL_MIN_LEN = 2;
    let fabTimer = null;

    function toast(msg, ms = 2400) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      setTimeout(() => (toastEl.hidden = true), ms);
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
      );
    }

    function getSelectionInfo() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      const text = sel.toString().trim();
      if (text.length < SEL_MIN_LEN) return null;
      return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
    }

    function showFab(rect) {
      fab.hidden = false;
      fab.classList.remove("busy");
      fab.textContent = "校对";
      const top = Math.min(Math.max(rect.bottom + 8, 8), window.innerHeight - 40);
      const left = Math.min(Math.max(rect.left + rect.width / 2 - 28, 8), window.innerWidth - 72);
      fab.style.top = `${top}px`;
      fab.style.left = `${left}px`;
    }
    function hideFab() { fab.hidden = true; }

    document.addEventListener("mouseup", (e) => {
      if (e.target === host) return;
      clearTimeout(fabTimer);
      fabTimer = setTimeout(() => {
        const info = getSelectionInfo();
        if (info) showFab(info.rect);
        else hideFab();
      }, 120);
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Escape") { hideFab(); panel.hidden = true; }
      const info = getSelectionInfo();
      if (info && (e.shiftKey || e.key.startsWith("Arrow"))) showFab(info.rect);
    });
    window.addEventListener("scroll", () => hideFab(), { passive: true });

    function engineLine(r) {
      if (r.modelUsed && !r.modelError) {
        return `<span class="ok">✓ 规则层 + 模型层均已校对</span>`;
      }
      if (!r.modelEnabled) {
        return `仅本地规则层完成校对 · 模型层未启用`;
      }
      if (r.sensitiveBlocked) {
        return `仅本地规则层完成校对 · 敏感模式已停用模型层`;
      }
      return `仅本地规则层完成校对 · <span class="bad">模型层调用失败</span>`;
    }

    function renderPanel(r, rect) {
      const hasIssues = r.counts && r.counts.total > 0;
      const summaryClass = hasIssues ? "has" : "empty";
      const summaryText = r.summary || "（摘要生成失败）";
      const canOpen = !!r.modelUsed || !!r.lines?.length || !!r.ruleLineCount || r.sensitiveBlocked;

      let html = `
        <div class="panel-head">
          <span class="panel-title">标注校对结果</span>
          <button class="close" title="关闭">✕</button>
        </div>
        <div class="engine">${engineLine(r)}</div>
        <div class="summary ${summaryClass}">${escapeHtml(summaryText)}</div>
        <a class="detail-link ${canOpen ? "" : "disabled"}" data-act="open">查看详情 →</a>`;

      if (r.modelUsed && r.modelError) {
        html += `<div class="errbar">模型层调用失败：${escapeHtml(r.modelError)}</div>`;
      }

      panel.innerHTML = html;
      panel.hidden = false;
      placePanel(rect);

      panel.querySelector(".close").addEventListener("click", () => (panel.hidden = true));
      const link = panel.querySelector(".detail-link");
      if (!link.classList.contains("disabled")) {
        link.addEventListener("click", async (e) => {
          e.preventDefault();
          link.classList.add("disabled");
          link.textContent = "正在打开侧边栏…";
          try {
            const resp = await chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
            if (!resp?.ok) throw new Error(resp?.error || "唤起失败");
            link.textContent = "已打开侧边栏 ✓";
            setTimeout(() => (link.textContent = "查看详情 →"), 1500);
          } catch (err) {
            link.classList.remove("disabled");
            link.textContent = "查看详情 →";
            if (/context invalidated/i.test(String(err.message || err))) {
              showStaleHint(rect);
            } else {
              toast("无法唤起侧边栏：" + String(err.message || err));
            }
          }
        });
      }
    }

    // ---------- 触发校对 ----------
    fab.addEventListener("mousedown", (e) => e.stopPropagation());
    fab.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const info = getSelectionInfo();
      if (!info) return;
      const text = info.text;
      const rect = info.rect;

      fab.classList.add("busy");
      fab.textContent = "校对中…";
      panel.hidden = true;
      try {
        const r = await chrome.runtime.sendMessage({ type: "PROOFREAD_TEXT", text });
        if (!r?.ok) throw new Error(r?.error || "未知错误");
        renderPanel(r, rect);
        chrome.runtime.sendMessage({ type: "SYNC_TEXT_ONLY", text }).catch(() => {});
      } catch (err) {
        const msg = String(err.message || err);
        if (/context invalidated/i.test(msg)) {
          showStaleHint(rect);
        } else {
          panel.innerHTML = `<div class="panel-head"><span class="panel-title">校对失败</span><button class="close">✕</button></div>
            <div class="errbar">${escapeHtml(msg)}</div>`;
          panel.hidden = false;
          placePanel(rect);
          panel.querySelector(".close").addEventListener("click", () => (panel.hidden = true));
        }
      } finally {
        fab.classList.remove("busy");
        fab.textContent = "校对";
      }
    });

    // 接收后台消息
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "PING_CONTENT") {
        sendResponse({ ok: true });
      }
    });

  } catch (e) {
    // 主逻辑任一处抛 Extension context invalidated 或其他 unchecked error 都到这
    // 重置标志位，让用户刷新页面后能重新注入
    try {
      const msg = String((e && e.message) || e || "");
      if (/context invalidated|invalidate/i.test(msg)) {
        showStaleHint({ bottom: 80, top: 0, left: 0, width: 0 });
      }
    } catch (_) { /* swallow */ }
    window.__apProofInjected = false;
  }
})();