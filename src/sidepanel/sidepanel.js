// 侧边栏：拉取最近一次校对结果，按【五类】分组渲染完整报告
import { CATEGORY_LABEL, ISSUE_CATEGORIES } from "../lib/prompt.js";
import { ruleStats } from "../lib/rules.js";

const $ = (id) => document.getElementById(id);
const inputText = $("inputText");
const btn = $("btnProofread");
const charCount = $("charCount");
const engineStatus = $("engineStatus");
const summary = $("summary");
const results = $("results");
const rulesInfo = $("rulesInfo");

const SEV_LABEL = { error: "错误", warning: "存疑", hint: "提示" };
const CATEGORY_ORDER = ["typo", "ambiguity", "punctuation", "semantic", "logic"];
const CATEGORY_BADGE_CLASS = {
  typo: "badge-typo",
  ambiguity: "badge-ambiguity",
  punctuation: "badge-punctuation",
  semantic: "badge-semantic",
  logic: "badge-logic",
};

let currentConfig = null;
let currentReport = null;

function fmtCharCount() {
  const n = inputText.value.length;
  charCount.textContent = `${n} 字`;
}

inputText.addEventListener("input", fmtCharCount);
fmtCharCount();

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- 顶部状态 ----------
async function renderHeader() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
  currentConfig = resp.config;
  const b = currentConfig.backends[currentConfig.activeBackendId];
  const chip = $("backendChip");
  if (!b || !b.baseUrl) {
    chip.textContent = "后端未配置，点击设置";
    chip.className = "chip chip-err";
  } else {
    chip.textContent = `后端：${b.name}${b.model ? " · " + b.model : ""}`;
    chip.className = "chip chip-ok";
  }
  const sChip = $("sensitiveChip");
  sChip.classList.toggle("hidden", !currentConfig.sensitiveMode);
  const mChip = $("modelChip");
  if (!currentConfig.modelEnabled) {
    mChip.textContent = "模型层关闭（仅规则）";
    mChip.className = "chip chip-warn";
  } else {
    mChip.textContent = "模型层开启";
    mChip.className = "chip";
  }
  const st = ruleStats();
  rulesInfo.textContent = `本地规则引擎 v${st.version}：错别字词条 ${st.typoEntries}，冗余搭配 ${st.redundantEntries} 条`;
}

