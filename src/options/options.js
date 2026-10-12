// 设置页：后端双通道配置、敏感模式、规则选项
import { loadConfig, saveConfig, normalizeBaseUrl, validateBackend } from "../lib/backends.js";
import { ruleStats } from "../lib/rules.js";

const $ = (id) => document.getElementById(id);
let cfg = null;
let selectedId = null;

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 1800);
}

// ---------- 后端选择 ----------
function renderBackendList() {
  const list = $("backendList");
  list.innerHTML = "";
  const active = cfg.backends[selectedId];
  const ready = active && !validateBackend(active).length;
  $("activeBackendNote").innerHTML =
    `当前生效：<b>${active ? active.name : "未选择"}</b>` +
    `（${active?.kind === "cloud" ? "公有云" : "内网"}）` +
    ` · ${ready ? "<span class='state-ok'>配置完整</span>" : "<span class='state-bad'>配置不完整，填写后需点击“保存配置”</span>"}`;
  for (const b of Object.values(cfg.backends)) {
    const el = document.createElement("div");
    el.className = "backend-item" + (b.id === selectedId ? " active" : "");
    el.innerHTML = `${b.name}<span class="kind kind-${b.kind}">${b.kind === "cloud" ? "公有云" : "内网"}</span>`;
    el.addEventListener("click", () => {
      // 先保存当前表单再切换
      collectFormInto(cfg.backends[selectedId]);
      selectedId = b.id;
      renderBackendList();
      fillForm(b);
    });
    list.appendChild(el);
  }
}

function fillForm(b) {
  $("f_baseUrl").value = b.baseUrl || "";
  $("f_apiKey").value = b.apiKey || "";
  $("f_model").value = b.model || "";
  renderHeaderRows(b.headers || []);
}

function renderHeaderRows(headers) {
  const box = $("headerRows");
  box.innerHTML = "";
  headers.forEach((h, idx) => {
    const row = document.createElement("div");
    row.className = "header-row";
    row.innerHTML = `<input type="text" placeholder="请求头名称，如 Authorization" />` +
      `<input type="text" placeholder="值，如 Bearer xxx" />` +
      `<button class="del" title="删除">✕</button>`;
    row.children[0].value = h.key || "";
    row.children[1].value = h.value || "";
    row.querySelector(".del").addEventListener("click", () => {
      headers.splice(idx, 1);
      renderHeaderRows(headers);
    });
    box.appendChild(row);
  });
}

$("addHeader").addEventListener("click", () => {
  const b = cfg.backends[selectedId];
  if (!b) return;
  b.headers = b.headers || [];
  b.headers.push({ key: "", value: "" });
  renderHeaderRows(b.headers);
});

function collectFormInto(b) {
  if (!b) return;
  b.baseUrl = normalizeBaseUrl($("f_baseUrl").value);
  b.apiKey = $("f_apiKey").value.trim();
  b.model = $("f_model").value.trim();
  // headers 从 DOM 收集
  const rows = [...$("headerRows").querySelectorAll(".header-row")];
  b.headers = rows.map((r) => ({
    key: r.children[0].value.trim(),
    value: r.children[1].value,
  })).filter((h) => h.key);
}

// ---------- 权限 ----------
async function grantPermission() {
  const url = normalizeBaseUrl($("f_baseUrl").value);
  if (!/^https?:\/\//.test(url)) { toast("请先填写正确的接口地址"); return; }
  const origin = new URL(url).origin;
  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    toast(granted ? `已授权访问 ${origin}` : "未授权，模型请求可能被浏览器拦截");
  } catch (e) {
    toast("授权失败：" + (e.message || e));
  }
}

// ---------- 连通性测试 ----------
async function testConnection() {
  collectFormInto(cfg.backends[selectedId]);
  const b = cfg.backends[selectedId];
  const errs = validateBackend(b);
  const box = $("testResult");
  box.classList.remove("hidden", "ok", "fail");
  if (errs.length) {
    box.classList.add("fail");
    box.textContent = "配置不完整：" + errs.join("；");
    return;
  }
  box.classList.add("ok");
  box.textContent = "正在测试连接（最长等待 30 秒）…";
  const resp = await chrome.runtime.sendMessage({ type: "TEST_BACKEND", backend: b });
  if (resp?.ok) {
    box.classList.add("ok");
    // 测试通过即视为配置可用，直接落盘，避免"测通了但没保存"的陷阱
    const saved = await persist();
    box.textContent = `连接成功，模型已响应：${resp.reply || "（空回复）"}。配置已保存并生效于「${saved.name}」。`;
  } else {
    box.classList.add("fail");
    box.textContent = `连接失败：${resp?.error || "未知错误"}。若为网络拦截类错误，请先点击"授权该站点访问"。`;
  }
}

// ---------- 保存 ----------
async function persist() {
  collectFormInto(cfg.backends[selectedId]);
  cfg.activeBackendId = selectedId;
  cfg.modelEnabled = $("modelEnabled").checked;
  cfg.sensitiveMode = $("sensitiveMode").checked;
  cfg.ruleOptions = {
    space: $("opt_space").checked,
    punctuation: $("opt_punctuation").checked,
    dediao: $("opt_dediao").checked,
  };
  try {
    await saveConfig(cfg);
  } catch (e) {
    toast("保存失败：" + (e.message || e));
    throw e;
  }
  // 落盘后回读校验：若回读结果仍不完整，明确告知，避免"以为存上了其实没有"
  const reread = await loadConfig();
  const persisted = reread.backends[reread.activeBackendId];
  const errs = validateBackend(persisted);
  if (errs.length) {
    toast(`落盘校验未通过：${errs[0]}`);
    cfg = reread; // 以真实落盘结果为准渲染状态行
  }
  renderBackendList(); // 立刻刷新顶部状态行，避免显示过期的"配置不完整"
  return cfg.backends[selectedId];
}

async function save() {
  const b = await persist();
  toast(`已保存：当前生效后端「${b.name}」`);
  if (cfg.sensitiveMode && b.kind === "cloud") {
    toast("注意：敏感数据模式下公有云后端不会生效，请切换到内网后端");
  }
}

// ---------- 初始化 ----------
async function init() {
  cfg = await loadConfig();
  selectedId = cfg.activeBackendId || Object.keys(cfg.backends)[0];
  $("modelEnabled").checked = cfg.modelEnabled;
  $("sensitiveMode").checked = cfg.sensitiveMode;
  $("opt_space").checked = cfg.ruleOptions.space;
  $("opt_punctuation").checked = cfg.ruleOptions.punctuation;
  $("opt_dediao").checked = cfg.ruleOptions.dediao;
  renderBackendList();
  fillForm(cfg.backends[selectedId]);

  const st = ruleStats();
  $("ruleStats").textContent = `本地规则引擎 v${st.version}：错别字词条 ${st.typoEntries} 条，冗余搭配 ${st.redundantEntries} 条，随版本更新扩充。`;
}

$("grantPermission").addEventListener("click", grantPermission);
$("testBackend").addEventListener("click", testConnection);
$("saveBackend").addEventListener("click", save);

// 有未保存改动时，关闭页面前提醒
let dirty = false;
document.addEventListener("input", () => { dirty = true; });
document.addEventListener("change", () => { dirty = true; });
window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});
// 保存与测试后重置标记
["saveBackend", "testBackend"].forEach((id) =>
  $(id).addEventListener("click", () => { dirty = false; })
);

init();
