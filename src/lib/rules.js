// 本地规则引擎：离线、零成本，只报高置信问题
// 原则：宁可漏报，不可误报——语义类问题交给模型层
// 问题类型：typo(错别字) | ambiguity(字词用法) | redundancy(语义冗余) | format(格式)

export const RULES_VERSION = "2026-10-10.1";

// ============ 1. 错别字词典（错 → 对） ============
// 覆盖输入法高频错误，均为确定性替换
export const TYPO_MAP = new Map([
  ["按装", "安装"], ["布署", "部署"], ["迫不急待", "迫不及待"],
  ["一如继往", "一如既往"], ["甘败下风", "甘拜下风"], ["一愁莫展", "一筹莫展"],
  ["穿流不息", "川流不息"], ["蜂涌而至", "蜂拥而至"], ["鬼鬼崇崇", "鬼鬼祟祟"],
  ["悬梁刺骨", "悬梁刺股"], ["貌和神离", "貌合神离"], ["出奇不意", "出其不意"],
  ["谈笑风声", "谈笑风生"], ["委屈求全", "委曲求全"], ["饮鸠止渴", "饮鸩止渴"],
  ["世外桃园", "世外桃源"], ["消声匿迹", "销声匿迹"], ["忧柔寡断", "优柔寡断"],
  ["不径而走", "不胫而走"], ["竭泽而鱼", "竭泽而渔"], ["滥芋充数", "滥竽充数"],
  ["草管人命", "草菅人命"], ["病入膏盲", "病入膏肓"], ["相形见拙", "相形见绌"],
  ["挺而走险", "铤而走险"], ["相辅相承", "相辅相成"], ["珊珊来迟", "姗姗来迟"],
  ["一枕黄梁", "一枕黄粱"], ["天翻地复", "天翻地覆"], ["水乳交溶", "水乳交融"],
  ["旁证博引", "旁征博引"], ["寻规蹈矩", "循规蹈矩"], ["互相推委", "互相推诿"],
  ["换然一新", "焕然一新"], ["弱不经风", "弱不禁风"], ["迫在眉捷", "迫在眉睫"],
  ["变本加利", "变本加厉"], ["因才施教", "因材施教"], ["无耻烂言", "无耻谰言"],
  ["心恢意冷", "心灰意冷"], ["言简意骇", "言简意赅"], ["记忆尤新", "记忆犹新"],
  ["脍灸人口", "脍炙人口"], ["前扑后继", "前仆后继"], ["一股作气", "一鼓作气"],
  ["欢渡春节", "欢度春节"], ["老声常谈", "老生常谈"],
  ["破斧沉舟", "破釜沉舟"], ["别出心栽", "别出心裁"], ["兴高彩烈", "兴高采烈"],
  ["走头无路", "走投无路"], ["变换莫测", "变幻莫测"], ["出类拨萃", "出类拔萃"],
  ["不可思义", "不可思议"],   ["做为", "作为"],
  ["既使", "即使"], ["因该", "应该"],
  ["竟争", "竞争"], ["侯选", "候选"], ["等侯", "等候"],
  ["时侯", "时候"], ["问侯", "问候"], ["气侯", "气候"],
  ["坐位", "座位"], ["拼博", "拼搏"], ["脉博", "脉搏"],
  ["气慨", "气概"], ["祟拜", "崇拜"], ["祟高", "崇高"],
  ["作崇", "作祟"], ["震憾", "震撼"], ["遗撼", "遗憾"],
  ["苍桑", "沧桑"], ["题纲", "提纲"],
  ["复盖", "覆盖"], ["颠复", "颠覆"], ["脏款", "赃款"],
  ["脏物", "赃物"], ["贪脏枉法", "贪赃枉法"], ["编篡", "编纂"],
  ["燃后", "然后"], ["渡假", "度假"],
  ["报歉", "抱歉"], ["抱欠", "抱歉"], ["凑和", "凑合"],
  ["好象", "好像"], ["图象", "图像"], ["录象", "录像"],
  ["峻工", "竣工"], ["精减", "精简"], ["恰谈", "洽谈"],
  ["按排", "安排"],
  ["换起", "唤起"], ["换发", "焕发"],
  ["报导", "报道"], ["其它", "其他"],
  ["爆躁", "暴躁"], ["干躁", "干燥"], ["浮浅", "肤浅"],
  ["帐号", "账号"], ["帐户", "账户"],
]);