// ---------- 渲染结果 ----------
function chipClass(sev) {
  return sev === "error" ? "chip-err" : sev === "warning" ? "chip-warn" : "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 空结果文案：依据引擎实际状态精确表述
function emptyMessage(r) {
  if (r.sensitiveBlocked) {
    return "本地规则层与模型层均未发现问题。<p class=\"issue-msg\">注意：敏感数据模式已开启，模型层未参与本次校对。</p>";
  }
  if (r.modelUsed && !r.modelError && r.cleanModel) {
    return "模型层回复：未发现错误。本地规则层也未发现问题。";
  }
  if (r.modelUsed && !r.modelError) {
    return "本地规则层与模型层均已正常校对，未发现任何问题。";
  }
  if (!r.modelEnabled) {
    return "本地规则层未发现问题。<p class=\"issue-msg\">模型层未启用：歧义词、语病、逻辑问题三类本次未覆盖，可在设置中开启。</p>";
  }
  return "本地规则层未发现问题。";
}

// 渲染一条问题卡片
function renderIssueCard(issue) {
  const card = document.createElement("div");
  card.className = `issue sev-${issue.severity || "warning"}`;
  const catLabel = CATEGORY_LABEL[issue.category] || "其他";
  const sevLabel = SEV_LABEL[issue.severity] || "存疑";
  const srcLabel = issue.source === "model" ? "模型层" : "规则层";
  const noteHtml = issue.note ? `<div class="issue-note">${escapeHtml(issue.note)}</div>` : "";
  card.innerHTML = `
    <div class="issue-head">
      <span class="cat-badge ${CATEGORY_BADGE_CLASS[issue.category] || ""}">${escapeHtml(catLabel)}</span>
      <span class="chip ${chipClass(issue.severity)}">${escapeHtml(sevLabel)}</span>
      <span class="src-tag">${escapeHtml(srcLabel)}</span>
    </div>
    <div class="diff">
      <span class="orig"></span><span class="arrow">→</span><span class="sugg"></span>
    </div>
    ${noteHtml}
    <div class="issue-actions">
      <button class="mini-btn act-copy">复制建议</button>
    </div>`;
  card.querySelector(".orig").textContent = issue.original || "";
  card.querySelector(".sugg").textContent = issue.suggestion || "（无建议，请人工确认）";
  card.querySelector(".act-copy").addEventListener("click", async () => {
    const text = issue.suggestion || "";
    await navigator.clipboard.writeText(text);
    const b = card.querySelector(".act-copy");
    b.textContent = "已复制";
    setTimeout(() => (b.textContent = "复制建议"), 1200);
  });
  return card;
}

// 渲染整份报告（按五类分组）
function renderReport(r) {
  results.innerHTML = "";
  summary.innerHTML = "";
  summary.classList.add("hidden");
  currentReport = r;

  // 引擎状态
  if (r.modelUsed && !r.modelError) {
    engineStatus.innerHTML = `<span>✓ 规则层 ${r.ruleLineCount} 处 · 模型层 ${r.modelLineCount} 处（均已校对）</span>`;
  } else if (!r.modelEnabled) {
    engineStatus.innerHTML = `<span>✓ 规则层 ${r.ruleLineCount} 处（模型层未启用）</span>`;
  } else if (r.sensitiveBlocked) {
    engineStatus.innerHTML = `<span>✓ 规则层 ${r.ruleLineCount} 处（敏感模式已停用模型层）</span>`;
  } else {
    engineStatus.innerHTML = `<span>✓ 规则层 ${r.ruleLineCount} 处 · <b style="color:#b42318">模型层调用失败</b></span>`;
  }
  engineStatus.classList.remove("hidden");

  // 模型层失败时，无论有无结果都明确告知
  if (r.modelUsed && r.modelError) {
    const box = document.createElement("div");
    box.className = "error-box";
    box.textContent = `模型层调用失败（以下仅为规则层结果）：${r.modelError}`;
    results.appendChild(box);
  }

  const issues = r.lines || [];
  if (!issues.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.innerHTML = `<div class="ok-icon">✓</div><p>${emptyMessage(r)}</p>`;
    results.appendChild(div);
    return;
  }

  // 顶部摘要条
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <span class="sum-chip">${escapeHtml(r.summary || "")}</span>
    <button id="copyAll" class="mini-btn">复制完整报告</button>`;
  $("copyAll").addEventListener("click", async () => {
    const text = renderReportAsText(r);
    await navigator.clipboard.writeText(text);
    const b = $("copyAll");
    b.textContent = "已复制完整报告";
    setTimeout(() => (b.textContent = "复制完整报告"), 1500);
  });

  // 按类别分组
  for (const cat of CATEGORY_ORDER) {
    const bucket = issues.filter((i) => i.category === cat);
    if (!bucket.length) continue;
    const section = document.createElement("section");
    section.className = "cat-section";
    section.innerHTML = `<div class="cat-head"><span class="cat-badge ${CATEGORY_BADGE_CLASS[cat] || ""}">${escapeHtml(CATEGORY_LABEL[cat])}</span><span class="cat-count">${bucket.length} 处</span></div>`;
    bucket.forEach((issue) => section.appendChild(renderIssueCard(issue)));
    results.appendChild(section);
  }
}

// 把报告渲染成纯文本（复制完整报告用）
function renderReportAsText(r) {
  const out = [];
  const issues = r.lines || [];
  for (const cat of CATEGORY_ORDER) {
    const bucket = issues.filter((i) => i.category === cat);
    for (const it of bucket) {
      const catLabel = CATEGORY_LABEL[it.category];
      if (it.category === "ambiguity" || it.category === "logic") {
        out.push(`- 【${catLabel}】"${it.original}" → "${it.suggestion}"（${it.note || ""}）`);
      } else {
        out.push(`- 【${catLabel}】"${it.original}" → "${it.suggestion}"`);
      }
    }
  }
  out.push("");
  out.push(r.summary || "");
  return out.join("\n");
}

function showError(msg) {
  const box = document.createElement("div");
  box.className = "error-box";
  box.textContent = `校对请求失败：${msg}`;
  results.prepend(box);
}

// ---------- 校对流程 ----------
let running = false;
async function proofread() {
  const text = inputText.value.trim();
  if (!text) { inputText.focus(); return; }
  if (running) return;
  running = true;
  btn.disabled = true;
  engineStatus.classList.remove("hidden");
  engineStatus.innerHTML = `<span class="dot"></span>正在校对：规则层即时扫描 → 模型层深度检查…`;
  results.innerHTML = "";
  summary.classList.add("hidden");

  try {
    const resp = await chrome.runtime.sendMessage({ type: "PROOFREAD_TEXT", text });
    if (!resp?.ok) throw new Error(resp?.error || "未知错误");
    renderReport(resp);
  } catch (e) {
    engineStatus.classList.add("hidden");
    showError(String(e.message || e));
  } finally {
    running = false;
    btn.disabled = false;
  }
}

btn.addEventListener("click", proofread);

// 监听来自页面的消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PROOFREAD_REQUESTED" && msg.text) {
    inputText.value = msg.text;
    fmtCharCount();
    proofread();
  }
  if (msg?.type === "SYNC_TEXT_ONLY" && msg.text) {
    inputText.value = msg.text;
    fmtCharCount();
    // 不重复触发校对；只把已有结果铺出来（如果有）
  }
});

// 启动时：先消费后台暂存的"待校对文本"（右键菜单场景），再拉取最近报告
chrome.storage.session.get("pendingProofread").then(async ({ pendingProofread }) => {
  if (pendingProofread?.text) {
    inputText.value = pendingProofread.text;
    fmtCharCount();
    await chrome.storage.session.remove("pendingProofread");
    proofread();
    return;
  }
  const resp = await chrome.runtime.sendMessage({ type: "GET_LATEST" });
  if (resp?.ok && resp.report) {
    inputText.value = resp.report.text || "";
    fmtCharCount();
    renderReport(resp.report);
  }
});

renderHeader();