// ============ 2. 语义冗余搭配（成分堆叠） ============
export const REDUNDANT = [
  { m: "凯旋而归", s: "凯旋", why: "“凯旋”本身已含“胜利归来”之义，“而归”语义重复" },
  { m: "凯旋归来", s: "凯旋", why: "“凯旋”已含“归来”之义" },
  { m: "免费赠送", s: "赠送", why: "“赠送”本身即不收费，“免费”冗余" },
  { m: "亲眼目睹", s: "目睹", why: "“目睹”即亲眼看见，“亲眼”冗余" },
  { m: "报刊杂志", s: "报刊或杂志", why: "“报刊”已含报纸和杂志，与“杂志”并列重复" },
  { m: "十分酷爱", s: "酷爱", why: "“酷爱”已含程度极深，不能再受“十分”修饰" },
  { m: "过度酗酒", s: "酗酒", why: "“酗酒”本身即指无节制饮酒，“过度”冗余" },
  { m: "可以堪称", s: "堪称", why: "“堪”即“可以”，二者不能连用" },
  { m: "第一次首创", s: "首创", why: "“首创”即第一次创造，“第一次”冗余" },
  { m: "提前预告", s: "预告", why: "“预告”本身即提前告知，语义重复" },
  { m: "独自窃笑", s: "窃笑", why: "“窃”即私下、暗地里，与“独自”重复" },
  { m: "付诸于", s: "付诸", why: "“诸”即“之于”，再加“于”语义重复" },
  { m: "涉及到", s: "涉及", why: "“涉及”已含“到”，再加“到”冗余" },
  { m: "被应邀", s: "应邀", why: "“应邀”本身即被动含义，不需要“被”" },
  { m: "忍俊不禁地笑", s: "忍俊不禁", why: "“忍俊不禁”即忍不住发笑，后接“笑”重复" },
  { m: "难言之隐的苦衷", s: "难言之隐", why: "“隐”即苦衷，语义重复" },
];

// 大约…左右 / 约…左右 搭配
const APPROX_PATTERNS = [
  { re: /(?:大约|约|大概|近|超过)\s*([\d一二两三四五六七八九十百千万零点]+)\s*(?:多)?\s*左右/g,
    why: "“大约/约”与“左右”表约数二选一即可，同时使用语义重复",
    fix: (m, g1) => `${g1}` },
];

// ============ 3. 的/得 混用（高置信模式，hint 级） ============
// “动词+的+很/太/真…” → “得”。口语高频错误，模式化程度高
const DE_PATTERN = new RegExp(
  "([\\u4e00-\\u9fa5]" +
  "(?:跑|走|说|写|做|干|吃|喝|玩|看|听|读|讲|笑|哭|唱|跳|飞|开|来|去|想|觉|感|活|办|答|算|演|穿|戴|站|坐|躺|睡|学|教|打|踢|扔|推|拉|抬|搬|追|赶|跑|冲|行|开|关|整|收拾|回|进|出|升|降|长|落|增|减|涨|跌|升|降))" +
  "的" +
  "(?=(?:很|太|真|好|挺|怪|相当|十分|特别|非常|格外|极其|这么|那么|不|对|快|慢|多|少|高|低|大|小|长|短|早|晚|远|近|彻底|清楚|明白|认真|仔细|努力|流利|漂亮|出色|熟练|开心|高兴|辛苦|利索|利落|直喘|直冒|直打))",
  "g"
);

// ============ 4. 在 / 再 混用（高置信词组，hint 级） ============
const ZAI_PATTERN = /在(?=(?:说|来|看|试|听|讲|问|唱|跳|玩|打|写|读|做)?一遍|一次|一回合|一次吧)/g;

// ============ 5. 格式规则 ============
const REPEAT_PUNCT = /([。，、；：？！])\1+/g;
const REPEAT_CHARS = /([的了地得是很就也都又把被对让跟])\1/g;
// 合法叠词/固定词例外（若命中区间落在这些词内部则跳过）
const REPEAT_EXCEPTIONS = ["不了了之", "是是非非", "就就是", "跟跟", "对对碰"];
const FULLWIDTH_DIGIT = /[０-９]+/g;
const FULLWIDTH_LETTER = /[Ａ-Ｚａ-ｚ]+/g;
// 中文语境里的英文标点（逗号/句号直接跟汉字）
const EN_PUNCT = /([\u4e00-\u9fa5])\s*([,.])\s*(?=[\u4e00-\u9fa5]|$)/g;
// 中英文之间无空格（hint，可关）
const CN_EN_NO_SPACE = /([\u4e00-\u9fa5])([A-Za-z0-9])|([A-Za-z0-9])([\u4e00-\u9fa5])/g;

const TYPE_LABEL = {
  typo: "错别字",
  ambiguity: "字词用法",
  redundancy: "语义冗余",
  format: "格式规范",
};

export function ruleTypeLabel(t) {
  return TYPE_LABEL[t] || t;
}

function overlap(aStart, aEnd, occupied) {
  for (const [s, e] of occupied) {
    if (aStart < e && aEnd > s) return true;
  }
  return false;
}

function inException(pos, text) {
  for (const ex of REPEAT_EXCEPTIONS) {
    const idx = text.indexOf(ex);
    while (idx !== -1) {
      if (pos >= idx && pos < idx + ex.length) return true;
      idx = text.indexOf(ex, idx + 1);
    }
  }
  return false;
}

export function runRules(text, options = {}) {
  const opts = {
    space: true,       // 中英文之间建议加空格
    punctuation: true, // 标点规范
    dediao: true,      // 的得/在再提示
    ...options,
  };
  const issues = [];
  const occupied = [];
  const push = (issue) => {
    if (overlap(issue.start, issue.end, occupied)) return;
    occupied.push([issue.start, issue.end]);
    issues.push(issue);
  };

  // --- 错别字词典：长词优先，避免短词吃掉长词 ---
  const keys = [...TYPO_MAP.keys()].filter((k) => k.trim().length >= 2);
  keys.sort((a, b) => b.length - a.length);
  for (const wrong of keys) {
    const right = TYPO_MAP.get(wrong);
    if (!right || right === wrong) continue;
    let idx = text.indexOf(wrong);
    while (idx !== -1) {
      push({
        type: "typo",
        start: idx,
        end: idx + wrong.length,
        original: wrong,
        suggestion: right,
        severity: "error",
        message: `疑似错别字，通常应写作“${right}”`,
        source: "rule",
      });
      idx = text.indexOf(wrong, idx + 1);
    }
  }

  // --- 语义冗余 ---
  for (const r of REDUNDANT) {
    let idx = text.indexOf(r.m);
    while (idx !== -1) {
      push({
        type: "redundancy",
        start: idx,
        end: idx + r.m.length,
        original: r.m,
        suggestion: r.s,
        severity: "warning",
        message: r.why,
        source: "rule",
      });
      idx = text.indexOf(r.m, idx + 1);
    }
  }

  // --- 大约…左右 ---
  let m;
  APPROX_PATTERNS.forEach((p) => {
    p.re.lastIndex = 0;
    while ((m = p.re.exec(text)) !== null) {
      push({
        type: "redundancy",
        start: m.index,
        end: m.index + m[0].length,
        original: m[0],
        suggestion: p.fix(m[0], m[1]),
        severity: "warning",
        message: p.why,
        source: "rule",
      });
    }
  });

  // --- 的得混用 ---
  if (opts.dediao) {
    DE_PATTERN.lastIndex = 0;
    while ((m = DE_PATTERN.exec(text)) !== null) {
      push({
        type: "ambiguity",
        start: m.index + m[1].length,
        end: m.index + m[1].length + 1,
        original: "的",
        suggestion: "得",
        severity: "hint",
        message: "动词后接程度补语一般用“得”，请结合语境确认",
        source: "rule",
      });
    }
    ZAI_PATTERN.lastIndex = 0;
    while ((m = ZAI_PATTERN.exec(text)) !== null) {
      push({
        type: "ambiguity",
        start: m.index,
        end: m.index + 1,
        original: "在",
        suggestion: "再",
        severity: "hint",
        message: "表示“又一次”应为“再”，请结合语境确认",
        source: "rule",
      });
    }
  }

  // --- 标点与格式 ---
  if (opts.punctuation) {
    REPEAT_PUNCT.lastIndex = 0;
    while ((m = REPEAT_PUNCT.exec(text)) !== null) {
      push({
        type: "format", start: m.index, end: m.index + m[0].length,
        original: m[0], suggestion: m[1], severity: "error",
        message: "标点符号重复", source: "rule",
      });
    }
    REPEAT_CHARS.lastIndex = 0;
    while ((m = REPEAT_CHARS.exec(text)) !== null) {
      if (inException(m.index, text)) continue;
      push({
        type: "format", start: m.index, end: m.index + m[0].length,
        original: m[0], suggestion: m[1], severity: "error",
        message: "同字重复，疑似多打了一个字", source: "rule",
      });
    }
    FULLWIDTH_DIGIT.lastIndex = 0;
    while ((m = FULLWIDTH_DIGIT.exec(text)) !== null) {
      push({
        type: "format", start: m.index, end: m.index + m[0].length,
        original: m[0], suggestion: [...m[0]].map((c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).join(""),
        severity: "warning", message: "全角数字，建议统一为半角", source: "rule",
      });
    }
    FULLWIDTH_LETTER.lastIndex = 0;
    while ((m = FULLWIDTH_LETTER.exec(text)) !== null) {
      push({
        type: "format", start: m.index, end: m.index + m[0].length,
        original: m[0], suggestion: [...m[0]].map((c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).join(""),
        severity: "warning", message: "全角字母，建议统一为半角", source: "rule",
      });
    }
    EN_PUNCT.lastIndex = 0;
    while ((m = EN_PUNCT.exec(text)) !== null) {
      push({
        type: "format", start: m.index + m[1].length, end: m.index + m[1].length + m[2].length,
        original: m[2], suggestion: m[2] === "," ? "，" : "。",
        severity: "warning", message: "中文语境中使用了英文标点", source: "rule",
      });
    }
  }

  if (opts.space) {
    CN_EN_NO_SPACE.lastIndex = 0;
    while ((m = CN_EN_NO_SPACE.exec(text)) !== null) {
      const g = m[1] ? [m[1], m[2]] : [m[3], m[4]];
      push({
        type: "format",
        start: m.index + (m[1] ? m[1].length : m[3].length),
        end: m.index + (m[1] ? m[1].length : m[3].length) + 1,
        original: g[0] + g[1],
        suggestion: g[0] + " " + g[1],
        severity: "hint",
        message: "中英文/数字之间建议加空格，提升可读性（可在设置中关闭）",
        source: "rule",
      });
    }
  }

  issues.sort((a, b) => a.start - b.start);
  return issues;
}

// 供侧边栏/设置页展示的规则统计
export function ruleStats() {
  return {
    version: RULES_VERSION,
    typoEntries: [...TYPO_MAP.keys()].filter((k) => k.trim().length >= 2).length,
    redundantEntries: REDUNDANT.length,
  };
}
