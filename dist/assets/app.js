/**
 * 计量经济学实证研究引导系统 v2
 * 模块化 · 持久化 · 对话式帮助 · 学情导出
 */

// ====== 全局状态 ======
const STORAGE_KEY = 'eco_tutor_v2';
// 教师访问令牌——需与 server.js 中 TEACHER_TOKEN 保持一致
const TEACHER_TOKEN = 'eco-teacher-2026';
const defaultState = {
    student: { name: '', id: '', course: '计量经济学', teacher: '', reflection: '' },
    progress: {
        1: { completed: false, qIdx: 0, answers: [], helpExchanges: [], hintsUsed: 0, startTime: null, completeTime: null, lastAccess: null },
        2: { completed: false, qIdx: 0, answers: [], helpExchanges: [], hintsUsed: 0, startTime: null, completeTime: null, lastAccess: null },
        3: { completed: false, qIdx: 0, answers: [], helpExchanges: [], hintsUsed: 0, startTime: null, completeTime: null, lastAccess: null },
        4: { completed: false, qIdx: 0, answers: [], helpExchanges: [], hintsUsed: 0, startTime: null, completeTime: null, lastAccess: null }
    },
    researchDesign: { question: '', varY: '', varX: '', controls: '' },
    level: null,          // 'beginner' | 'intermediate' | 'advanced' | null（未选择）
    levelHistory: [],     // 水平变更记录 [{from, to, time}]
    currentStage: null,
    globalStart: null
};

let state = loadState();

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return { ...defaultState, ...JSON.parse(saved) };
    } catch(e) { console.warn('Load state failed', e); }
    return JSON.parse(JSON.stringify(defaultState));
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) { console.warn('Save state failed', e); }
}

// ====== 工具函数 ======
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function showToast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => { t.className = 'toast ' + type; }, 2500);
}

function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ====== 分层引导体系（按学生水平适配引导深度） ======
// 关键差异（同一研究阶段在三档下 UI 形态截然不同）：
//   beginner    → 详细苏格拉底 + 概念卡自动展开 + 1/2次失败后给提示/示例 + 列答题要点
//   intermediate → 简化苏格拉底 + 2/3次失败后给提示/示例 + 列答题要点（要点在前让用户先思考）
//   advanced    → 完全不走 Q&A，直接呈现「专业级工具集」（研究设计 / 数据获取 / 数据清洗 / 实证推演工具）
//   advanced    → 入口需 PRO_TOKEN 密码（防止学生直接跳过前两档拿现成成果）
const PRO_TOKEN = 'eco-pro-2026';
const LEVELS = {
    beginner: {
        label: '初学者', icon: '🌱',
        shortDesc: '概念不清楚也能跟上',
        desc: '系统直接讲解概念，给出示例回答，手把手带你走。适合刚接触计量或基础概念模糊的同学。',
        hintAfter: 1, exampleAfter: 2,
        showConceptCard: true,    // 题目下自动展开「是什么 / 怎么做 / 为什么」概念卡
        showAnswerPoints: true,   // 自动列出本题答题要点
        renderMode: 'socratic_full'
    },
    intermediate: {
        label: '进阶', icon: '🚀',
        shortDesc: '启发式引导，独立思考',
        desc: '以启发式引导为主。系统不再手把手教，但卡住了会逐步给提示，并提示答题要点让你自检。',
        hintAfter: 2, exampleAfter: 3,
        showConceptCard: false,   // 移除详细概念卡，鼓励独立思考
        showAnswerPoints: true,   // 保留自检要点
        renderMode: 'socratic_lite'
    },
    advanced: {
        label: '高级', icon: '🎓',
        shortDesc: '专业工具 · 不做引导',
        desc: '🎓 PRO 模式 · 为已掌握实证流程的学生提供专业工具：研究设计变量定义、数据获取代码生成、CSV 数据清洗、OLS 回归输出。直接交付可用的代码与模型，**不走任何问答引导**。',
        hintAfter: 99, exampleAfter: 99,
        showConceptCard: false,
        showAnswerPoints: false,
        renderMode: 'pro_tool'        // 关键：完全不同的渲染分支
    }
};

function currentLevel() {
    return (state.level && LEVELS[state.level]) ? state.level : null;
}

function setLevel(lv, silent) {
    if (!LEVELS[lv]) return;
    // 高手档单独走密码门禁逻辑
    if (lv === 'advanced') {
        if (sessionStorage.getItem('proAuthed') === '1') {
            // 已授权，直接设置
            applySetLevel(lv, silent);
        } else {
            // 弹密码输入
            promptProPassword(lv, silent);
        }
        return;
    }
    applySetLevel(lv, silent);
}

function applySetLevel(lv, silent) {
    if (!LEVELS[lv]) return;
    const from = state.level || '（未选择）';
    state.level = lv;
    state.levelHistory.push({ from, to: lv, time: Date.now() });
    saveState();
    if (!silent) showToast(`已切换为「${LEVELS[lv].label}」引导模式`, 'success');
    // 刷新当前视图
    if (location.hash.startsWith('#stage')) {
        renderStage(parseInt(location.hash.replace('#stage', '')));
    } else if (location.hash.replace('#', '') === 'home' || !location.hash) {
        renderLanding();
    }
}

// 高手档密码弹窗
function promptProPassword(targetLv, silent) {
    // 移除已有弹窗
    const old = $('proPwModal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'proPwModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box pro-pw-modal">
            <div class="modal-header">
                <h3>🔒 高手档 · 授权验证</h3>
                <button class="modal-close" onclick="closeProPwModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p class="pro-pw-intro">
                    高手档是 <strong>专业级工具集合</strong>（变量定义模板、取数代码生成、CSV 清洗、OLS 模型设定），不走任何问答引导，可直接拿到可用工具与代码。<br><br>
                    为防止学生跳过前两阶段直接拿现成成果，本档需教师授权密码。
                </p>
                <div class="pro-pw-cap">
                    <div class="pro-cap-item"><span class="pro-cap-icon">🧰</span><div class="pro-cap-text"><span class="pro-cap-name">研究设计工具</span><span class="pro-cap-desc">变量定义模板 + 模型公式自动生成</span></div></div>
                    <div class="pro-cap-item"><span class="pro-cap-icon">📊</span><div class="pro-cap-text"><span class="pro-cap-name">数据获取工具</span><span class="pro-cap-desc">AKShare / Tushare / Stata 取数代码模板</span></div></div>
                    <div class="pro-cap-item"><span class="pro-cap-icon">🧹</span><div class="pro-cap-text"><span class="pro-cap-name">数据清洗工作台</span><span class="pro-cap-desc">CSV 上传 → 频度对齐 → 缺失处理 → 对数化 → 导出</span></div></div>
                    <div class="pro-cap-item"><span class="pro-cap-icon">📐</span><div class="pro-cap-text"><span class="pro-cap-name">OLS 回归计算器</span><span class="pro-cap-desc">模型设定 → Stata / R / Python 代码自动生成</span></div></div>
                </div>
                <label class="pro-pw-label">请输入授权密码（向任课教师索取）</label>
                <input type="password" id="proPwInput" class="form-input" placeholder="••••••••" onkeydown="if(event.key==='Enter') tryProPassword('${targetLv}', ${silent ? 'true' : 'false'})" autocomplete="off">
                <div id="proPwHint" class="pro-pw-hint"></div>
                <div class="pro-pw-actions">
                    <button class="btn-secondary" onclick="closeProPwModal()">取消</button>
                    <button class="btn-primary" onclick="tryProPassword('${targetLv}', ${silent ? 'true' : 'false'})">解锁高手档</button>
                </div>
                <div class="pro-pw-tip">💡 本次会话内有效，关闭页面后需重新输入。如需获取密码请咨询任课教师。</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.hidden = false;
    setTimeout(() => $('proPwInput')?.focus(), 50);
}

function closeProPwModal() {
    const m = $('proPwModal');
    if (m) m.remove();
}

function tryProPassword(targetLv, silent) {
    const pwd = $('proPwInput')?.value || '';
    const hint = $('proPwHint');
    if (pwd === PRO_TOKEN) {
        sessionStorage.setItem('proAuthed', '1');
        hint.classList.remove('error');
        hint.textContent = '✓ 验证通过，已解锁高手档';
        setTimeout(() => {
            closeProPwModal();
            applySetLevel(targetLv, silent);
        }, 600);
    } else {
        hint.classList.add('error');
        hint.textContent = '✗ 密码错误，请向任课教师索取正确密码';
        const inp = $('proPwInput');
        if (inp) { inp.value = ''; inp.focus(); }
    }
}

// 渲染水平选择卡片（首页）
function renderLevelCard() {
    const sec = $('levelSection');
    if (!sec) return;
    const lv = currentLevel();
    if (!lv) {
        sec.innerHTML = `
            <div class="lv-card lv-card-prompt">
                <div class="lv-card-title">🧭 开始之前：选择你的基础水平</div>
                <p class="lv-card-sub">不同水平会获得不同深度的引导——初学者直接获得概念讲解与示例，不会因反问式引导而卡住。选错也没关系，随时可以更换。</p>
                <div class="lv-options">
                    ${Object.entries(LEVELS).map(([k, L]) => `
                        <button class="lv-option" onclick="setLevel('${k}')">
                            <div class="lv-option-head"><span class="lv-option-icon">${L.icon}</span><span class="lv-option-name">${L.label}</span></div>
                            <div class="lv-option-desc">${L.desc}</div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        const L = LEVELS[lv];
        sec.innerHTML = `
            <div class="lv-card lv-card-set">
                <div class="lv-card-set-info">
                    <span class="lv-badge">${L.icon} ${L.label}模式</span>
                    <span class="lv-card-set-desc">${L.desc}</span>
                </div>
                <button class="btn-secondary" style="padding:7px 14px;font-size:12.5px" onclick="toggleLevelSwitcher()">更换水平</button>
                <div class="lv-switcher" id="lvSwitcher" hidden>
                    ${Object.entries(LEVELS).map(([k, LL]) => `
                        <button class="lv-switch-btn ${k === lv ? 'active' : ''}" onclick="setLevel('${k}')">${LL.icon} ${LL.label}</button>
                    `).join('')}
                </div>
            </div>
        `;
    }
}

function toggleLevelSwitcher() {
    const sw = $('lvSwitcher');
    if (sw) sw.hidden = !sw.hidden;
}

// 阶段页顶部的水平提示条（问答型阶段）
function levelChipBarHtml() {
    const lv = currentLevel();
    if (!lv) return '';
    const L = LEVELS[lv];
    const tips = {
        beginner: '概念不清楚就点「需要帮助」，失败后系统会自动给出提示和参考示例',
        intermediate: '先自己思考，卡住了再要提示；连续失败会自动升级帮助',
        advanced: '本模式不主动提供提示，鼓励你独立推演；随时可切换水平'
    };
    return `
        <div class="lv-chip-bar">
            <span class="lv-badge">${L.icon} ${L.label}引导</span>
            <span class="lv-chip-tip">${tips[lv]}</span>
            <button class="lv-chip-switch" onclick="toggleStageLevelSwitch(this)">切换</button>
        </div>
    `;
}

function toggleStageLevelSwitch(btn) {
    let sw = $('stageLvSwitcher');
    if (!sw) {
        sw = document.createElement('div');
        sw.id = 'stageLvSwitcher';
        sw.className = 'lv-switcher inline';
        sw.innerHTML = Object.entries(LEVELS).map(([k, LL]) =>
            `<button class="lv-switch-btn ${k === currentLevel() ? 'active' : ''}" onclick="setLevel('${k}')">${LL.icon} ${LL.label}</button>`
        ).join('');
        btn.parentElement.appendChild(sw);
    } else {
        sw.remove();
    }
}

// 初学者概念讲解卡（从题目已有的 followUps/hint/concepts 自动生成）
function getConceptCardHtml(q) {
    const pick = re => {
        if (!q.followUps) return null;
        for (const [pattern, resp] of Object.entries(q.followUps)) {
            if (new RegExp(re).test(pattern)) return resp;
        }
        return null;
    };
    const def = pick('什么|定义');
    const how = pick('怎么|如何');
    const why = pick('为什么|为何');
    const eg = pick('例子|举例');
    const points = (q.concepts || []).map(c => c.missing);
    let html = `<div class="concept-card">
        <div class="concept-card-title">📖 概念讲解（初学者模式自动展开）</div>`;
    if (def) html += `<div class="concept-row"><span class="concept-tag">是什么</span><span>${def}</span></div>`;
    if (how) html += `<div class="concept-row"><span class="concept-tag">怎么做</span><span>${how}</span></div>`;
    if (eg) html += `<div class="concept-row"><span class="concept-tag">举个例子</span><span>${eg}</span></div>`;
    else if (q.hint) html += `<div class="concept-row"><span class="concept-tag">提示</span><span>${q.hint}</span></div>`;
    if (why) html += `<div class="concept-row"><span class="concept-tag">为什么</span><span>${why}</span></div>`;
    if (points.length) html += `<div class="concept-points">✍️ 回答要点：${points.map(p => `「${p}」`).join(' ')}</div>`;
    html += `</div>`;
    return html;
}

// 参考示例回答（按 阶段-题号 索引；仅初学者/进阶在多次尝试后可见）
const EXAMPLE_ANSWERS = {
    '1-0': '示例：「数字普惠金融的发展是否促进了居民消费水平的提升？」——我关心数字金融这一新业态对居民消费的因果影响。',
    '1-1': '示例：被解释变量 Y 是居民消费水平，用「人均消费支出的对数 ln(consume)」衡量，可从国家统计局或 CFPS 调查获得。',
    '1-2': '示例：核心解释变量 X 是数字普惠金融指数（北大数字金融指数），衡量各地区数字金融发展水平。',
    '1-3': '示例：控制变量包括人均可支配收入、城镇化率、老龄化率，并加入地区与年份固定效应。若遗漏收入，它会同时影响消费与金融发展，导致 β₁ 估计偏大（遗漏变量偏误）。',
    '3-0': '示例：把月度 X 在季度内取平均值，降频为季度数据与 Y 对齐；不用插值升频，因为插值会人为引入平滑假设、扭曲真实波动。',
    '3-1': '示例：先判断缺失机制——若是个别年份统计口径变动的随机缺失，直接删掉该观测；若是与经济水平相关的非随机缺失，用线性插值补全，并对比「删除样本」做稳健性检验。',
    '3-2': '示例：会。对 GDP、收入、消费等正值变量取对数：①压缩尺度、缓解极端值影响；②使偏态分布更接近正态；③系数可直接解释为弹性。',
    '4-0': '示例：首先做平稳性检验（ADF 单位根检验）。若变量非平稳就直接回归，会出现「伪回归」——t 值和 R² 虚高、看似显著实则无意义。应先差分或检验协整。',
    '4-1': '示例：多重共线性会膨胀估计方差、让 t 检验失效（变量实际显著但 t 值不显著）、系数符号紊乱。用 VIF 检测，VIF > 10 说明严重共线性，可剔除变量或用岭回归。',
    '4-2': '示例：lnC_it = β₀ + β₁DIF_it + β₂lnInc_it + β₃Urb_it + μᵢ + λₜ + εᵢₜ。β₁ 是核心系数（数字金融对消费的边际效应）；μᵢ 个体固定效应、λₜ 时间固定效应、εᵢₜ 随机扰动。',
    '4-3': '示例：t = β₁ / se(β₁) = 0.45 / 0.12 = 3.75。t 值远大于 1.96（5% 临界值），说明 β₁ 显著不为零。',
    '4-4': '示例：t = 3.75 > 1.96，p < 0.001，在 5% 水平下拒绝 H₀，β₁ 统计显著为正。经济含义：X 每提高 1 单位，Y 平均提高 0.45 单位（若取对数则近似弹性 0.45%），效应有实际意义。'
};

// ====== 阶段与问题定义 ======
const stages = {
    1: {
        title: '研究设计',
        tag: '阶段一',
        icon: '<path d="M3 3H10V10H3V3Z M14 3H21V10H14V3Z M3 14H10V21H3V14Z M14 14H21V21H14V14Z" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>',
        desc: '一切实证研究的起点。在触碰数据之前，先想清楚研究问题、核心解释变量（X）与被解释变量（Y）。',
        intro: '一切实证研究的起点。在触碰数据之前，你必须先想清楚：你要回答什么问题？核心解释变量（X）和被解释变量（Y）分别是什么？',
        questions: [
            {
                text: "在开始任何实证研究之前，你需要先想清楚一个根本问题：<span class='highlight'>你试图回答的研究问题是什么？</span><br><br>请用一句话描述你关心的经济现象或因果关系。例如：「货币政策是否影响经济增长？」「教育投入是否提高收入水平？」",
                hint: '好的研究问题应该是具体且可检验的。避免过于宽泛的描述，聚焦在一个清晰的因果机制上。',
                concepts: [
                    { pattern: /(影响|导致|促进|抑制|关系|作用)/, found: '你关注了因果关系，这是计量经济学的核心', missing: '请明确你关心的因果方向' },
                    { pattern: /(GDP|收入|消费|投资|出口|通胀|增长|就业|房价|利率)/, found: '你已选定了具体的经济变量', missing: '请指定具体的经济变量' }
                ],
                followUps: {
                    '什么|什么是|定义': '研究问题是你要用计量方法回答的具体问题。它应该是可证伪的——即数据可以支持或拒绝它。例如「利率下调是否促进投资增长」就是一个好的研究问题。',
                    '为什么|为何|原因': '因为计量经济学本质上是用数据检验因果关系。没有清晰的研究问题，你就无法选择合适的模型和数据。',
                    '怎么|如何|方法': '先问自己：什么现象让你好奇？X 和 Y 之间你预期什么关系？把这种预期写成可检验的假设。',
                    '例子|举例|案例': '例：「财政支出对经济增长的影响」「外商直接投资是否促进技术进步」「货币政策传导效率的地区差异」。'
                },
                validate: ans => ans.length >= 10,
                error: '请更具体地描述你的研究问题，至少10个字。',
                recordKey: 'question'
            },
            {
                text: "明确了研究问题后，请界定你的<span class='highlight'>被解释变量（Y）</span>。<br><br>你想要解释或预测的变量是什么？它如何被量化？",
                hint: 'Y 是你研究的「果」。例如研究「教育对收入的影响」，Y 就是收入水平，通常用对数化的人均收入来衡量。',
                concepts: [
                    { pattern: /(收入|GDP|增长|消费|投资|出口|就业|价格|利率|效率)/, found: '你已选定了被解释变量的类型', missing: '请明确你要解释的变量' },
                    { pattern: /(对数|ln|log|增长率|水平|人均)/, found: '你考虑了变量的衡量方式', missing: '建议说明变量的具体衡量方式（如对数化、增长率等）' }
                ],
                followUps: {
                    '什么|什么是|定义': '被解释变量（Y）是你模型中要解释或预测的变量，是研究的「果」。它的选择直接取决于你的研究问题。',
                    '为什么|为何|原因': 'Y 的选择必须与研究问题一致。如果你想研究「教育对收入的影响」，Y 就必须是收入，而不是教育。',
                    '怎么|如何|方法': '思考：你的研究问题中，哪个词是「结果」？那个就是 Y。然后确定它的衡量方式——是水平值、增长率还是对数值。'
                },
                validate: ans => ans.length >= 5,
                error: '请明确指出被解释变量及其衡量方式。',
                recordKey: 'varY'
            },
            {
                text: "现在定义你的<span class='highlight'>核心解释变量（X）</span>。<br><br>你关心的那个「因」是什么？它的变化被认为是导致 Y 变化的关键因素。",
                hint: 'X 是你研究的「因」。例如研究「教育对收入的影响」，X 就是教育年限或教育水平。注意区分核心解释变量与控制变量。',
                concepts: [
                    { pattern: /(教育|货币|财政|利率|投资|FDI|贸易|制度|政策|技术)/, found: '你已选定了核心解释变量的方向', missing: '请指出你关心的核心解释变量' },
                    { pattern: /(年限|水平|增长率|占比|规模|比率)/, found: '你考虑了 X 的衡量方式', missing: '建议说明 X 的具体衡量方式' }
                ],
                followUps: {
                    '什么|什么是|定义': '核心解释变量（X）是你研究中认为导致 Y 变化的关键因素，是研究的「因」。你的回归系数 β₁ 就衡量了 X 对 Y 的边际效应。',
                    '区别|区分|控制': '核心解释变量是你最关心的那个因素，它的系数是研究的核心。控制变量是为了消除遗漏变量偏误而纳入的其他因素，你关心它们的统计控制效果，但不关心其系数的经济含义。',
                    '怎么|如何|方法': '问自己：在你的研究问题中，哪个因素是你认为「推动」Y 变化的？那就是 X。'
                },
                validate: ans => ans.length >= 5,
                error: '请明确指出核心解释变量。',
                recordKey: 'varX'
            },
            {
                text: "最后，除了核心 X 之外，还有哪些<span class='highlight'>控制变量</span>需要纳入模型？<br><br>思考一下：有哪些遗漏变量可能同时影响 X 和 Y，如果忽略它们会导致什么问题？",
                hint: '遗漏重要控制变量会导致遗漏变量偏误（OVB）。常见的控制变量包括：人口特征、时间趋势、地区固定效应等。想一想你的研究中，除了 X，还有什么会影响 Y？',
                concepts: [
                    { pattern: /(人口|GDP|规模|趋势|地区|时间|固定效应|年龄|性别|教育|制度)/, found: '你列举了有意义的控制变量', missing: '请列举至少2-3个控制变量' },
                    { pattern: /(偏误|内生|遗漏)/, found: '你理解了遗漏变量偏误的风险', missing: '思考：如果遗漏这些变量，估计会有什么偏误？' }
                ],
                followUps: {
                    '什么|什么是|定义': '控制变量是为了控制其他影响 Y 的因素，避免它们干扰你对 X→Y 关系的估计。不纳入重要控制变量会导致遗漏变量偏误（OVB）。',
                    '为什么|为何|原因': '如果某个变量同时影响 X 和 Y，但不被纳入模型，它的效应会被错误地归因于 X，导致 β₁ 的估计偏误。这就是 OVB。',
                    '怎么|如何|方法|选择': '选择控制变量的原则：1) 经济理论支持它影响 Y；2) 它可能与 X 相关；3) 数据可获得。常见控制变量包括：人口规模、GDP、时间趋势、地区固定效应等。',
                    '多少|几个': '通常 3-5 个核心控制变量足够。不要贪多——过多的控制变量会降低自由度，且可能引入多重共线性。'
                },
                validate: ans => ans.length >= 5,
                error: '请至少列举一些潜在的控制变量。',
                recordKey: 'controls'
            }
        ]
    },
    2: {
        title: '数据获取',
        tag: '阶段二',
        icon: '<path d="M4 8H16M4 8L8 4M4 8L8 12M20 6V18M20 18L16 14M20 18L24 14" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        desc: '研究设计已锁定。导师直接给出权威数据源清单与取数路径，按变量类型对号入座获取真实数据。',
        intro: '请根据你的 X / Y 变量类型，按图索骥：进入对应官网 → 检索指标 → 下载导出 → 核对口径。',
        type: 'data_guide',
        questions: [],
        // 阶段级追问知识库（供"继续深入探讨"使用）
        followUps: {
            '国家统计局|国家数据': '国家统计局（stats.gov.cn）是最权威的宏观数据源。操作路径：进入"国家数据"平台（data.stats.gov.cn）→ 按指标/地区/时间筛选 → 导出 Excel。GDP、CPI、PMI、固定资产投资、居民收入等都能在这里免费下载，免注册。',
            '年鉴|统计年鉴': '省/地市宏观面板首选统计年鉴：国家、各省、各地市三级统计年鉴数据最全。年鉴缺失的指标可依据《政府信息公开条例》向对应统计局提交信息公开申请（说明学生身份、学术用途、数据项与时间范围），政府有回复效率考核，多会电话协助，成功率高。注意三级口径可能不一致。',
            'Wind|CSMAR|国泰安': '上市公司微观数据用 CSMAR/Wind/中经研究数据库——学校图书馆通常已购买权限，先问图书馆或院系。标准操作三步：①导出目标企业名单（必须带股票代码）→ ②导出全部上市公司财务表 → ③以股票代码为唯一标识用 VLOOKUP/XLOOKUP 匹配筛选。没有权限时可用 AKShare/Tushare 免费替代。',
            '免费|替代': '免费替代 Wind 的方案：①AKShare（Python 开源，覆盖A股/期货/基金/宏观，完全免费）；②Tushare（基础数据免费，高级需积分）；③东方财富 Choice 免费版；④同花顺 iFinD（高校可能有免费使用权）。',
            '上市公司|企业数据|年报': '上市公司数据取数地图分三类：微观企业变量→CSMAR/Wind/企业年报（巨潮资讯网 cninfo.com.cn 可批量下载 XBRL 结构化财务数据）；地区宏观变量→统计年鉴/省市公报；政策处理变量→官方政策名单/试点批次文件。',
            '国际|世界银行|World Bank': '国际比较数据：世界银行 data.worldbank.org（WDI 数据库，支持 API 批量下载）、IMF（IFS/WEO）、OECD（data.oecd.org）、联合国 UN Comtrade（国际贸易明细）。均免费。',
            '微观|调查|CFPS|CGSS': '微观个体调查数据：CFPS 中国家庭追踪调查、CGSS 中国综合社会调查、CHFS 中国家庭金融调查——去对应官网注册申请（学术用途免费），审核通过后下载。企业工商信息可用企查查/天眼查（基础信息免费）。',
            '闲鱼|买数据|第三方': '不建议直接购买第三方整理版数据——大量缺失、错漏。若确实使用，必须交叉验证：抽样与官方数据核对、检查连续性与口径。论文中应标注原始数据来源（如国家统计局），而非获取渠道。',
            '爬虫|python': '爬虫原则：优先用官方 API 和开源工具（如 AKShare），而非自己写爬虫；遵守 robots.txt；请求间隔≥3秒；仅供学术研究。统计局/交易所数据可直接下载，不建议爬取。',
            'DID|政策|试点': '做 DID 等政策评估时，处理变量优先找官方试点名单（政策文件、批次文件、部委官网公示），不要自己构造处理组。时间范围要覆盖政策冲击前后。',
            '频度|频率|月度|季度': '宏观数据频度：GDP 只有季度，CPI/PMI/货币量为月度，统计年鉴为年度。频度选择看两点：变量可获得性 + 研究目标（短期波动用高频、长期趋势用低频）。频度不一致的处理留到阶段三"数据清洗"。',
            '找不到|没有数据': '找不到数据时按顺序尝试：①行业协会报告与统计年鉴；②该行业上市公司年报的行业分析章节；③政府信息公开申请；④用公开代理变量替代（如用百度指数代理关注度）。注意：不要把论文核心变量押在未拿到手的申请数据上，尽早准备替代指标。'
        },
        guide: {
            categories: [
                {
                    id: 'macro', label: '宏观经济数据', icon: '🏛️',
                    tip: 'GDP、CPI、PMI、货币、财政、贸易等国家级指标，官方免费、最权威。',
                    sources: [
                        {
                            name: '国家统计局 · 国家数据平台', url: 'https://data.stats.gov.cn',
                            content: 'GDP、CPI、PPI、PMI、固定资产投资、社零总额、工业增加值、居民收入',
                            freq: '月度/季度/年度',
                            how: '按指标·地区·时间筛选 → 导出 Excel（免费免注册）',
                            steps: [
                                { act: '进入官网 data.stats.gov.cn（无需注册）',
                                  where: '首页顶部导航 →「国家数据」',
                                  find: '左侧「指标」栏按主题浏览（月度/季度/年度/分省/分行业）',
                                  why: '这是中国宏观数据最权威、最完整的免费来源，所有 GDP/CPI 官方数据都从这里出' },
                                { act: '选择指标 → 选择时间区间 → 选择地区',
                                  where: '页面中部的三重筛选器',
                                  find: '搜索关键词如「居民消费」「CPI」「GDP 不变价」',
                                  why: '避免直接搜"GDP"——每年统计局公布多个版本（现价/不变价/累计），选错就入坑' },
                                { act: '点击「导出」按钮，存为 Excel/CSV',
                                  where: '表格右上角',
                                  find: '导出的文件命名包含「指标名+时间+单位」',
                                  why: '导出后及时检查：①单位是否需要换算（亿元/万元）；②时间是否完整覆盖研究区间' }
                            ],
                            indicators: 'GDP（季度）、CPI/PPI（月度）、PMI（月度）、固定资产投资（月度）、社会消费品零售总额（月度）、工业增加值（月度）、城镇/农村人均可支配收入（季度/年度）',
                            pitfall: '「累计」与「当月」数据容易搞混；季度 GDP 有初次核算 / 二次核算 / 最终核实 三个版本，做时间序列时建议以 2023 年经济普查后的最终数据为准；不同省份数据口径与全国可能不一致。'
                        },
                        {
                            name: '中国人民银行', url: 'http://www.pbc.gov.cn',
                            content: 'M0/M1/M2、社融规模、LPR/SHIBOR 利率、汇率、外汇储备',
                            freq: '月度（LPR 每月 20 日 9:15）',
                            how: '官网"调查统计"栏目',
                            steps: [
                                { act: '进入央行官网 →「调查统计」→ 选具体子栏目',
                                  where: '首页顶部 → 数据栏目 → 调查统计',
                                  find: '「货币统计概览」「社会融资规模」「利率""银行家问卷调查」',
                                  why: '央行口径货币数据与中国统计年鉴口径略不同，引用时务必标注数据来源口径' },
                                { act: 'LPR 利率：直接搜「贷款市场报价利率（LPR）」',
                                  where: '首页搜索框',
                                  find: '每月 20 日 9:15 公布的 1 年期/5 年期以上 LPR',
                                  why: 'LPR 是央行政策利率锚，做利率市场化、银行风险承担研究必用' },
                                { act: '下载时优先选 Excel 格式',
                                  where: '历史数据查询 → 导出 Excel',
                                  find: '同比/环比、月末/年初值',
                                  why: '学术论文一般用「月度同比」做时序，避免使用「当月新增」绝对值' }
                            ],
                            indicators: 'M0/M1/M2 同比（月度）、社会融资规模增量（月度）、新增人民币贷款（月度）、LPR 1Y/5Y+（月度）、SHIBOR 隔夜/7天（日度）、人民币兑美元中间价（日度）、外汇储备（月度）',
                            pitfall: 'M2 同比口径在 2018 年有过调整，回溯时间序列要做口径对齐（统计上有间断点）；央行公布的"新增贷款"与社融不一样，不可混用。'
                        },
                        {
                            name: '财政部', url: 'http://www.mof.gov.cn',
                            content: '财政收支、税收收入、国债发行、地方政府债务',
                            freq: '月度/年度',
                            how: '官网"财政数据"栏目',
                            steps: [
                                { act: '进入「财政数据」栏目 →「财政收支情况」',
                                  where: '首页 → 数据栏目 → 财政数据',
                                  find: '「一般公共预算收入/支出」「政府性基金收入/支出」',
                                  why: '财政收支是研究地方政府行为、税制改革、隐性债务的必备数据' },
                                { act: '查地方政府债务 →「地方政府债券发行情况」',
                                  where: '首页 → 政府债券 → 地方政府债券',
                                  find: '一般债 vs 专项债、发行额/余额、新增/再融资',
                                  why: '研究"地方政府专项债"必须区分"项目收益专项债"和"普通专项债"，结构差异巨大' }
                            ],
                            indicators: '一般公共预算收入/支出（月度）、税收收入分税种（月度）、政府性基金收入（月度）、地方政府专项债发行额/余额（月度）、国债收益率曲线（日度）',
                            pitfall: '财政数据中的「中央」与「地方」分项在不同年份可能调整口径，跨年度比较要核查。'
                        },
                        {
                            name: '海关总署', url: 'http://www.customs.gov.cn',
                            content: '进出口贸易额、贸易顺差/逆差、按商品/国别分类数据',
                            freq: '月度',
                            how: '官网统计栏目；细粒度 HS 编码数据走海关统计咨询网',
                            steps: [
                                { act: '海关总署官网 →「统计资讯」→「统计月报」',
                                  where: '首页 → 政务公开 → 统计数据',
                                  find: '进出口商品国别（地区）总值表、各商品 HS 编码出口数据',
                                  why: '做贸易领域研究需要细致到 HS 编码（6 位）粒度，普通年度数据不足' },
                                { act: '如需更细粒度的 HS 编码/价格数据',
                                  where: '海关统计咨询网（需付费或学术申请）',
                                  find: '可获取月度单价数据 → 用于企业层面出口研究',
                                  why: '做"中国出口对目的国贸易的影响"类研究，企业-产品-目的国三维数据是刚需' }
                            ],
                            indicators: '进出口总额（月度）、对主要贸易伙伴进出口（月度）、按 HS 分类出口（月度）、实际利用外资（FDI，月度）',
                            pitfall: '进出口当月值波动大，做趋势分析建议用「同比」或「年度累计"；美元与人民币口径要分清。'
                        },
                        {
                            name: '商务部', url: 'http://www.mofcom.gov.cn',
                            content: 'FDI 利用外资、对外投资 ODI、消费市场、电商交易额',
                            freq: '月度/季度',
                            how: '官网统计数据栏目',
                            indicators: 'FDI 实际使用外资金额（月度）、对外直接投资（季度）、社会消费品零售总额分行业（月度）、电商交易额（半年报）',
                            pitfall: 'FDI 商务部口径 vs 央行口径 vs 外汇局口径数据差异较大，引用必须标注来源。'
                        }
                    ]
                },
                {
                    id: 'finance', label: '金融与资本市场', icon: '📈',
                    tip: '股价、财务报表、债券、基金数据。学校已购 Wind/CSMAR 权限时优先使用。',
                    sources: [
                        {
                            name: 'CSMAR / Wind / 中经研究数据库', url: 'https://www.gtarsc.com',
                            content: '上市公司财务三表、股票行情、治理结构（高校图书馆通常已购买）',
                            freq: '日度及以上',
                            how: '先问图书馆/院系拿权限 → 导出目标企业名单（带股票代码）→ 用 VLOOKUP 匹配财务指标',
                            steps: [
                                { act: '确认学校/院系是否已购 CSMAR 数据库',
                                  where: '图书馆官网 →「电子资源」→"CSMAR" 或 "Wind"',
                                  find: '校外访问一般需 VPN + 校园账号',
                                  why: 'CSMAR 是覆盖最全的中国上市公司财务/股票数据库，免费版数据延迟 1-2 年，付费版实时' },
                                { act: '登录后选择研究主题',
                                  where: 'CSMAR 首页 → 股票市场系列 → 公司研究系列',
                                  find: '研究主题如「财务指标」「公司治理」「高管薪酬""股票交易」',
                                  why: 'CSMAR 主题分类细致，先按主题切好范围再按企业切' },
                                { act: '用股票代码筛选企业（带证交所编号）',
                                  where: 'CSMAR 高级查询 → 企业筛选',
                                  find: '可按行业（证监会行业分类）/地区/上市时间筛选',
                                  why: '避免直接下载全部 A 股再筛——3000+ 家全量年度数据下载耗时 30 分钟+' },
                                { act: '导出 CSV 文件（GBK 编码）→ 用 Python / Stata 处理',
                                  where: '查询结果右上角 →「导出」',
                                  find: 'Stata 用户记得在 import 中加 encoding("utf-8") 或先转码',
                                  why: 'CSMAR 默认 GBK 编码，直接 read.csv 会乱码' }
                            ],
                            indicators: '总资产/营业收入/净利润（年度/季度）、ROE/ROA、Tobin Q、研发支出、董事会规模、独立董事占比、高管前三薪酬、月度股票日收益率、年度财务困境指数 Z 指数、ESG 评分',
                            pitfall: '① 行业归属"上市公司行业变更"问题——研究期内可能因并购导致行业改变，要检查并固定；② ST/*ST 处理——剔除异常公司是常见的稳健性做法；③ 总资产/股本数额巨大，请用「对数化」处理再做回归。'
                        },
                        {
                            name: 'AKShare（Python · 免费）', url: 'https://akshare.akfamily.xyz',
                            content: 'A股/期货/基金/宏观数据，Wind 的免费开源替代',
                            freq: '日度/实时',
                            how: 'pip install akshare → 按接口文档调用，返回 DataFrame',
                            steps: [
                                { act: '安装 AKShare',
                                  where: '终端 / Anaconda Prompt',
                                  find: 'pip install akshare —upgrade',
                                  why: 'AKShare 接口持续更新，必须升级到最新版才能用上新接口' },
                                { act: '导入并查看文档',
                                  where: 'https://akshare.akfamily.xyz 查看左侧接口列表',
                                  find: '按需查：宏观数据 / 股票数据 / 期货数据 / 基金 / 利率',
                                  why: 'AKShare 接口名称直观——例如 macro_china_cpi = 中国 CPI 接口' },
                                { act: '调用接口并缓存到本地',
                                  where: 'Python 脚本',
                                  find: 'df = ak.macro_china_gdp()\ndf.to_csv("gdp.csv", index=False)',
                                  why: 'AKShare 不限制调用频率，建议全部缓存到本地 CSV，避免反复调用' }
                            ],
                            indicators: 'A 股日线/分钟线、ETF 净值、期货持仓、LPR/SHIBOR、GDP/CPI、货币供应量、PMI、社会融资规模、上市公司财务数据',
                            pitfall: '一些接口会因数据源调整而短期失效，遇到空数据先升级 akshare；不要在论文中过度依赖单接口（数据源可能下线）。'
                        },
                        {
                            name: 'Tushare（Python）', url: 'https://tushare.pro',
                            content: '股票日线、财务数据、宏观数据（基础免费，高级需积分）',
                            freq: '日度',
                            how: '注册取 token → pip install tushare',
                            indicators: '股票日线（含复权）、指数成分、上市公司基本面、宏观数据（利率/汇率/CPI）',
                            pitfall: '高级积分接口（财务三表、IPO 数据）需要积分，新账户免费期拿满 100 积分；研究型账户可申请教师认证 2000+ 积分。'
                        },
                        {
                            name: '巨潮资讯网', url: 'http://www.cninfo.com.cn',
                            content: '上市公司年报/季报/公告全文',
                            freq: '按披露',
                            how: '可批量下载 XBRL 结构化财务数据',
                            indicators: '所有 A 股年报/季报/重大事项公告全文、信息披露公告',
                            pitfall: '新上市公司偶尔会修改历史数据，时间序列研究要确认披露日期；XBRL 文件需要 XBRL 解析库解析。'
                        },
                        {
                            name: '中国债券信息网 / 外汇交易中心', url: 'https://www.chinabond.com.cn',
                            content: '国债收益率曲线、债券指数 / 人民币汇率中间价、SHIBOR',
                            freq: '日度',
                            how: '官网数据栏目直接下载',
                            indicators: '国债收益率曲线（日度）、各类债券指数、人民币兑主要货币中间价、SHIBOR（隔夜/7天/30天/90天）',
                            pitfall: '债券行情区分"全价/净价/到期收益率"三种数据，研究利率传导一般用到期收益率。'
                        }
                    ]
                },
                {
                    id: 'industry', label: '产业与行业数据', icon: '🏭',
                    tip: '行业运行、产销、能源、互联网数据，按行业主管部门对口查找。',
                    sources: [
                        { name: '工业和信息化部', url: 'https://www.miit.gov.cn', content: '工业经济运行、电信业务、软件产业、新能源汽车产销', freq: '月度', how: '每月发布的工业经济运行情况' },
                        { name: '农业农村部', url: 'http://www.moa.gov.cn', content: '农产品产量与价格、进出口、畜牧业', freq: '价格每日更新', how: '官网数据频道，批发价格每日发布' },
                        { name: '国家能源局', url: 'https://www.nea.gov.cn', content: '能源生产消费、电力数据、煤炭/石油/天然气', freq: '月度', how: '月度电力工业统计数据' },
                        { name: '中国汽车工业协会', url: 'http://www.caam.org.cn', content: '汽车产销、新能源汽车产销与出口', freq: '月度', how: '官网数据发布栏目' },
                        { name: 'CNNIC 中国互联网络信息中心', url: 'https://www.cnnic.net.cn', content: '网民规模、互联网普及率、数字经济基础数据', freq: '半年报/年报', how: '《中国互联网络发展状况统计报告》免费下载，做数字经济选题必备' }
                    ]
                },
                {
                    id: 'intl', label: '国际数据', icon: '🌍',
                    tip: '跨国比较研究的首选，全部免费、支持批量下载。',
                    sources: [
                        {
                            name: '世界银行 WDI', url: 'https://data.worldbank.org',
                            content: '全球各国 GDP、人口、贸易等宏观指标',
                            freq: '年度',
                            how: '在线筛选 → 批量下载 / 支持 API',
                            steps: [
                                { act: '打开 WDI →「Indicators」',
                                  where: 'data.worldbank.org → 主页 → Indicators',
                                  find: '每个指标有 5 大类：经济（Economy）、教育、环境、金融、人',
                                  why: '做跨国比较研究选 WDI 是因为它覆盖国家最多（200+）且口径一致' },
                                { act: '搜索指标（如 GDP per capita，指标代码 NY.GDP.PCAP.KD）',
                                  where: '页面中部搜索框',
                                  find: '指标代码 NY.GDP.PCAP.KD = 人均 GDP（不变价美元）',
                                  why: 'WDI 指标代码是国际通用，建议论文里同时给中文名+英文代码' },
                                { act: '下载 CSV / 用 API 批量取',
                                  where: '页面右上角 → Download → CSV / API',
                                  find: 'API 文档：https://datahelpdesk.worldbank.org/knowledgebase/articles/898581',
                                  why: '研究 50+ 国家的论文必须用 API 批量取数' }
                            ],
                            indicators: 'GDP（人均/总量，现价/不变价）、人口、城市化率、贸易/GDP、CO2 排放、用电普及率、互联网普及率',
                            pitfall: 'WDI 数据有大量"估计值"，引用前看具体后缀；同时要做缺失补全——低收入国家老数据空缺严重。'
                        },
                        { name: 'IMF', url: 'https://www.imf.org', content: '国际金融统计 IFS、世界经济展望 WEO', freq: '月度/年度', how: '官网 Data 栏目' },
                        { name: 'OECD', url: 'https://data.oecd.org', content: '发达国家经济社会环境指标', freq: '多频度', how: '按主题、国家筛选后导出' },
                        {
                            name: 'UN Comtrade', url: 'https://comtrade.un.org',
                            content: '国际贸易明细（按 HS 编码/国别）',
                            freq: '年度/月度',
                            how: '官网检索或 API（海关细粒度数据在此获取）',
                            steps: [
                                { act: '进入 Comtrade →「Data Explorer」',
                                  where: 'https://comtrade.un.org/data/',
                                  find: 'Reporter（申报国） / Partner（贸易伙伴） / HS 编码 / Year',
                                  why: 'Comtrade 是国际最权威的全球贸易数据库，覆盖 200+ 报告国' },
                                { act: '选定 HS 编码（4 位/6 位）和年份范围',
                                  where: '查询页面',
                                  find: 'HS 2/4/6 位编码粒度越高，数据可得性越差',
                                  why: '研究贸易协定/反倾销议题常用 HS 6 位粒度，研究宏观贸易用 HS 2 位即可' },
                                { act: '勾选「Annual」或「Monthly」',
                                  where: 'Period 选项',
                                  find: 'Monthly 数据经常延迟 6-8 个月',
                                  why: '做实时贸易研究建议用抽样的 12 个主要报告国月度数据' }
                            ],
                            indicators: '按 HS 分类进出口（按金额/数量）、按贸易伙伴进出口、贸易差额、运输方式细分',
                            pitfall: '同一商品不同年度 HS 编码会调整，做时间序列要 hs_align 匹配；金额数据多为美元，部分国家以本币报告需换算。'
                        },
                        { name: 'Google Dataset Search', url: 'https://datasetsearch.research.google.com', content: '跨平台数据集搜索引擎', freq: '—', how: '输入变量关键词检索已有数据集' }
                    ]
                },
                {
                    id: 'micro', label: '微观调查数据', icon: '👥',
                    tip: '研究个体/家庭行为时使用，官网申请（学术用途免费），审核需时日，尽早申请。',
                    sources: [
                        {
                            name: 'CFPS 中国家庭追踪调查', url: 'https://www.isss.pku.edu.cn/cfps/',
                            content: '家庭收入消费、教育、健康、代际关系（个体面板）',
                            freq: '两年一轮',
                            how: '官网注册 → 学术用途申请 → 审核通过后下载',
                            steps: [
                                { act: '进入 CFPS 官网 →「数据申请」',
                                  where: 'isss.pku.edu.cn/cfps/ → 数据申请',
                                  find: '「数据申请流程」页 → 注册账号（学术用途）',
                                  why: 'CFPS 个体面板是国内最权威的家庭调查之一，2024 年发布第 6 轮（2022 年样本）' },
                                { act: '登录 → 选择研究项目 → 签署使用协议',
                                  where: '后台「我的项目」',
                                  find: '需填：①研究主题 ②变量使用范围 ③使用期限',
                                  why: 'CFPS 采用"数据使用承诺制"——必须描述研究项目才能批准' },
                                { act: '审核通过后下载（通常 3-15 个工作日）',
                                  where: '邮件通知 / 后台通知',
                                  find: '数据文件按轮次发布，需用 CFPS 提供的 Stata 加密格式',
                                  why: 'CFPS 用专属加密 Stata 数据，要用「CFPS 数据处理工具」打开' }
                            ],
                            indicators: '家庭收入消费、家庭金融资产、儿童教育投入、健康与医疗支出、社会态度认知、家暴与代际转移、五等分家庭收入',
                            pitfall: '①抽样权重必须用——CFPS 是复杂抽样设计；②跨轮比较须用 CFPS 提供的「跨轮 ID 匹配」表；③ 学术伦理：个体数据不可被识别，需签署保密协议。'
                        },
                        { name: 'CGSS 中国综合社会调查', url: 'http://cgss.ruc.edu.cn', content: '社会态度、就业、价值观（横截面）', freq: '年度', how: '中国调查数据网申请下载' },
                        { name: 'CHFS 中国家庭金融调查', url: 'https://chfs.swufe.edu.cn', content: '家庭资产负债、信贷、保险', freq: '两年一轮', how: '西南财经大学官网申请' },
                        { name: '企查查 / 天眼查', url: 'https://www.qcc.com', content: '企业工商信息、股权结构、融资记录、知识产权', freq: '实时', how: '基础信息免费；深度数据需付费，建议用官方 API' },
                        { name: 'Kaggle / 阿里天池', url: 'https://www.kaggle.com', content: '公开数据集与竞赛数据', freq: '—', how: '注册后直接下载，附社区分析代码' }
                    ]
                }
            ],
            // 企业层面实证的三类数据取数地图
            dataMap: [
                { type: '微观企业变量', channel: 'CSMAR / Wind / 企业年报（巨潮资讯网）', example: 'ROA、营收、研发投入、高管薪酬' },
                { type: '地区宏观变量', channel: '统计年鉴 / 省市统计公报', example: '地区 GDP、产业结构、人口' },
                { type: '政策处理变量', channel: '官方政策名单 / 试点批次文件', example: '低碳城市试点、自贸区批次（DID 必用官方名单）' }
            ],
            // 渠道优先级
            priority: [
                { rank: '①', title: '官方统计平台直接下载', desc: '最优：免费、权威、可复现。统计年鉴数据最全（国家/省/地市三级）。' },
                { rank: '②', title: '开源 Python 库自动获取', desc: 'AKShare / Tushare，适合批量、高频数据，替代 Wind。' },
                { rank: '③', title: '学术调查数据官网申请', desc: 'CFPS / CGSS / CHFS 等，审核需 1–2 周，尽早提交。' },
                { rank: '④', title: '政府信息公开依法申请', desc: '年鉴缺失时向对应部门提交申请，说明学术用途，多会电话协助。' },
                { rank: '✕', title: '第三方整理版数据（闲鱼等）', desc: '不推荐直接购买：大量缺失错漏；确需使用必须交叉验证，论文标注原始来源。' }
            ],
            // 避坑清单
            pitfalls: [
                '统计数据会修订（初步核算→初步核实→最终核实），务必引用最新修订版并注明版本日期',
                '统计口径跨机构/跨层级可能不一致，尽量使用同一机构同一口径，否则在数据说明中写明调整方法',
                'DID 处理变量必须用官方试点名单，不要自己构造处理组',
                '行政非公开数据（爬虫爬不到）只能走信息公开申请，预留 2–4 周，并准备公开替代指标',
                '上市公司数据匹配：股票代码是唯一标识，两张表用 VLOOKUP/XLOOKUP 合并'
            ]
        }
    },
    3: {
        title: '数据清洗',
        tag: '阶段三',
        icon: '<path d="M4 6H20M6 6V18H18V6M9 10V14M12 10V14M15 10V14" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        desc: '原始数据很少能直接用于回归。需思考频度对齐、缺失值处理、对数化转换。',
        intro: '原始数据很少能直接用于回归。你需要思考：不同变量的频度是否对齐？是否存在缺失值？是否需要对数化转换？',
        questions: [
            {
                text: "获取到原始数据后，第一步：<span class='highlight'>频度对齐</span>。<br><br>如果你的 Y 是季度数据，但 X 是月度数据，你该如何处理这种频度不一致？",
                hint: '频度对齐有几种方法：1) 取季度内月度均值；2) 取季末值；3) 插值法将低频数据升频。最常用的是将高频数据降频匹配低频数据。',
                concepts: [
                    { pattern: /(均值|平均|季末|降频|升频|插值)/, found: '你提出了具体的对齐方法', missing: '请提出具体的频度对齐方法' },
                    { pattern: /(高频|低频|月度|季度|匹配)/, found: '你理解了高低频匹配的逻辑', missing: '思考：高频数据和低频数据如何匹配？' }
                ],
                followUps: {
                    '什么|定义': '频度对齐是指当不同变量的数据频度不一致时（如 Y 是季度、X 是月度），将它们统一到相同频度的过程。',
                    '为什么|为何': '回归要求所有变量在同一时间点有观测值。频度不一致就无法直接回归——维度不匹配。',
                    '怎么|如何|方法': '常用方法：1) 降频（月度→季度）：取季度内月度均值或季末值；2) 升频（季度→月度）：插值法，但会引入假设。降频更可靠。',
                    '哪种好|推荐': '推荐降频——将高频数据降频到低频。取均值适合流量变量（如消费），取季末值适合存量变量（如货币供应量）。'
                },
                validate: ans => ans.length >= 5,
                error: '请说明你的频度对齐策略。',
                recordKey: 'freqAlign'
            },
            {
                text: "第二步：<span class='highlight'>缺失值处理</span>。<br><br>如果你的面板数据中某些个体在某些年份缺失了数据，你会怎么处理？直接删除？插值补全？还是其他方法？",
                hint: '缺失值处理需谨慎。完全随机缺失（MCAR）可直接删除；但若非随机缺失，删除会引入偏误。常用方法包括：线性插值、多重插补、前向填充等。关键是不破坏数据的时序结构。',
                concepts: [
                    { pattern: /(删除|插值|插补|填充|前向|均值|回归)/, found: '你提出了缺失值处理方法', missing: '请提出缺失值处理方法' },
                    { pattern: /(随机|MCAR|非随机|偏误|机制)/, found: '你考虑了缺失机制', missing: '思考：缺失是随机的吗？不同缺失机制需要不同处理。' }
                ],
                followUps: {
                    '什么|定义': '缺失值处理是指当数据中存在空缺值时，决定如何填补或删除，以保证面板数据的完整性。',
                    '为什么|为何': '缺失值如果不处理，会导致回归时样本损失或估计偏误。处理方式取决于缺失机制——随机缺失可以删除，非随机缺失必须谨慎处理。',
                    '怎么|如何|方法': '常用方法：1) 列删除（删除含缺失的行）；2) 线性插值；3) 前向/后向填充；4) 多重插补（MI）。选择取决于缺失比例和机制。',
                    '删除|可以删': '如果缺失比例低（<5%）且为随机缺失，可以直接删除。但如果缺失是非随机的（如贫穷国家数据缺失更多），删除会引入选择偏误。'
                },
                validate: ans => ans.length >= 5,
                error: '请说明缺失值处理方法。',
                recordKey: 'missing'
            },
            {
                text: "第三步：<span class='highlight'>变量转换</span>。<br><br>对于可能存在异方差或量纲差异巨大的变量，你是否考虑对数化处理？为什么对数化在计量经济学中如此常见？",
                hint: '对数变换的三大好处：1) 压缩变量尺度，减小极端值影响；2) 使偏态分布更接近正态；3) 回归系数可解释为弹性。对于取值为正的经济变量（GDP、收入、价格等），ln 变换是标准操作。',
                concepts: [
                    { pattern: /(对数|ln|log|弹性|压缩|尺度|正态|异方差)/, found: '你理解了对数化的作用', missing: '请说明对数化的作用' },
                    { pattern: /(GDP|收入|价格|正|大于零|非负)/, found: '你知道哪些变量适合对数化', missing: '注意：只有取值为正的变量才能取对数。' }
                ],
                followUps: {
                    '什么|定义': '对数化是指对变量取自然对数（ln）。在计量经济学中，对于取值为正的经济变量，ln 变换是标准操作。',
                    '为什么|为何': '三大好处：1) 压缩尺度，减小极端值影响；2) 使偏态分布更接近正态；3) 回归系数可解释为弹性——β₁ 表示 X 变化 1% 时 Y 变化多少%。',
                    '哪些|什么时候': '适合对数化的变量：GDP、收入、价格、消费等取值为正且量纲较大的经济变量。不适合：增长率、比率（已在 0-1 之间）、可能为负的变量。',
                    '不取对数|不log': '如果你的变量本身就是增长率或比率（如 CPI 涨幅、M2 增长率），则不需要再取对数。对数化只对水平值有意义。'
                },
                validate: ans => ans.length >= 5,
                error: '请说明你的变量转换方案及理由。',
                recordKey: 'transform'
            }
        ]
    },
    4: {
        title: '实证推演',
        tag: '阶段四',
        icon: '<path d="M4 20L4 4M4 20H24M8 16L12 10L16 14L22 6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        desc: '最关键也最严格的阶段。依次完成前置检验、模型方程式、计算拆解、显著性判定。',
        intro: '最关键也最严格的阶段。你必须依次完成：前置检验设定 → 模型方程式书写 → 计算过程拆解 → 显著性判定。未通关前不会输出最终回归结果。',
        questions: [
            {
                text: "进入最严格的阶段。在做回归之前，你首先需要做<span class='highlight'>前置检验</span>。<br><br>请问：对于时间序列数据，你首先需要检验什么？如果不做这个检验直接回归，会出现什么问题？",
                hint: '对时间序列数据，首要检验是平稳性检验（单位根检验），如 ADF 检验。如果变量是非平稳的（存在单位根），直接回归可能导致「伪回归」（Spurious Regression）——看似显著的 t 统计量实际上毫无意义。',
                concepts: [
                    { pattern: /(平稳|单位根|ADF)/, found: '你正确识别了平稳性/单位根检验', missing: '关键概念：时间序列回归前必须检验「平稳性 / 单位根」' },
                    { pattern: /(伪回归|spurious)/, found: '你理解了伪回归的风险', missing: '思考：如果不检验平稳性直接回归，会出现什么问题？' }
                ],
                followUps: {
                    '什么|什么是|定义': '平稳性检验是检查时间序列的统计性质（均值、方差、自协方差）是否随时间不变。ADF（Augmented Dickey-Fuller）是最常用的单位根检验方法。',
                    '为什么|为何': '如果变量非平稳（存在单位根），直接回归可能导致「伪回归」——t 统计量看似显著，但实际上毫无意义。Granger 和 Newbold (1974) 证明了这一点。',
                    '怎么做|如何': '使用 ADF 检验：原假设 H₀ 是存在单位根（非平稳）。如果 ADF 统计量小于临界值，拒绝原假设，认为序列平稳。如果不平稳，可以取一阶差分使其平稳。',
                    '伪回归|spurious': '伪回归是指两个独立非平稳序列回归时，R² 很高、t 值显著，但实际上没有任何因果关系。这是忽视平稳性检验的严重后果。'
                },
                validate: ans => /平稳|单位根|ADF|stationar|unit root/i.test(ans) && ans.length >= 5,
                error: '关键概念：时间序列回归前必须检验「平稳性 / 单位根」。请重新回答，说明为什么要检验平稳性。',
                subStep: 1
            },
            {
                text: "除了平稳性，还需要检验<span class='highlight'>多重共线性</span>和<span class='highlight'>异方差</span>。<br><br>请回答：多重共线性会导致什么问题？你会用什么指标来检测它？",
                hint: '多重共线性导致估计量的方差膨胀，t 检验失效（即使变量实际显著，t 值也可能不显著）。常用检测指标是 VIF（方差膨胀因子），VIF > 10 通常被认为存在严重的多重共线性。',
                concepts: [
                    { pattern: /(VIF|方差膨胀)/, found: '你正确识别了 VIF 指标', missing: '关键概念：多重共线性用 VIF（方差膨胀因子）检测' },
                    { pattern: /(方差|膨胀|不稳定|t值|显著)/, found: '你理解了多重共线性的后果', missing: '思考：多重共线性会导致什么问题？' }
                ],
                followUps: {
                    '什么|什么是|定义': '多重共线性是指解释变量之间存在高度线性相关关系。VIF（方差膨胀因子）衡量某个变量的变异有多少可以被其他解释变量解释。VIF > 10 表示严重的多重共线性。',
                    '为什么|为何|后果': '多重共线性导致估计量的方差膨胀，t 检验失效——即使变量实际显著，t 值也可能不显著。系数估计变得不稳定，对样本微小变化高度敏感。',
                    '怎么解决|如何解决|怎么办': '解决方法：1) 删除高度相关的变量；2) 主成分分析（PCA）降维；3) 岭回归（Ridge Regression）；4) 增大样本量。',
                    '异方差|heteroscedasticity': '异方差是指误差项方差不恒定。用 White 检验或 BP 检验检测。解决方法：使用稳健标准误（Robust SE）或加权最小二乘（WLS）。'
                },
                validate: ans => /VIF|方差膨胀|多重共线|variance/i.test(ans) && ans.length >= 5,
                error: '关键概念：多重共线性用 VIF（方差膨胀因子）检测。请重新回答 VIF 的作用和阈值。',
                subStep: 1
            },
            {
                text: "前置检验通过后，请<span class='highlight'>写出你的回归方程式</span>。<br><br>用规范的计量经济学记号写出你的模型。例如：<br>Y<sub>it</sub> = β₀ + β₁X<sub>it</sub> + β₂Z<sub>it</sub> + μ<sub>i</sub> + ε<sub>it</sub><br><br>请写出你自己的模型方程，并说明各项含义。",
                hint: '面板数据模型应包含个体效应（μᵢ）和随机扰动项（εᵢₜ）。β₁ 是你最关心的核心系数——X 对 Y 的边际效应。Z 代表控制变量向量。注意下标 i 和 t 分别表示个体和时间。',
                concepts: [
                    { pattern: /(beta|β|系数)/i, found: '你的方程包含了系数符号', missing: '请使用 β 符号表示系数' },
                    { pattern: /(i.*t|it|个体.*时间|面板)/i, found: '你正确使用了面板数据的双下标', missing: '面板数据应使用双下标 i 和 t' },
                    { pattern: /(μ|mu|效应|固定|随机|误差|扰动)/i, found: '你包含了个体效应或扰动项', missing: '方程应包含个体效应（μᵢ）和扰动项（εᵢₜ）' }
                ],
                followUps: {
                    '怎么写|如何写': '面板数据固定效应模型标准写法：Y_it = β₀ + β₁X_it + β₂Z_it + μ_i + ε_it。其中 i 表示个体，t 表示时间，μ_i 是个体固定效应，ε_it 是随机扰动项。',
                    'β₁|beta1|核心系数': 'β₁ 是你研究的核心系数，表示 X 对 Y 的边际效应。你的整个研究就是为了估计和检验这个系数。',
                    'μᵢ|个体效应|mu': 'μ_i 是个体固定效应，捕捉不随时间变化但随个体不同的因素（如地理位置、文化传统等）。它解决了部分遗漏变量问题。',
                    '固定效应|随机效应|FE|RE': '固定效应（FE）允许 μ_i 与 X 相关；随机效应（RE）假设 μ_i 与 X 不相关。Hausman 检验可以帮你选择。如果担心内生性，优先用 FE。'
                },
                validate: ans => /beta|β|系数|回归|方程|=/i.test(ans) && ans.length >= 10,
                error: '请写出包含系数（β）和变量符号的回归方程式，并解释各项含义。',
                subStep: 2
            },
            {
                text: "方程已确立。现在进行<span class='highlight'>计算过程拆解</span>。<br><br>假设 OLS 估计得到 β₁ = 0.45，标准误 se(β₁) = 0.12。请回答：t 统计量怎么算？在这个例子中 t 值是多少？",
                hint: 't 统计量的计算公式为：t = β₁ / se(β₁)。代入数值：t = 0.45 / 0.12 = 3.75。这个值远大于 1.96（5%显著性水平的临界值），意味着 β₁ 显著不为零。',
                concepts: [
                    { pattern: /(3\.7|0\.45\s*\/\s*0\.12|0\.45\/0\.12)/, found: '你正确计算了 t 值', missing: 't = β₁ / se(β₁) = 0.45 / 0.12，请算出结果' },
                    { pattern: /(t\s*=|t值|t统计量)/, found: '你知道要计算 t 统计量', missing: '请写出 t 统计量的计算公式和结果' }
                ],
                followUps: {
                    '怎么算|如何算|公式': 't 统计量 = 估计值 / 标准误 = β₁ / se(β₁) = 0.45 / 0.12 ≈ 3.75。',
                    '什么|定义': 't 统计量衡量估计值与零的差异有多大（以标准误为单位）。t 值越大，越有把握说系数不为零。',
                    '临界值|1\.96|显著': '在 5% 显著性水平下，双侧检验的临界值约为 1.96。t = 3.75 > 1.96，所以拒绝原假设，β₁ 显著不为零。',
                    'p值|p-value': 't = 3.75 对应的 p 值 < 0.001，远小于 0.05。p 值越小，拒绝原假设的证据越强。'
                },
                validate: ans => /3\.7|t\s*=\s*0\.45|0\.45\s*\/\s*0\.12/i.test(ans) && ans.length >= 5,
                error: 't 统计量 = 估计值 / 标准误 = 0.45 / 0.12 ≈ 3.75。请重新计算并写出结果。',
                subStep: 3
            },
            {
                text: "最后一步：<span class='highlight'>显著性判定</span>。<br><br>已知 t = 3.75，在 5% 显著性水平下，临界值为 1.96。请回答：β₁ 是否显著？你会得出什么结论？在经济含义上如何解释？",
                hint: 't = 3.75 > 1.96，说明在 5% 水平下拒绝原假设 H₀: β₁ = 0，即 X 对 Y 的影响是统计显著的。对应 p 值 < 0.001。经济含义是：X 每变化一个单位，Y 显著变化 β₁ 个单位（若取对数则为弹性）。',
                concepts: [
                    { pattern: /(显著|拒绝|reject)/, found: '你做出了正确的显著性判断', missing: '请判断：t=3.75 > 1.96，是否显著？' },
                    { pattern: /(p值|p\s*值|0\.001|小于)/i, found: '你提到了 p 值', missing: '思考对应的 p 值是多少？' },
                    { pattern: /(经济|含义|解释|边际|弹性)/, found: '你给出了经济含义解释', missing: '请给出经济含义的解释' }
                ],
                followUps: {
                    '怎么判断|如何判断': '判断规则：如果 |t| > 临界值（5%水平下约1.96），则拒绝原假设 H₀: β₁=0，认为 β₁ 显著不为零。t=3.75 > 1.96，所以显著。',
                    'p值|p-value|什么是p': 'p 值是在原假设成立的前提下，观察到当前或更极端 t 值的概率。p < 0.05 表示在 5% 水平下显著。t=3.75 对应 p < 0.001。',
                    '经济含义|经济显著': '统计显著不等于经济显著。β₁=0.45 意味着 X 每变化1单位，Y 变化0.45单位。如果取了对数，则表示 X 变化1% 时 Y 变化0.45%。你需要判断这个效应在实际中是否有意义。',
                    '原假设|null|H0': '原假设 H₀: β₁ = 0，即 X 对 Y 没有影响。我们的目标是检验是否有足够证据拒绝这个假设。'
                },
                validate: ans => /显著|拒绝|reject|p\s*值|1\.96|3\.75/i.test(ans) && ans.length >= 10,
                error: 't = 3.75 > 1.96，拒绝原假设，β₁ 在 5% 水平下统计显著。请重新回答并给出经济含义解释。',
                subStep: 4
            }
        ]
    },
    5: {
        title: '自主研究 · 论文设计',
        tag: '阶段五',
        icon: '<path d="M4 4H20V8H4V4ZM6 10H18V22H6V10ZM9 13H15V15H9V13ZM9 17H13V19H9V17Z" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>',
        desc: '在完成前四个阶段后，进入自主研究阶段。AI 导师将陪伴你完成选题、文献、实证设计到论文写作的完整流程。',
        intro: '欢迎进入自主研究阶段。你已经掌握了"研究设计→数据获取→数据清洗→实证推演"的基础能力。现在，AI 导师会陪伴你从选题出发，一路引导你完成一篇完整的实证论文。',
        type: 'ai_chat',
        sections: [
            { id: 'topic',     label: '选题建议',     icon: '💡', starter: '我想研究 [你的选题方向]，请帮我评估这个选题的可行性和研究价值。' },
            { id: 'literature',label: '文献综述',     icon: '📚', starter: '请帮我梳理 [某主题] 的研究脉络，找出研究空白。' },
            { id: 'design',    label: '实证设计',     icon: '🔬', starter: '请帮我审视 [我的研究设计] 的模型设定与变量选取。' },
            { id: 'writing',   label: '写作框架',     icon: '✍️', starter: '请帮我搭建 [我的论文题目] 的写作框架，从摘要到结论。' },
            { id: 'defense',   label: '答辩准备',     icon: '🎤', starter: '请预测评委可能对我的论文 [某部分] 提出什么问题？' }
        ]
    }
};

// ====== 模拟数据 ======
const mockData = {
    headers: ['时间', 'ln(GDP)', 'M2增长率(%)', 'CPI(%)', 'FDI(亿元)', '利率(%)'],
    rows: [
        ['2010Q1', '10.82', '22.5', '2.4', '1,245', '5.81'],
        ['2010Q2', '10.91', '20.4', '2.9', '1,380', '5.79'],
        ['2010Q3', '10.98', '19.0', '3.4', '1,520', '5.73'],
        ['2010Q4', '11.05', '17.3', '4.1', '1,610', '5.70'],
        ['2011Q1', '11.12', '15.7', '5.0', '1,430', '5.85']
    ],
    source: '模拟数据 · 国家统计局 / Wind'
};

const mockDict = [
    ['lnGDP', 'GDP的对数值', '季度', '取自然对数', '国家统计局'],
    ['M2g', '广义货币供应量增长率', '月度→季度均值', '降频对齐', '中国人民银行'],
    ['CPI', '居民消费价格指数', '月度→季度均值', '降频对齐', '国家统计局'],
    ['FDI', '外商直接投资', '季度', '取对数', '商务部'],
    ['R', '一年期贷款利率', '月度→季末值', '取季末值', '中国人民银行']
];

const mockResult = {
    headers: ['变量', '系数', '标准误', 't统计量', 'p值', '显著性'],
    rows: [
        ['常数项 (C)', '2.345', '0.891', '2.63', '0.009', '***'],
        ['M2增长率', '0.452', '0.121', '3.73', '0.000', '***'],
        ['CPI', '0.128', '0.095', '1.35', '0.179', ''],
        ['FDI(ln)', '0.067', '0.034', '1.97', '0.049', '**'],
        ['利率', '-0.234', '0.078', '-3.00', '0.003', '***'],
        ['R²', '0.876', '', '', '', ''],
        ['F统计量', '142.3', '', '0.000', '', '***']
    ],
    conclusion: '核心解释变量 M2增长率的系数为 0.452，t = 3.73 > 1.96，p < 0.001，在 1% 显著性水平下统计显著。这表明广义货币供应量增长对经济增长（ln GDP）具有显著正向影响。模型 R² = 0.876，解释力较强。控制变量中利率显著为负，符合经济学预期。CPI 不显著，可能因存在多重共线性或样本期较短。'
};

// ====== 路由系统 ======
function navigate(route) {
    location.hash = route;
    handleRoute();
}

function handleRoute() {
    const hash = location.hash.replace('#', '') || 'home';
    
    // 隐藏所有页面
    $('pageLanding').hidden = true;
    $('pageStage').hidden = true;
    $('pageReport').hidden = true;
    $('pageTeacher').hidden = true;
    
    // 更新步骤器
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (hash === 'home' || hash === 'journey') {
        $('pageLanding').hidden = false;
        document.querySelector('.step-item[data-stage="home"]').classList.add('active');
        renderLanding();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (hash === 'journey') {
            // 启动完整之旅，从阶段1开始
            setTimeout(() => navigate('stage1'), 100);
        }
    } else if (hash.startsWith('stage')) {
        const stageNum = parseInt(hash.replace('stage', ''));
        if (stages[stageNum]) {
            $('pageStage').hidden = false;
            document.querySelector(`.step-item[data-stage="${stageNum}"]`)?.classList.add('active');
            renderStage(stageNum);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            navigate('home');
        }
    } else if (hash === 'report') {
        $('pageReport').hidden = false;
        document.querySelector('.step-item[data-stage="report"]').classList.add('active');
        renderReport();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (hash === 'teacher') {
        $('pageTeacher').hidden = false;
        // 先检查教师是否已登录
        if (sessionStorage.getItem('teacherAuthed') === '1') {
            renderTeacher();
        } else {
            showTeacherLogin();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        navigate('home');
    }

    // 离开教师页时停止实时刷新
    if (hash !== 'teacher') stopLiveRefresh();

    updateStepper();
}

// ====== 更新步骤器 ======
function updateStepper() {
    const hash = location.hash.replace('#', '') || 'home';
    
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active', 'completed');
        const stage = item.dataset.stage;
        
        // 完成状态
        if (stage >= 1 && stage <= 4 && state.progress[stage]?.completed) {
            item.classList.add('completed');
            const num = item.querySelector('.step-number');
            num.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        } else if (stage >= 1 && stage <= 4) {
            item.querySelector('.step-number').textContent = stage;
        }
        
        // 活跃状态
        if (hash === 'home' && stage === 'home') item.classList.add('active');
        else if (hash === 'report' && stage === 'report') item.classList.add('active');
        else if (hash === `stage${stage}`) item.classList.add('active');
    });
    
    // 进度条
    let completed = 0;
    for (let i = 1; i <= 4; i++) if (state.progress[i]?.completed) completed++;
    const pct = Math.round((completed / 4) * 100);
    $('progressFill').style.width = pct + '%';
    $('progressText').textContent = pct + '%';
}

// ====== 渲染首页 ======
function renderLanding() {
    // 检查是否有保存的进度
    const hasProgress = Object.values(state.progress).some(p => p.qIdx > 0 || p.completed);
    const banner = $('resumeBanner');
    
    if (hasProgress) {
        const completedStages = Object.entries(state.progress).filter(([k,v]) => v.completed).map(([k]) => k);
        const inProgress = Object.entries(state.progress).filter(([k,v]) => !v.completed && v.qIdx > 0).map(([k]) => k);
        
        let detail = '';
        if (completedStages.length) detail += `已完成阶段：${completedStages.join('、')}；`;
        if (inProgress.length) detail += `进行中：阶段${inProgress.join('、')}`;
        if (!detail) detail = '检测到历史学习记录';
        
        $('resumeDetail').textContent = detail;
        banner.hidden = false;
    } else {
        banner.hidden = true;
    }
    
    // 渲染水平选择卡片
    renderLevelCard();

    // 渲染模块卡片
    const grid = $('modulesGrid');
    grid.innerHTML = '';

    const stageKeys = Object.keys(stages).map(Number).sort((a,b) => a-b);
    for (const i of stageKeys) {
        const stage = stages[i];
        const prog = state.progress[i];
        const isAI = stage.type === 'ai_chat';
        const isGuide = stage.type === 'data_guide';
        const totalQs = isAI ? 0 : (stage.questions?.length || 0);
        const answered = prog?.qIdx || 0;
        const isComplete = prog?.completed || (isAI && aiChatHistory.length > 0);

        const card = document.createElement('div');
        card.className = `module-card ${isComplete ? 'completed' : ''} ${isAI ? 'module-card-ai' : ''}`;
        card.onclick = () => navigate(`stage${i}`);

        // 进度点
        let dotsHtml = '';
        if (isAI) {
            dotsHtml = '<div class="module-ai-badge">🤖 AI 自由对话</div>';
        } else if (isGuide) {
            dotsHtml = '<div class="module-ai-badge">📍 数据源导航</div>';
        } else {
            for (let j = 0; j < totalQs; j++) {
                if (j < answered || isComplete) dotsHtml += '<div class="module-dot completed"></div>';
                else dotsHtml += '<div class="module-dot"></div>';
            }
        }

        const progressText = isAI
            ? 'AI 导师全程陪伴'
            : isGuide
                ? (isComplete ? '已完成' : '资源导航模式 · 直接获取数据路径')
                : isComplete
                    ? '已完成'
                    : answered > 0
                        ? `进度 ${answered}/${totalQs}`
                        : '未开始';

        card.innerHTML = `
            <div class="module-card-header">
                <div class="module-icon">
                    <svg width="24" height="24" viewBox="0 0 28 28" fill="none">${stage.icon}</svg>
                </div>
                <div class="module-info">
                    <div class="module-tag">${stage.tag}</div>
                    <div class="module-title">${stage.title}</div>
                </div>
            </div>
            <div class="module-desc">${stage.desc}</div>
            <div class="module-progress">
                <div class="module-progress-dots">${dotsHtml}</div>
                <span>${progressText}</span>
            </div>
            <div class="module-footer">
                <button class="btn-primary" style="padding:8px 20px;font-size:14px" onclick="event.stopPropagation();navigate('stage${i}')">
                    ${isAI ? '进入论文设计' : (isComplete ? '复习此阶段' : (answered > 0 ? '继续学习' : '进入此阶段'))}
                </button>
                <div class="module-link" onclick="event.stopPropagation();copyLink('stage${i}')">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 8L8 4M5 3L7 5M3 5L5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/></svg>
                    #stage${i}
                </div>
            </div>
        `;
        grid.appendChild(card);
    }
}

function copyLink(stageHash) {
    const url = `${location.origin}${location.pathname}#${stageHash}`;
    navigator.clipboard?.writeText(url).then(() => {
        showToast('链接已复制', 'success');
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('链接已复制', 'success');
    });
}

function resumeProgress() {
    // 找到第一个未完成的阶段
    for (let i = 1; i <= 4; i++) {
        if (!state.progress[i].completed) {
            navigate(`stage${i}`);
            return;
        }
    }
    // 全部完成，去报告
    navigate('report');
}

function resetAllProgress() {
    if (!confirm('确定要清除所有学习进度吗？此操作不可撤销。')) return;
    state = JSON.parse(JSON.stringify(defaultState));
    saveState();
    renderLanding();
    updateStepper();
    showToast('进度已重置', 'success');
}

// ====== 渲染阶段 ======
async function renderStage(stageNum) {
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];

    // ★ 高手档工具模式：所有研究阶段都直接呈现专业工具，不走 Q&A
    const lv = currentLevel();
    if (lv === 'advanced' && stage && stage.type !== 'ai_chat') {
        // 数据获取阶段在 advanced 模式也走工具版（更详尽的可执行步骤）
        $('stageLinkDisplay').textContent = `${location.origin}${location.pathname}#stage${stageNum}`;
        if (!prog.startTime) prog.startTime = Date.now();
        prog.lastAccess = Date.now();
        saveState();
        resetAIChatForStage(stageNum);
        renderProToolStage(stageNum);
        return;
    }

    // 阶段五（论文设计）走专用 AI 渲染
    if (stage && stage.type === 'ai_chat') {
        $('stageLinkDisplay').textContent = `${location.origin}${location.pathname}#stage${stageNum}`;
        resetAIChatForStage(stageNum);
        renderPaperStage(stageNum);
        return;
    }

    // 阶段二（数据获取）走数据源导航渲染：直接给出取数路径
    if (stage && stage.type === 'data_guide') {
        $('stageLinkDisplay').textContent = `${location.origin}${location.pathname}#stage${stageNum}`;
        if (!prog.startTime) prog.startTime = Date.now();
        prog.lastAccess = Date.now();
        saveState();
        resetAIChatForStage(stageNum);
        renderDataGuideStage(stageNum);
        return;
    }

    // 记录访问时间
    if (!prog.startTime) prog.startTime = Date.now();
    prog.lastAccess = Date.now();
    saveState();

    // 显示链接
    $('stageLinkDisplay').textContent = `${location.origin}${location.pathname}#stage${stageNum}`;

    // 切换 AI 上下文
    resetAIChatForStage(stageNum);

    const container = $('stageContainer');
    
    // 如果已完成，显示完成总结
    let summaryHtml = '';
    if (prog.completed) {
        summaryHtml = getStageSummary(stageNum);
    }
    
    // 子步骤（仅阶段4）
    let subStepsHtml = '';
    if (stageNum === 4) {
        const currentQ = stage.questions[prog.qIdx];
        const currentSub = currentQ?.subStep || 1;
        subStepsHtml = `
            <div class="sub-steps" id="subSteps">
                <div class="sub-step ${currentSub === 1 ? 'active' : ''}" data-substep="1"><span class="sub-step-num">4.1</span><span class="sub-step-label">前置检验</span></div>
                <div class="sub-step ${currentSub === 2 ? 'active' : ''}" data-substep="2"><span class="sub-step-num">4.2</span><span class="sub-step-label">模型方程式</span></div>
                <div class="sub-step ${currentSub === 3 ? 'active' : ''}" data-substep="3"><span class="sub-step-num">4.3</span><span class="sub-step-label">计算拆解</span></div>
                <div class="sub-step ${currentSub === 4 ? 'active' : ''}" data-substep="4"><span class="sub-step-num">4.4</span><span class="sub-step-label">显著性判定</span></div>
            </div>
        `;
    }
    
    container.innerHTML = `
        <div class="stage-header">
            <div class="stage-tag">${stage.tag}</div>
            <h2>${stage.title}</h2>
            <p class="stage-intro">${stage.intro}</p>
        </div>
        ${levelChipBarHtml()}
        ${subStepsHtml}
        <div class="dialogue-area" id="dialogueArea"></div>
        <div id="dynamicArea"></div>
        ${summaryHtml}
    `;
    
    // 恢复历史对话
    await restoreDialogue(stageNum);
    
    // 如果未完成，显示当前问题
    if (!prog.completed && prog.qIdx < stage.questions.length) {
        await askQuestion(stageNum);
    }
}

// ===== PRO 工具 · 阶段一：辅助函数 =====
function runPro1Generate() {
    const O = $('pro1Obj')?.value.trim() || 'XXX';
    const Y = $('pro1Y')?.value.trim() || 'YYY';
    const lens = $('pro1Lens')?.value;
    const map = {
        causal: ['因果', 'X 是否构成 Y 的原因 / 处理效应', '<strong>反事实框架</strong>'],
        effect: ['效应大小', 'X 对 Y 的影响量级（百分点 / 弹性）', '<strong>弹性解释</strong>'],
        mech: ['机制', 'X 通过什么中间渠道影响 Y', '<strong>中介效应检验</strong>'],
        heterogeneity: ['异质性', 'X 对 Y 的影响在不同子样本的差异', '<strong>分组回归</strong>']
    };
    const [_, __, framework] = map[lens];
    const yShort = Y.replace(/^[a-z]+\((.+)\)$/i, '$1').slice(0, 8);
    const templates = [
        `<strong>「${O}是否促进了${Y}？」</strong> — 视角：${framework}，估计 X 的处理效应。需要固定效应 + 聚类稳健标准误。`,
        `<strong>「${O}对${Y}的影响有多大？」</strong> — 估计 β₁ 并报告经济显著性（基准值 × 100% 量级）。`,
        `<strong>「${O}的影响是否存在异质性？按东中西部 / 城乡 / 行业分组」</strong> — 重点考察分组回归系数差异。`
    ];
    $('pro1Out').innerHTML = `
        <div class="pro-tool-out-title">📝 3 条候选研究问题（按推荐度排序）</div>
        <ol class="pro-tool-out-list">
            ${templates.map(t => `<li>${t}</li>`).join('')}
        </ol>
        <div class="pro-tool-out-foot">下一步：进入 <strong>研究问题模板</strong>填写 Y / X；进入 <strong>变量定义模板</strong>确认衡量方式与数据源；进入 <strong>模型公式</strong>得到回归方程。</div>
    `;
}

function updatePro1Formula() {
    const type = $('pro1ModelType')?.value || 'ols';
    const hasI = $('pro1Interact')?.checked;
    const iTerm = hasI ? ' + β₃X×M' : '';
    const formulas = {
        ols:     `Y<sub>i,t</sub> = β₀ + β₁X<sub>i,t</sub>${iTerm} + γ·Controls<sub>i,t</sub> + ε<sub>i,t</sub>`,
        fe:      `Y<sub>i,t</sub> = α<sub>i</sub> + λ<sub>t</sub> + β₁X<sub>i,t</sub>${iTerm} + γ·Controls<sub>i,t</sub> + ε<sub>i,t</sub>`,
        did:     `Y<sub>i,t</sub> = β₀ + β₁(Treat<sub>i</sub>×Post<sub>t</sub>)${iTerm} + α<sub>i</sub> + λ<sub>t</sub> + γ·Controls<sub>i,t</sub> + ε<sub>i,t</sub>`,
        iv:      `一阶段：X<sub>i,t</sub> = π₀ + π₁Z<sub>i,t</sub> + π₂·Controls + ν<sub>i,t</sub>\n二阶段：Y<sub>i,t</sub> = β₀ + β₁X̂<sub>i,t</sub>${iTerm} + γ·Controls + ε<sub>i,t</sub>  （β₁ 即 IV 估计量）`,
        gmm:     `Y<sub>i,t</sub> = β₀ + β₁Y<sub>i,t-1</sub> + β₂X<sub>i,t</sub>${iTerm} + γ·Controls<sub>i,t</sub> + α<sub>i</sub> + λ<sub>t</sub> + ε<sub>i,t</sub>\n（系统 GMM，工具变量为 Y 的滞后项，使用 xtabond2）`
    };
    const fEl = $('pro1Formula');
    if (fEl) fEl.innerHTML = (formulas[type] || '').replace(/\n/g, '<br>');
}

function copyFormula() {
    const txt = $('pro1Formula')?.textContent || '';
    if (!txt) return;
    navigator.clipboard?.writeText(txt);
    showToast('已复制 LaTeX 公式到剪贴板', 'success');
}

// ===== PRO 工具 · 阶段二：辅助函数（取数代码生成） =====
function generateAkShareCode() {
    const t = $('pro2DataType')?.value;
    const presets = {
        macro: `# -*- coding: utf-8 -*-
import akshare as ak
import pandas as pd

# 中国宏观数据：GDP/CPI/M2 等
# 详见 https://akshare.akfamily.xyz/data/macro/macro.html
gdp_df = ak.macro_china_gdp()
print(gdp_df.head())
gdp_df.to_csv('gdp_quarterly.csv', index=False)

# CPI 月度
cpi_df = ak.macro_china_cpi()
print(cpi_df.tail())
`,
        stock: `# -*- coding: utf-8 -*-
import akshare as ak
df = ak.stock_zh_a_hist(symbol="000001", period="daily",
                         start_date="20150101", end_date="20251231", adjust="qfq")
print(df.head())
df.to_csv('stock_000001.csv', index=False)
`,
        futures: `import akshare as ak
df = ak.futures_main_sina(symbol="CU0")  # 沪铜主力
print(df.tail())
`,
        fund: `import akshare as ak
df = ak.fund_open_fund_info_em(fund="000001", indicator="单位净值")
print(df.tail())
`,
        exchange: `import akshare as ak
# 人民币兑美元中间价
df = ak.fx_spot_quote()
print(df.tail())
# SHIBOR
sh = ak.rate_interbank_shanghai_indicator()
print(sh.tail())
`
    };
    $('pro2Code').textContent = presets[t] || '请先选择数据类型';
}
function generateStataCode() {
    const s = $('pro2StataSrc')?.value;
    const presets = {
        csmar: `* ===========================================
 * CSMAR CSV 文件读取（典型中文编码 GBK → UTF-8）
 * ===========================================
cd "D:/myproject/data"

* 步骤 1：读取（注意 CSMAR 默认编码 GBK，可加 encoding 选项）
import delimited "firm_finance_2020.csv", clear encoding("utf-8")

* 步骤 2：清洗
destring total_asset, replace force
gen ln_asset = ln(total_asset)
gen year = year(date)

* 步骤 3：保存为 Stata 格式
save "firm_finance_clean.dta", replace

* 步骤 4：批量合并多年面板（forvalues）
forvalues y = 2015/2024 {
    import delimited "firm_finance_y.csv", clear encoding("utf-8")
    destring total_asset, replace force
    gen ln_asset = ln(total_asset)
    append using "firm_finance_clean.dta", force
    save "firm_finance_clean.dta", replace
}
`,
        stats: `* 国家统计局 Excel 文件读取
import excel "gdp_quarterly.xlsx", sheet("Sheet1") firstrow clear

* 透视：长格式
reshape long gdp, i(quarter) j(indicator)

* 转数值并取对数
destring gdp, replace force
gen lngdp = ln(gdp)
save "gdp.dta", replace
`,
        wind: `* Wind 导出 CSV（UTF-8 编码）
import delimited "wind_export.csv", clear

* 合并代码转换（股票代码首列）
replace stkcd = "0" + stkcd if length(stkcd) == 5

* 排序保存
sort stkcd year month
save "wind_panel.dta", replace
`,
        tushare: `* Tushare API（先在 Python 取数后传给 Stata）
shell:
pip install tushare pandas
python3 get_data.py

* 然后导入 Python 生成的 CSV
import delimited "panel_from_tushare.csv", clear
`
    };
    $('pro2StataCode').textContent = presets[s] || '请先选择数据源';
}
function generateIntlCode() {
    const s = $('pro2IntlSrc')?.value;
    const presets = {
        wdi: `# World Bank WDI（直接 pip 安装 wbdata 或用 pandas_datareader）
import pandas_datareader.wb as wb
df = wb.download(indicator='NY.GDP.PCAP.KD', country=['CN','US','JP'], start=2000, end=2024)
df.reset_index().to_csv('wdi_gdp_pc.csv', index=False)
`,
        imf: `from pandas_datareader import data as pdr
# IMF 国际金融统计（需要 pandas_datareader ≥ 0.10）
df = pdr.DataReader('NGDP_RPCH', 'imf', 2000, 2024)
df.to_csv('imf_gdp_growth.csv')
`,
        oecd: `from pandas_datareader import data as pdr
df = pdr.DataReader('GDP', 'oecd', 2000, 2024)
df.to_csv('oecd_gdp.csv')
`,
        comtrade: `# UN Comtrade（免费 API）
import requests, pandas as pd
url = "https://comtradeapi.un.org/data/v1/get"
params = {"re":"156", "ps":"2023", "cmd":"HS", "freq":"A", "px":"HS",
          "r":"all", "p":"0", "rg":"all", "cc":"TOTAL", "fmt":"json"}
r = requests.get(url, params=params).json()
df = pd.DataFrame(r['data'])
df.to_csv('comtrade_export_2023.csv', index=False)
`
    };
    $('pro2IntlCode').textContent = presets[s] || '请先选择数据源';
}

// ===== PRO 工具 · 阶段三：CSV 清洗 =====
let _ptRows = null;          // 当前清洗后的数据（二维数组）
let _ptHistory = [];         // 操作历史
let _ptFreqCols = [];        // 频度对齐候选列（数值）
let _ptMissingCols = [];     // 缺失候选列
let _ptLogCols = [];         // 对数化候选列（正值）

// 简易 CSV 解析（支持引号转义、最多 5000 行）
function parseCSV(text, delimiter) {
    delimiter = delimiter || (text.indexOf('\t') >= 0 && text.indexOf(',') < 0 ? '\t' : ',');
    const rows = [];
    let i = 0, field = '', row = [], inQuote = false;
    while (i < text.length && rows.length < 5001) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"') {
                if (text[i+1] === '"') { field += '"'; i += 2; continue; }
                inQuote = false; i++; continue;
            }
            field += ch; i++;
        } else {
            if (ch === '"') { inQuote = true; i++; continue; }
            if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
            if (ch === '\n' || ch === '\r') {
                if (field !== '' || row.length) { row.push(field); rows.push(row); field = ''; row = []; }
                if (ch === '\r' && text[i+1] === '\n') i++;
                i++; continue;
            }
            field += ch; i++;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function loadProSampleData(ev) {
    ev?.stopPropagation?.();
    // 30 行月度面板，含故意缺失值（用于演示完整清洗链路）
    const sample = `year,month,gdp_idx,cpi,m2,retail\n2018,1,100.0,101.5,168.1,3758\n2018,2,99.6,101.8,167.9,\n2018,3,100.3,102.1,170.2,3782\n2018,4,,101.8,169.4,3801\n2018,5,101.2,101.6,170.3,3854\n2018,6,101.5,101.7,171.0,3892\n2018,7,102.1,102.0,170.8,3921\n2018,8,102.3,,171.2,3944\n2018,9,102.7,102.4,171.8,3968\n2018,10,103.0,102.5,171.9,3981\n2018,11,103.2,102.3,171.5,\n2018,12,103.4,102.1,171.6,4012\n2019,1,103.8,102.0,172.1,4033\n2019,2,104.0,101.9,172.3,4065\n2019,3,104.5,,172.8,4098\n2019,4,104.6,102.1,173.1,4110\n2019,5,105.1,102.3,173.5,4132\n2019,6,105.3,102.5,174.0,4151\n2019,7,105.6,102.6,173.8,4170\n2019,8,106.0,102.7,174.2,4188\n2019,9,106.1,102.9,174.5,4210\n2019,10,106.5,103.1,174.8,4228\n2019,11,107.0,103.3,175.0,4240\n2019,12,107.3,103.4,175.3,4261\n2020,1,107.5,103.6,175.8,4275\n2020,2,,103.9,176.2,4288\n2020,3,107.9,104.2,176.5,4295\n2020,4,108.0,104.5,177.0,4302\n2020,5,108.4,104.7,177.3,4320\n2020,6,108.6,,177.8,4340\n`;
    handleCsvText('（示例数据）月度面板 30 行', sample);
}

function handleCsvText(name, text) {
    const rows = parseCSV(text);
    if (rows.length < 2) { showToast('CSV 为空或无法解析', 'error'); return; }
    _ptRows = rows;
    _ptHistory = [];
    addPtHistory(`加载数据：${name}，${rows.length - 1} 行 × ${rows[0].length} 列`);
    renderPtPreview();
    setupDragDrop();
    showPtSteps(2);
    bindPtSelects();
}

function renderPtPreview() {
    const head = _ptRows[0];
    const data = _ptRows.slice(1, 6);
    const missingByCol = head.map((_, ci) => {
        let missing = 0;
        for (let r = 1; r < _ptRows.length; r++) {
            const v = _ptRows[r][ci];
            if (v === undefined || v === null || v === '' || v === 'NaN') missing++;
        }
        return missing;
    });
    const html = `<table class="pt-table">
        <thead><tr>${head.map((h, i) => `<th>${h}${missingByCol[i] ? ` <span style="color:#e74c3c">(${missingByCol[i]} 缺失)</span>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${data.map(r => `<tr>${r.map((c, i) => {
            const miss = c === undefined || c === null || c === '' || c === 'NaN';
            return `<td>${miss ? '<span class="pt-cell-missing">空缺</span>' : escapeHtml(c)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
    </table>`;
    $('ptPreview').innerHTML = html;
    $('ptMeta').innerHTML = `共 <strong>${_ptRows.length - 1}</strong> 行 × <strong>${_ptRows[0].length}</strong> 列；
        ${missingByCol.filter(x => x).length} 列含缺失值，总缺失 <strong>${missingByCol.reduce((a,b)=>a+b,0)}</strong> 个`;
}

function bindPtSelects() {
    if (!_ptRows) return;
    const head = _ptRows[0];
    _ptFreqCols = []; _ptMissingCols = []; _ptLogCols = [];
    for (let ci = 1; ci < head.length; ci++) {
        const vals = [];
        for (let r = 1; r < _ptRows.length; r++) {
            const v = parseFloat(_ptRows[r][ci]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length >= 3) _ptFreqCols.push({ ci, name: head[ci] });
    }
    for (let ci = 1; ci < head.length; ci++) {
        let hasMiss = false;
        for (let r = 1; r < _ptRows.length; r++) {
            const v = _ptRows[r][ci];
            if (v === undefined || v === null || v === '' || v === 'NaN') { hasMiss = true; break; }
        }
        if (hasMiss) _ptMissingCols.push({ ci, name: head[ci] });
    }
    for (let ci = 1; ci < head.length; ci++) {
        const vals = [];
        for (let r = 1; r < _ptRows.length; r++) {
            const v = parseFloat(_ptRows[r][ci]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length >= 3 && vals.every(v => v > 0)) _ptLogCols.push({ ci, name: head[ci] });
    }
    const opt = (cols, idx) => cols.map(c => `<option value="${c.ci}">${c.name}</option>`).join('');
    if ($('ptFreqCols')) $('ptFreqCols').innerHTML = opt(_ptFreqCols);
    if ($('ptMissingCols')) $('ptMissingCols').innerHTML = opt(_ptMissingCols);
    if ($('ptLogCols')) $('ptLogCols').innerHTML = opt(_ptLogCols);
}

function showPtSteps(from) {
    const steps = ['ptPreviewStep','ptFreqStep','ptMissingStep','ptLogStep','ptExportStep'];
    for (let i = 0; i < steps.length; i++) {
        const el = $(steps[i]); if (!el) continue;
        const stepN = i + 2;     // 步骤 2-6
        if (stepN >= from) el.hidden = false;
    }
    if (from >= 7 && $('proStage3Finish')) $('proStage3Finish').hidden = false;
}

function setupDragDrop() {
    const z = $('ptUploadZone');
    if (!z) return;
    ['dragenter','dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('drag'); }));
    z.addEventListener('drop', e => {
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => handleCsvText(f.name, r.result);
        r.readAsText(f);
    });
    $('ptFileInput').onchange = e => {
        const f = e.target.files?.[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => handleCsvText(f.name, r.result);
        r.readAsText(f);
    };
}

function doFreqAlign() {
    if (!_ptRows) return;
    const target = $('ptFreqTarget').value;        // quarter / year / year-end
    const selIdx = Array.from($('ptFreqCols').selectedOptions).map(o => parseInt(o.value));
    if (!selIdx.length) { showToast('请选择至少一列', 'error'); return; }
    const head = _ptRows[0];
    const data = _ptRows.slice(1);
    if (!head.includes('year') || !head.includes('month')) {
        showToast('需有 year/month 列才能频度对齐', 'error'); return;
    }
    const yi = head.indexOf('year'), mi = head.indexOf('month');
    const grouped = {};
    for (const r of data) {
        const yr = parseInt(r[yi]); const mo = parseInt(r[mi]);
        if (isNaN(yr) || isNaN(mo)) continue;
        const key = target === 'year' ? `${yr}` : `${yr}-${Math.floor((mo - 1) / 3) + 1}`;
        (grouped[key] = grouped[key] || []).push(r);
    }
    const sortedKeys = Object.keys(grouped).sort();
    const newHead = head.slice();
    const newRows = sortedKeys.map(k => { const g = grouped[k]; const first = g[0]; const out = first.slice(); out[yi] = k.split('-')[0]; out[mi] = target === 'year' ? '' : k.split('-')[1]; for (const ci of selIdx) { const vals = g.map(r => parseFloat(r[ci])).filter(v => !isNaN(v)); if (!vals.length) continue; if (target === 'year-end') { out[ci] = String(vals[vals.length - 1]); } else { out[ci] = String(vals.reduce((a,b)=>a+b,0) / vals.length); } } return out; });
    _ptRows = [newHead, ...newRows];
    addPtHistory(`频度对齐 → ${target}（${sortedKeys.length} 期）`);
    renderPtPreview(); bindPtSelects(); showPtSteps(4);
}

function doMissing() {
    if (!_ptRows) return;
    const method = $('ptMissingMethod').value;
    const selIdx = Array.from($('ptMissingCols').selectedOptions).map(o => parseInt(o.value));
    if (!selIdx.length) { showToast('请选择至少一列', 'error'); return; }
    let filled = 0;
    for (const ci of selIdx) {
        const col = _ptRows.slice(1).map(r => parseFloat(r[ci]));
        if (method === 'drop') {
            _ptRows = [_ptRows[0], ..._ptRows.slice(1).filter((r, i) => !isNaN(col[i]))];
            filled += col.filter(isNaN).length; continue;
        }
        for (let i = 0; i < col.length; i++) {
            if (!isNaN(col[i])) continue;
            let v = NaN;
            if (method === 'linear') { let p = NaN, n = NaN; for (let k = 0; k < i; k++) if (!isNaN(col[k])) p = col[k]; for (let k = i + 1; k < col.length; k++) if (!isNaN(col[k])) { n = col[k]; break; } v = isNaN(p) || isNaN(n) ? p : (p + n) / 2; }
            else if (method === 'ffill') { for (let k = i - 1; k >= 0; k--) if (!isNaN(col[k])) { v = col[k]; break; } }
            else if (method === 'bfill') { for (let k = i + 1; k < col.length; k++) if (!isNaN(col[k])) { v = col[k]; break; } }
            else if (method === 'mean') { v = col.filter(x => !isNaN(x)).reduce((a,b)=>a+b,0) / col.filter(x => !isNaN(x)).length; }
            if (!isNaN(v)) { col[i] = v; _ptRows[i + 1][ci] = String(v); filled++; }
        }
    }
    addPtHistory(`缺失值处理：${method}（${filled} 个填充）`);
    renderPtPreview(); bindPtSelects(); showPtSteps(5);
    showMissingSummary(selIdx);
}

function showMissingSummary(selIdx) {
    const head = _ptRows[0];
    const html = selIdx.map(ci => {
        let missing = 0;
        for (let r = 1; r < _ptRows.length; r++) if (!_ptRows[r][ci] || _ptRows[r][ci] === 'NaN') missing++;
        return missing;
    }).reduce((a,b)=>a+b,0);
    $('ptMissingSummary').innerHTML = html === 0
        ? `<span class="pt-missing-ok">✓ 选中列缺失值已全部处理</span>`
        : `<div>处理后剩余缺失：<strong>${html}</strong> 个</div>`;
}

function doLogTransform() {
    if (!_ptRows) return;
    const selIdx = Array.from($('ptLogCols').selectedOptions).map(o => parseInt(o.value));
    if (!selIdx.length) { showToast('请选择至少一列', 'error'); return; }
    const head = _ptRows[0];
    let added = 0;
    for (const ci of [...selIdx].sort((a,b)=>b-a)) {
        const colName = 'ln_' + head[ci];
        head.splice(ci + 1, 0, colName);
        for (let r = 1; r < _ptRows.length; r++) {
            const v = parseFloat(_ptRows[r][ci]);
            _ptRows[r].splice(ci + 1, 0, v > 0 ? String(Math.log(v).toFixed(6)) : '');
        }
        added++;
    }
    addPtHistory(`对数化：新增 ${added} 个 ln_ 列`);
    renderPtPreview(); bindPtSelects(); showPtSteps(6);
    renderPtHistory();
}

function addPtHistory(desc) {
    _ptHistory.push({ ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), desc });
    renderPtHistory();
    if ($('ptExportStep')) $('ptExportStep').hidden = false;
    if ($('proStage3Finish')) $('proStage3Finish').hidden = false;
}

function renderPtHistory() {
    const el = $('ptHistory');
    if (!el) return;
    if (!_ptHistory.length) { el.innerHTML = '<div class="pt-history-empty">尚无操作</div>'; return; }
    el.innerHTML = _ptHistory.map((h, i) => `
        <div class="pt-history-item"><span class="pt-history-ts">${h.ts}</span>
            <span class="pt-history-desc">${i + 1}. ${h.desc}</span>
        </div>
    `).join('');
}

function exportCleanedCSV() {
    if (!_ptRows) return;
    const text = _ptRows.map(r => r.map(c => /[",\n]/.test(c || '') ? `"${(c||'').replace(/"/g,'""')}"` : c).join(',')).join('\n');
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cleaned_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
}

// ===== PRO 工具 · 阶段四：辅助函数 =====
function renderPro4Code() {
    const Y = $('pro4Y')?.value.trim() || 'Y';
    const X = $('pro4X')?.value.trim() || 'X';
    const C = $('pro4C')?.value.trim() || '';
    const fe = $('pro4FE')?.checked;
    const cl = $('pro4Cluster')?.value || 'none';
    const lang = $('pro4Lang')?.value || 'stata';
    const feTerm = fe ? ' i.year' : '';
    const fePanel = fe ? ', absorb(id)' : '';
    const clStata = { none: '', id: ', vce(cluster id)', time: ', vce(cluster year)', id_time: ', vce(cluster id year)' }[cl];
    const clR = { none: '~', id: '~id', time: '~year', id_time: '~id+year' }[cl];
    const clPy = { none: 'OLS', id: 'ClusteredDataPoints(cov_type="clustered", cluster_entity=True)', time: 'ClusteredDataPoints(cov_type="clustered", cluster_time=True)', id_time: 'ClusteredDataPoints(cov_type="clustered", cluster_entity=True, cluster_time=True)' }[cl];
    const cTrim = C.replace(/\s+/g, ' ').trim();
    let code = '';
    if (lang === 'stata') {
        code = `* Stata OLS / FE 回归
reg ${Y} ${X} ${cTrim}${feTerm}, ${clStata.replace(/^, /,'')}\n
eststo m1\n
* 双向固定效应版
xtset id year
xtreg ${Y} ${X} ${cTrim}${feTerm}, fe ${clStata.replace(/^, /,'')}\n
eststo m2\n
esttab m1 m2 using "results.rtf", se star(* 0.1 ** 0.05 *** 0.01) ar2(%9.3f) replace`;
    } else if (lang === 'r') {
        code = `# R (fixest 包)
library(fixest)
reg1 = feols(${Y} ~ ${X} ${cTrim} | ${fe ? 'id + year' : '1'} ${cl ? '| ' + clR[cl] : ''}, data = df)
summary(reg1)
# 双向固定效应版
reg2 = feols(${Y} ~ ${X} ${cTrim} | id + year${cl ? ' | ' + clR[cl] : ''}, data = df)
etable(reg1, reg2, se = TRUE)`;
    } else {
        code = `# Python (linearmodels)
from linearmodels.panel import PanelOLS
import pandas as pd
df = pd.read_csv("your_data.csv").set_index(["id","year"])
mod = PanelOLS.from_formula("${Y} ~ 1 + ${X} ${cTrim} ${fe ? '+ EntityEffects + TimeEffects' : ''}".replace('1 + 1','1'), data=df)
res = mod.fit(cov_type='${clPy}')
print(res.summary)`;
    }
    $('pro4Code').textContent = code;
}

function renderPro4Endog() {
    const active = document.querySelector('.pro-endog-tab.active')?.dataset.et || 'did';
    const presets = {
        did: `* ====== 双重差分 DID ======
* 政策处理：DID = Treat × Post
gen did = treat * post

* 1) 平行趋势检验（必需！）
forvalues t = -5/5 {
    gen pre_t = (year_diff == t)
    reg Y pre_* treat controls, cluster(id)
}

* 2) 估计 DID
reg Y did controls i.year i.id, cluster(id)
eststo m1

* 3) 事件研究法（更稳健）
reghdfe Y did_5 did_4 did_3 did_2 post_2 post_3, absorb(id year) cluster(id)
eststo m2`,
        iv: `* ====== 工具变量 IV / 2SLS ======
* 第一阶段：X = π0 + π1 Z + controls + ν
reg X Z controls, cluster(id)
predict X_hat, xb

* 第二阶段：Y = β0 + β1 X_hat + controls + ε
reg Y X_hat controls, cluster(id)

* 或直接用 ivregress：
ivregress 2sls Y controls (X = Z), cluster(id)
estat firststage    // 第一阶段 F 统计量（≥10 才有效）
estat overid        // 过度识别检验（恰好识别则跳过）`,
        psm: `* ====== 倾向得分匹配 PSM ======
* 1) 估计倾向得分
psmodel, treat(X) covariates(controls) logit
predict pscore, ps

* 2) 最近邻匹配
psmatch2 X, pscore(pscore) neighbor(1) caliper(0.05)

* 3) 计算 ATT
pstest controls, both treated
* → 匹配后两组协变量应无显著差异`,
        rdd: `* ====== 断点回归 RDD ======
* 1) 局部线性回归 + 带宽选择
rdd Y X, cutvalue(0) kernel(triangular) bwselect(mserd)

* 2) 稳健性：换带宽 + 换核函数
rdd Y X, cutvalue(0) kernel(uniform) h(0.5)
rdd Y X, cutvalue(0) kernel(uniform) h(1.5)

* 3) 协变量检验（操控变量在断点处不应有跳跃）
rdd controls X, cutvalue(0) kernel(triangular)`
    };
    $('proEndogOut').textContent = presets[active] || '';
}

// 阶段四 内生性标签切换
document.addEventListener('click', e => {
    if (e.target.classList?.contains('pro-endog-tab')) {
        document.querySelectorAll('.pro-endog-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
    }
});

// ===== PRO 工具 · 在 init 时绑定 =====
function bindProInit() {
    setTimeout(() => {
        updatePro1Formula();
        if ($('ptFreqCols')) setupDragDrop();
    }, 100);
}

// ====== 阶段二：数据源导航渲染（直接给出取数路径，不设问） ======
function renderDataGuideStage(stageNum) {
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];
    const g = stage.guide;
    const container = $('stageContainer');

    // 数据源卡片（按分类）
    const catTabs = g.categories.map((c, i) =>
        `<div class="dg-tab ${i === 0 ? 'active' : ''}" data-cat="${c.id}" onclick="switchDgTab('${c.id}')"><span class="dg-tab-icon">${c.icon}</span>${c.label}</div>`
    ).join('');

    const catPanels = g.categories.map((c, i) => `
        <div class="dg-panel ${i === 0 ? 'active' : ''}" data-panel="${c.id}">
            <p class="dg-tip">${c.tip}</p>
            <div class="dg-grid">
                ${c.sources.map(s => `
                    <div class="dg-card">
                        <div class="dg-card-head">
                            <div class="dg-card-name">${s.name}</div>
                            <a class="dg-card-link" href="${s.url}" target="_blank" rel="noopener">进入官网 ↗</a>
                        </div>
                        <div class="dg-card-body">${s.content}</div>
                        <div class="dg-card-meta">
                            <span class="dg-meta-item"><strong>频度：</strong>${s.freq}</span>
                        </div>
                        <div class="dg-card-how"><strong>取数路径：</strong>${s.how}</div>
                        ${s.steps ? `
                        <details class="dg-steps">
                            <summary>📋 分步操作指南（点哪里 / 找什么 / 为什么）</summary>
                            <ol class="dg-step-list">
                                ${s.steps.map(st => `
                                    <li>
                                        <div class="dg-step-act">▸ ${st.act}</div>
                                        ${st.where ? `<div class="dg-step-where">📍 位置：${st.where}</div>` : ''}
                                        ${st.find ? `<div class="dg-step-find">🔍 找什么：${st.find}</div>` : ''}
                                        ${st.why ? `<div class="dg-step-why">💡 为什么：${st.why}</div>` : ''}
                                    </li>
                                `).join('')}
                            </ol>
                            ${s.indicators ? `<div class="dg-step-indicators"><strong>📊 常见指标举例：</strong>${s.indicators}</div>` : ''}
                            ${s.pitfall ? `<div class="dg-step-pitfall"><strong>⚠️ 避坑：</strong>${s.pitfall}</div>` : ''}
                        </details>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    // 三类数据取数地图
    const mapRows = g.dataMap.map(m => `
        <div class="dg-map-row">
            <div class="dg-map-type">${m.type}</div>
            <div class="dg-map-channel">${m.channel}</div>
            <div class="dg-map-eg">${m.example}</div>
        </div>
    `).join('');

    // 渠道优先级
    const prioRows = g.priority.map(p => `
        <div class="dg-prio ${p.rank === '✕' ? 'bad' : ''}">
            <div class="dg-prio-rank">${p.rank}</div>
            <div class="dg-prio-body">
                <div class="dg-prio-title">${p.title}</div>
                <div class="dg-prio-desc">${p.desc}</div>
            </div>
        </div>
    `).join('');

    // 避坑清单
    const pitfalls = g.pitfalls.map((p, i) => `
        <div class="dg-pitfall"><span class="dg-pitfall-num">${i + 1}</span>${p}</div>
    `).join('');

    // 阶段一记录的研究变量（帮助学生"对号入座"）
    const rd = state.researchDesign;
    const varsLine = (rd.varY || rd.varX)
        ? `你的研究设计：<strong>${rd.varY || 'Y'}</strong>（Y）← <strong>${rd.varX || 'X'}</strong>（X）${rd.controls ? `，控制变量：${rd.controls}` : ''}。请据此判断你的变量属于哪一类，再点击上方标签查看对应数据源。`
        : '提示：先完成阶段一的研究设计（明确 Y 与 X），再回到这里按变量类型对号入座查找数据源。';

    container.innerHTML = `
        <div class="stage-header">
            <div class="stage-tag">${stage.tag}</div>
            <h2>${stage.title}</h2>
            <p class="stage-intro">${stage.intro}</p>
        </div>

        <div class="dg-banner">
            <div class="dg-banner-icon">📍</div>
            <div class="dg-banner-text">${varsLine}</div>
        </div>

        <div class="dg-section-title"><span class="dg-sec-num">1</span>数据源导航<span class="dg-sec-sub">按变量类型选择标签</span></div>
        <div class="dg-tabs">${catTabs}</div>
        <div class="dg-panels">${catPanels}</div>

        <div class="dg-section-title"><span class="dg-sec-num">2</span>取数地图<span class="dg-sec-sub">做企业层面实证时，三类数据分头去取</span></div>
        <div class="dg-map">
            <div class="dg-map-head">
                <div>数据类型</div><div>首选渠道</div><div>典型变量举例</div>
            </div>
            ${mapRows}
        </div>

        <div class="dg-section-title"><span class="dg-sec-num">3</span>渠道优先级<span class="dg-sec-sub">从上往下依次尝试</span></div>
        <div class="dg-prios">${prioRows}</div>

        <div class="dg-section-title"><span class="dg-sec-num">4</span>避坑清单<span class="dg-sec-sub">取数前必读</span></div>
        <div class="dg-pitfalls">${pitfalls}</div>

        <div id="dynamicArea"></div>
        ${prog.completed ? getStageSummary(stageNum) : ''}
    `;

    // 未完成时显示完成按钮
    if (!prog.completed) renderGuideCompletePanel(stageNum);
}

// 数据源分类标签切换
function switchDgTab(catId) {
    document.querySelectorAll('.dg-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === catId));
    document.querySelectorAll('.dg-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === catId));
}

// 阶段二完成面板（无问答，浏览路径后确认进入下一步）
function renderGuideCompletePanel(stageNum) {
    const area = $('dynamicArea');
    if (!area) return;
    area.innerHTML = `
        <div class="dg-complete-panel">
            <div class="dg-complete-text">
                <strong>已完成浏览？</strong>确认你已找到自己变量对应的数据源与取数路径，即可进入阶段三。对数据源仍有疑问，可在左侧 AI 导师面板直接提问（如"AKShare 怎么下载 GDP 季度数据"）。
            </div>
            <div class="dg-complete-actions">
                <button class="btn-secondary" onclick="continueExplore(${stageNum})">深入探讨数据源问题</button>
                <button class="btn-primary" onclick="completeDataGuide(${stageNum})">我已掌握取数路径，进入下一阶段<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M14 9L10 5M14 9L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
        </div>
    `;
}

// ====== 高手档：每个研究阶段对应一套专业工具（不走 Q&A） ======
function renderProToolStage(stageNum) {
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];
    const container = $('stageContainer');
    const lvChip = `<div class="lv-chip-bar pro">
        <span class="lv-badge pro">🎓 高手档 · PRO 工具模式</span>
        <span class="lv-chip-tip">已跳过所有引导，直接呈现可用的专业工具。每张卡片均可独立使用，所有操作仅在本机完成。</span>
    </div>`;

    const summaryHtml = prog.completed ? getStageSummary(stageNum) : '';

    let body = '';
    if (stageNum === 1) body = renderProToolStage1();
    else if (stageNum === 2) body = renderProToolStage2();
    else if (stageNum === 3) body = renderProToolStage3();
    else if (stageNum === 4) body = renderProToolStage4();
    else body = `<div class="pro-tool-empty">该阶段暂未提供专业工具，请使用其他阶段。</div>`;

    container.innerHTML = `
        <div class="stage-header pro">
            <div class="stage-tag pro">${stage.tag} · PRO</div>
            <h2>${stage.title}<span class="stage-header-tag-pro">🔧 专业工具</span></h2>
            <p class="stage-intro">${stage.intro}</p>
        </div>
        ${lvChip}
        ${body}
        <div id="dynamicArea"></div>
        ${summaryHtml}
    `;

    // 初始化 PRO 工具交互
    setTimeout(() => {
        if (stageNum === 1) updatePro1Formula();
        if (stageNum === 3) {
            setupDragDrop();
            // 初次进入 stage3 工具时，自动加载示例数据并展示完整 6 个步骤
            loadProSampleData();
        }
    }, 50);
}

// ===== PRO · 阶段一（研究设计）工具 =====
function renderProToolStage1() {
    const rd = state.researchDesign;
    return `
        <div class="pro-tool-grid">
            <!-- 工具 1：研究问题模板生成器 -->
            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">🧩</span><div><div class="pro-tool-card-title">研究问题模板生成器</div><div class="pro-tool-card-sub">输入三要素，自动产出 3 条候选研究问题</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>主题对象（O）</label><input type="text" class="pt-input" id="pro1Obj" placeholder="例如：数字普惠金融 / 某上市公司 / 长江经济带" value="${rd.varX || ''}"></div>
                    <div class="pro-op-row"><label>目标变量（Y）</label><input type="text" class="pt-input" id="pro1Y" placeholder="例如：居民消费 / 企业全要素生产率 / 区域创新" value="${rd.varY || ''}"></div>
                    <div class="pro-op-row"><label>研究视角</label>
                        <select class="pt-select" id="pro1Lens">
                            <option value="causal">因果影响</option>
                            <option value="effect" selected>效应大小</option>
                            <option value="mech">作用机制</option>
                            <option value="heterogeneity">异质性</option>
                        </select>
                    </div>
                    <button class="btn-primary pro-tool-act" onclick="runPro1Generate()">▶ 生成 3 条研究问题</button>
                    <div id="pro1Out" class="pro-tool-out"></div>
                </div>
            </div>

            <!-- 工具 2：变量定义模板 -->
            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">📋</span><div><div class="pro-tool-card-title">变量定义模板（X / Y / 控制变量）</div><div class="pro-tool-card-sub">三种取数维度（水平值 / 增长率 / 对数值）+ 数据源提示</div></div></div>
                <div class="pro-tool-card-body">
                    <table class="pro-vartbl">
                        <thead><tr><th>角色</th><th>名称</th><th>衡量方式</th><th>数据源类别</th><th>建议频度</th></tr></thead>
                        <tbody>
                            <tr><td><span class="badge-y">Y</span></td><td><input type="text" class="pt-input" id="pro1VarY" placeholder="例如：居民消费水平" value="${rd.varY || ''}"></td>
                                <td><select class="pt-select" id="pro1MeasY"><option>水平值</option><option selected>对数值</option><option>增长率(%)</option><option>比率</option></select></td>
                                <td><select class="pt-select" id="pro1SrcY"><option value="macro">宏观（统计局/央行/海关）</option><option value="firm">企业（CSMAR/Wind）</option><option value="micro">微观（CFPS/CGSS）</option><option value="intl">国际（WDI/IMF）</option></select></td>
                                <td><select class="pt-select" id="pro1FreqY"><option>月度</option><option selected>季度</option><option>年度</option><option>面板</option></select></td>
                            </tr>
                            <tr><td><span class="badge-x">X</span></td><td><input type="text" class="pt-input" id="pro1VarX" placeholder="核心解释变量" value="${rd.varX || ''}"></td>
                                <td><select class="pt-select" id="pro1MeasX"><option>水平值</option><option>对数值</option><option selected>指数</option><option>虚拟(0/1)</option></select></td>
                                <td><select class="pt-select" id="pro1SrcX"><option value="macro">宏观</option><option value="firm" selected>企业</option><option value="micro">微观</option><option value="intl">国际</option></select></td>
                                <td><select class="pt-select" id="pro1FreqX"><option>月度</option><option selected>季度</option><option>年度</option><option>面板</option></select></td>
                            </tr>
                            <tr><td><span class="badge-c">C</span></td><td colspan="4"><input type="text" class="pt-input" id="pro1Controls" placeholder="控制变量（逗号分隔，例如：人均可支配收入、城镇化率、老龄化率）" value="${rd.controls || ''}"></td></tr>
                        </tbody>
                    </table>
                    <div class="pro-op-tip"><strong>💡 提示：</strong>Y 与 X 的频度必须一致，否则进入阶段三做频度对齐。控制变量含被遗漏变量（同时影响 Y 与 X）会引发内生性，必须先列出。</div>
                </div>
            </div>

            <!-- 工具 3：模型设定公式生成 -->
            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">📐</span><div><div class="pro-tool-card-title">模型设定公式生成器</div><div class="pro-tool-card-sub">一键产出 OLS / 固定效应 / DID / IV 回归方程</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>模型类型</label>
                        <select class="pt-select" id="pro1ModelType" onchange="updatePro1Formula()">
                            <option value="ols" selected>OLS 多元回归</option>
                            <option value="fe">固定效应 FE</option>
                            <option value="did">双重差分 DID</option>
                            <option value="iv">工具变量 IV / 2SLS</option>
                            <option value="gmm">系统 GMM</option>
                        </select>
                    </div>
                    <div class="pro-op-row"><label>是否含交互项</label><input type="checkbox" id="pro1Interact" onchange="updatePro1Formula()">  X × 调节变量</div>
                    <pre id="pro1Formula" class="formula-block"></pre>
                    <button class="btn-primary pro-tool-act" onclick="copyFormula()">📋 复制公式（LaTeX）</button>
                    <div class="pro-op-tip"><strong>使用步骤：</strong>① 把上面的变量名替换成你自己的 X/Y/控制变量；② 进入阶段二获取数据；③ 进入阶段三清洗后进入阶段四回归。完整 OLS 代码生成器在阶段四。</div>
                </div>
            </div>
        </div>
        <button class="btn-primary btn-large pro-finish-btn" onclick="completeProStage(1)">✓ 标记研究设计已完成，进入阶段二</button>
    `;
}

// ===== PRO · 阶段二（数据获取）工具 =====
function renderProToolStage2() {
    return `
        <div class="pro-tool-grid">
            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">📊</span><div><div class="pro-tool-card-title">AKShare 一键取数模板（Python）</div><div class="pro-tool-card-sub">国内宏观/股票/期货的免费开源替代 Wind</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>数据类型</label>
                        <select class="pt-select" id="pro2DataType">
                            <option value="macro">宏观数据</option>
                            <option value="stock">A股股票日线</option>
                            <option value="futures">期货数据</option>
                            <option value="fund">基金净值</option>
                            <option value="exchange">汇率/利率</option>
                        </select>
                    </div>
                    <button class="btn-primary pro-tool-act" onclick="generateAkShareCode()">▶ 生成取数代码</button>
                    <pre id="pro2Code" class="code-block">点击上方按钮生成取数代码模板...</pre>
                    <div class="pro-op-tip"><strong>使用前：</strong> <code>pip install akshare pandas</code>。详见 <a href="https://akshare.akfamily.xyz" target="_blank">akshare 官方文档</a>。</div>
                </div>
            </div>

            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">🔧</span><div><div class="pro-tool-card-title">Stata 取数命令生成器</div><div class="pro-tool-card-sub">处理 CSMAR/Wind 导出文件 / 国家统计局 Excel</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>数据来源</label>
                        <select class="pt-select" id="pro2StataSrc">
                            <option value="csmar">CSMAR CSV</option>
                            <option value="stats">国家统计局 Excel</option>
                            <option value="wind">Wind 导出 CSV</option>
                            <option value="tushare">Tushare API</option>
                        </select>
                    </div>
                    <button class="btn-primary pro-tool-act" onclick="generateStataCode()">▶ 生成 Stata 命令</button>
                    <pre id="pro2StataCode" class="code-block">点击上方按钮生成 Stata 命令...</pre>
                </div>
            </div>

            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">🌐</span><div><div class="pro-tool-card-title">国际数据（WB / IMF / OECD）API</div><div class="pro-tool-card-sub">跨国研究：批量下载 + Python 接口</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>数据源</label>
                        <select class="pt-select" id="pro2IntlSrc">
                            <option value="wdi">World Bank WDI</option>
                            <option value="imf">IMF IFS / WEO</option>
                            <option value="oecd">OECD</option>
                            <option value="comtrade">UN Comtrade</option>
                        </select>
                    </div>
                    <button class="btn-primary pro-tool-act" onclick="generateIntlCode()">▶ 生成 API 代码</button>
                    <pre id="pro2IntlCode" class="code-block">点击上方按钮生成 Python 代码...</pre>
                </div>
            </div>
        </div>
        <button class="btn-primary btn-large pro-finish-btn" onclick="completeProStage(2)">✓ 标记数据获取已完成，进入阶段三</button>
    `;
}

// ===== PRO · 阶段三（数据清洗）工具 =====
function renderProToolStage3() {
    return `
        <div class="pro-tool-cleanbench">
            <div class="pro-cb-step">
                <div class="pro-cb-num">1</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">上传 CSV 数据</div>
                    <div class="pro-cb-sub">支持任意逗号分隔 / 制表符分隔文件 · 首行表头 · 全在本机处理</div>
                    <div class="pt-upload-zone" id="ptUploadZone" onclick="document.getElementById('ptFileInput').click()">
                        <div class="pt-upload-icon">📂</div>
                        <div class="pt-upload-title">拖拽 CSV 到此 或 <span class="pt-upload-link">点击选择文件</span></div>
                        <div class="pt-upload-hint">或 <button class="btn-secondary pt-sample-btn" onclick="loadProSampleData(event)">试用内置示例数据</button></div>
                        <input type="file" id="ptFileInput" accept=".csv,.tsv,.txt" hidden>
                    </div>
                </div>
            </div>

            <div class="pro-cb-step" id="ptPreviewStep" hidden>
                <div class="pro-cb-num">2</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">数据预览（前 5 行 + 缺失统计）</div>
                    <div id="ptPreview" class="pt-preview-wrap"></div>
                    <div id="ptMeta" class="pt-meta-line"></div>
                </div>
            </div>

            <div class="pro-cb-step" id="ptFreqStep" hidden>
                <div class="pro-cb-num">3</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">频度对齐</div>
                    <div class="pro-cb-sub">月度 → 季度 / 季度 → 年度</div>
                    <div class="pt-op-row">
                        <label>目标频度</label>
                        <select class="pt-select" id="ptFreqTarget">
                            <option value="quarter">季度（取季内均值）</option>
                            <option value="year">年度（取年内均值）</option>
                            <option value="year-end">年度（取季末值 12月）</option>
                        </select>
                        <label style="margin-left:14px">参与对齐的列</label>
                        <select class="pt-select" id="ptFreqCols" multiple size="4"></select>
                        <button class="btn-primary" onclick="doFreqAlign()">▶ 执行频度对齐</button>
                    </div>
                    <div class="pt-op-tip"><strong>适用原则：</strong>高频→低频用降频（取均值/季末值），<strong>最稳妥</strong>；低频→高频需谨慎（插值会人为引入平滑假设，扭曲真实波动）。</div>
                </div>
            </div>

            <div class="pro-cb-step" id="ptMissingStep" hidden>
                <div class="pro-cb-num">4</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">缺失值处理</div>
                    <div class="pt-op-row">
                        <label>处理策略</label>
                        <select class="pt-select" id="ptMissingMethod">
                            <option value="linear">线性插值</option>
                            <option value="ffill">前向填充</option>
                            <option value="bfill">后向填充</option>
                            <option value="drop">删除缺失行</option>
                            <option value="mean">均值填充</option>
                        </select>
                        <label style="margin-left:14px">应用列</label>
                        <select class="pt-select" id="ptMissingCols" multiple size="4"></select>
                        <button class="btn-primary" onclick="doMissing()">▶ 执行缺失值处理</button>
                    </div>
                    <div id="ptMissingSummary" class="pt-missing-summary"></div>
                    <div class="pt-op-tip"><strong>关键：</strong>若缺失是<strong>非随机</strong>（如贫穷国家数据系统性缺失），删除或均值填充都会引入偏误。此时建议做<strong>多重插补</strong>并对比稳健性。</div>
                </div>
            </div>

            <div class="pro-cb-step" id="ptLogStep" hidden>
                <div class="pro-cb-num">5</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">对数化转换</div>
                    <div class="pt-op-row">
                        <label>取对数的列（仅正值变量）</label>
                        <select class="pt-select" id="ptLogCols" multiple size="4"></select>
                        <button class="btn-primary" onclick="doLogTransform()">▶ 生成 ln_xxx 列</button>
                    </div>
                    <div class="pt-op-tip"><strong>对数化三大好处：</strong>① 压缩尺度，缓解极端值；② 偏态 → 更接近正态；③ 系数可解释为弹性（X 变 1%，Y 变 β%）。仅适用于<strong>正值变量</strong>（GDP/收入/价格等）。</div>
                </div>
            </div>

            <div class="pro-cb-step" id="ptExportStep" hidden>
                <div class="pro-cb-num">6</div>
                <div class="pro-cb-body">
                    <div class="pro-cb-title">操作历史 + 一键导出</div>
                    <div id="ptHistory" class="pt-history"></div>
                    <div class="pt-export-actions">
                        <button class="btn-primary" onclick="exportCleanedCSV()">💾 下载清洗后的 CSV</button>
                        <button class="btn-secondary" onclick="loadProSampleData()">🔄 重新开始</button>
                    </div>
                </div>
            </div>
        </div>
        <button class="btn-primary btn-large pro-finish-btn" onclick="completeProStage(3)" id="proStage3Finish" hidden>✓ 标记数据清洗已完成，进入阶段四</button>
    `;
}

// ===== PRO · 阶段四（实证推演）工具 =====
function renderProToolStage4() {
    return `
        <div class="pro-tool-grid">
            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">📐</span><div><div class="pro-tool-card-title">OLS 回归代码生成器</div><div class="pro-tool-card-sub">Stata / R / Python 三选一</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-op-row"><label>被解释变量 Y</label><input type="text" class="pt-input" id="pro4Y" placeholder="例如：ln_consume"></div>
                    <div class="pro-op-row"><label>核心解释变量 X</label><input type="text" class="pt-input" id="pro4X" placeholder="例如：digital_finance_index"></div>
                    <div class="pro-op-row"><label>控制变量</label><input type="text" class="pt-input" id="pro4C" placeholder="用空格分隔，例如：ln_income urbanization aging"></div>
                    <div class="pro-op-row"><label>是否双向固定效应</label><input type="checkbox" id="pro4FE" checked> 个体 + 时间 FE</div>
                    <div class="pro-op-row"><label>聚类层级</label>
                        <select class="pt-select" id="pro4Cluster"><option value="none">不聚类</option><option value="id">个体</option><option value="time" selected>时间</option><option value="id_time">个体×时间双向</option></select>
                    </div>
                    <div class="pro-op-row"><label>语言</label>
                        <select class="pt-select" id="pro4Lang" onchange="renderPro4Code()">
                            <option value="stata" selected>Stata</option>
                            <option value="r">R (fixest)</option>
                            <option value="python">Python (linearmodels)</option>
                        </select>
                    </div>
                    <pre id="pro4Code" class="code-block">点击下方按钮生成回归代码...</pre>
                    <button class="btn-primary pro-tool-act" onclick="renderPro4Code()">▶ 生成回归代码</button>
                </div>
            </div>

            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">✅</span><div><div class="pro-tool-card-title">回归后必跑 5 项检验清单</div><div class="pro-tool-card-sub">对应 Stata 命令一键复制</div></div></div>
                <div class="pro-tool-card-body">
                    <table class="pro-checklist">
                        <thead><tr><th>检验项</th><th>适用范围</th><th>Stata 命令</th></tr></thead>
                        <tbody>
                            <tr><td>① 多重共线性</td><td>任何回归</td><td><code>estat vif</code></td></tr>
                            <tr><td>② 异方差 White 检验</td><td>OLS</td><td><code>estat imtest, white</code></td></tr>
                            <tr><td>③ 自相关 Wooldridge</td><td>面板数据</td><td><code>xtserial y x</code></td></tr>
                            <tr><td>④ 内生性 Hausman</td><td>FE vs RE</td><td><code>hausman fe re</code></td></tr>
                            <tr><td>⑤ 稳健性（替换变量/样本/方法）</td><td>必做</td><td>见下方模板</td></tr>
                        </tbody>
                    </table>
                    <pre class="code-block">* 完整稳健性检验模板（替换变量）
reg ln_y ln_x ln_income urbanization aging i.year i.id, cluster(id)
eststo m1

* 替换样本（剔除直辖市）
reg ln_y ln_x ln_income urbanization aging if bjsj!=1, cluster(id)
eststo m2

* 替换核心变量
replace ln_x = ln_x_alt
reg ln_y ln_x ln_income urbanization aging, cluster(id)
eststo m3

esttab m1 m2 m3 using "results.rtf", se star(* 0.1 ** 0.05 *** 0.01) ar2(%9.3f)</pre>
                </div>
            </div>

            <div class="pro-tool-card">
                <div class="pro-tool-card-head"><span class="pro-tool-icon">🎯</span><div><div class="pro-tool-card-title">内生性处理工具（DID / IV / PSM）</div><div class="pro-tool-card-sub">核心 X 可能内生时使用</div></div></div>
                <div class="pro-tool-card-body">
                    <div class="pro-endog-tabs">
                        <button class="pro-endog-tab active" data-et="did">DID</button>
                        <button class="pro-endog-tab" data-et="iv">IV / 2SLS</button>
                        <button class="pro-endog-tab" data-et="psm">PSM</button>
                        <button class="pro-endog-tab" data-et="rdd">RDD</button>
                    </div>
                    <pre id="proEndogOut" class="code-block"></pre>
                    <button class="btn-primary pro-tool-act" onclick="renderPro4Endog()">▶ 显示当前方法代码</button>
                </div>
            </div>
        </div>
        <button class="btn-primary btn-large pro-finish-btn" onclick="completeProStage(4)">✓ 标记实证已完成，进入 AI 论文设计</button>
    `;
}

// ===== PRO 工具：完成某个研究阶段 =====
function completeProStage(stageNum) {
    const prog = state.progress[stageNum];
    prog.completed = true;
    prog.completeTime = Date.now();
    prog.qIdx = Math.max(prog.qIdx || 0, 1);
    saveState();
    updateStepper();
    if ($('dynamicArea')) $('dynamicArea').innerHTML = getStageSummary(stageNum);
    showToast(`阶段${stageNum}（PRO 模式）已完成`, 'success');
}
function completeDataGuide(stageNum) {
    const prog = state.progress[stageNum];
    prog.completed = true;
    prog.completeTime = Date.now();
    // 兼容旧进度结构：将 qIdx 置满，避免"进行中"状态残留
    prog.qIdx = Math.max(prog.qIdx, 1);
    saveState();

    updateStepper();

    // 显示阶段总结（数据预览）
    const area = $('dynamicArea');
    if (area) area.innerHTML = getStageSummary(stageNum);

    showToast(`阶段${stageNum}已完成！`, 'success');
}

async function restoreDialogue(stageNum) {
    const prog = state.progress[stageNum];
    const stage = stages[stageNum];
    const area = $('dialogueArea');
    
    // 恢复历史问答
    for (let i = 0; i < prog.qIdx; i++) {
        const q = stage.questions[i];
        // 导师问题
        await addMsg('tutor', q.text, false);
        // 学生回答
        if (prog.answers[i]) {
            await addMsg('user', prog.answers[i].replace(/\n/g, '<br>'), false);
        }
        // 导师反馈
        const feedback = getFeedback(stageNum, i);
        await addMsg('tutor', feedback, false);
    }
}

// ====== 对话系统 ======
async function addMsg(role, html, withTyping = true) {
    const area = $('dialogueArea');
    if (!area) return;
    
    const msg = document.createElement('div');
    msg.className = `message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'tutor' ? '导' : '我';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    msg.appendChild(avatar);
    msg.appendChild(bubble);
    area.appendChild(msg);
    
    if (withTyping && role === 'tutor') {
        bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
        await sleep(800);
        bubble.innerHTML = html;
    } else {
        bubble.innerHTML = html;
    }
    
    area.scrollTop = area.scrollHeight;
    await sleep(200);
}

// ====== 提问 ======
async function askQuestion(stageNum) {
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];
    const q = stage.questions[prog.qIdx];
    
    if (!q) return;
    
    // 阶段4子步骤更新
    if (stageNum === 4 && q.subStep) {
        updateSubStep(q.subStep);
    }
    
    await addMsg('tutor', q.text);

    // 初学者模式：提问后自动附概念讲解卡，避免因概念不清而卡住
    if (currentLevel() === 'beginner' && (q.followUps || q.hint || q.concepts)) {
        await addMsg('tutor', getConceptCardHtml(q), false);
    }

    // 显示输入面板
    renderInputPanel(stageNum);
}

function updateSubStep(sub) {
    document.querySelectorAll('.sub-step').forEach(el => {
        el.classList.toggle('active', el.dataset.substep == sub);
    });
}

function renderInputPanel(stageNum) {
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];
    const q = stage.questions[prog.qIdx];
    const lv = currentLevel();
    const L = lv ? LEVELS[lv] : null;
    const fails = (prog.attempts && prog.attempts[prog.qIdx]) || 0;

    // 按水平与失败次数决定是否自动展开提示 / 参考示例
    const showHint = L && q && q.hint && fails >= L.hintAfter;
    const exampleKey = q ? `${stageNum}-${prog.qIdx}` : null;
    const showExample = L && exampleKey && EXAMPLE_ANSWERS[exampleKey] && fails >= L.exampleAfter;

    const helpHtml = showHint || showExample ? `
        <div class="scaffold-box">
            ${showHint ? `<div class="scaffold-hint"><strong>💡 提示：</strong>${q.hint}</div>` : ''}
            ${showExample ? `
                <details class="scaffold-example">
                    <summary>👀 查看参考示例回答（请结合自己的研究改写后再提交）</summary>
                    <div class="scaffold-example-body">${EXAMPLE_ANSWERS[exampleKey]}</div>
                </details>
            ` : ''}
        </div>
    ` : '';

    const area = $('dynamicArea');
    area.innerHTML = `
        <div class="input-panel" id="inputPanel">
            <div class="input-panel-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5H17M3 10H17M3 15H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <span>请回答导师的提问</span>
            </div>
            ${helpHtml}
            <textarea id="answerInput" class="text-input" rows="4" placeholder="在此输入你的思考..."></textarea>
            <div class="input-actions">
                <button class="btn-secondary" onclick="openHelp(${stageNum})">需要帮助</button>
                <button class="btn-primary" onclick="submitAnswer(${stageNum})">提交回答</button>
            </div>
        </div>
    `;
    $('answerInput').focus();
}

// ====== 提交回答 ======
async function submitAnswer(stageNum) {
    const input = $('answerInput');
    const ans = input.value.trim();
    
    if (!ans) { showToast('请输入你的回答', 'error'); return; }
    
    const stage = stages[stageNum];
    const prog = state.progress[stageNum];
    const q = stage.questions[prog.qIdx];
    
    if (q.validate && !q.validate(ans)) {
        // 记录失败次数，用于按水平自动升级帮助（提示 → 参考示例）
        prog.attempts = prog.attempts || [];
        prog.attempts[prog.qIdx] = (prog.attempts[prog.qIdx] || 0) + 1;
        const fails = prog.attempts[prog.qIdx];
        saveState();

        // 保留草稿并刷新输入面板（可能自动展开提示/示例）
        const preserved = input.value;
        renderInputPanel(stageNum);
        const newInput = $('answerInput');
        if (newInput) newInput.value = preserved;

        let extra = '';
        const lv = currentLevel();
        if (lv) {
            const L = LEVELS[lv];
            if (fails === L.hintAfter) extra = '，已为你自动展开提示';
            else if (fails === L.exampleAfter && EXAMPLE_ANSWERS[`${stageNum}-${prog.qIdx}`]) extra = '，可查看参考示例';
        }
        showToast((q.error || '回答不够完整，请重新思考') + extra, 'error');
        return;
    }
    
    // 记录回答
    prog.answers[prog.qIdx] = ans;
    
    // 清除输入面板
    $('dynamicArea').innerHTML = '';
    
    // 显示用户回答
    await addMsg('user', ans.replace(/\n/g, '<br>'));
    
    // 导师反馈
    await sleep(400);
    const feedback = getFeedback(stageNum, prog.qIdx);
    await addMsg('tutor', feedback);
    
    // 记录研究设计信息
    if (q.recordKey) {
        if (stageNum === 1) state.researchDesign[q.recordKey] = ans;
    }
    
    prog.qIdx++;
    saveState();
    
    // 判断是否完成
    if (prog.qIdx >= stage.questions.length) {
        await sleep(500);
        completeStage(stageNum);
    } else {
        await sleep(400);
        await askQuestion(stageNum);
    }
}

function getFeedback(stage, qIdx) {
    const feedbacks = {
        1: [
            '这是一个值得探索的研究方向。明确了问题，我们就有了方向。接下来需要把模糊的概念变成可度量的变量。',
            '被解释变量已锁定。接下来我们需要找到那个你认为「推动 Y 变化」的关键因素——也就是核心解释变量 X。',
            '核心解释变量已确认。但仅有 X 和 Y 是不够的——如果忽略了其他影响因素，你的估计可能会出现偏误。',
            '控制变量的思考很到位。遗漏变量偏误（OVB）是实证研究中最常见也最危险的陷阱之一。至此，你的研究设计已完整：问题清晰、变量明确、控制策略合理。'
        ],
        2: [
            '频度选择合理。记住，频度决定了你的样本量和估计精度，也影响你对短期和长期效应的区分能力。',
            '数据源确认。权威来源是实证研究可信度的基石。现在系统将为你检索并预览相关数据。'
        ],
        3: [
            '频度对齐策略正确。记住，降频（高频→低频）通常比升频更可靠，因为升频会引入插值假设。',
            '缺失值处理思路清晰。关键是判断缺失机制——随机缺失可以删除，非随机缺失必须谨慎处理以防偏误。',
            '对数化的选择合理。记住三大好处：压缩尺度、近似正态、可解释为弹性。数据清洗至此完成，可以进入实证推演阶段。'
        ],
        4: [
            '正确！平稳性检验是时间序列回归的第一道防线。伪回归的教训——Granger 和 Newbold (1974) 的经典论文已经警示了忽视单位根的危险。',
            'VIF 的认识到位。VIF > 10 意味着该变量与其他解释变量高度相关，系数估计不稳定。可以通过剔除变量、主成分分析或岭回归来解决。',
            '方程式书写规范。β₁ 是你的核心关注系数，μᵢ 捕捉个体异质性，εᵢₜ 是随机扰动项。这是一个标准的面板数据固定效应模型。',
            '计算正确！t = 3.75，这个值远大于临界值。接下来需要判断它的统计含义和经济含义。',
            '判定准确。β₁ 在 1% 水平下显著为正，统计意义明确。但在下结论前，务必同时关注经济显著性——即效应大小是否有实际意义，而不仅仅是统计显著。'
        ]
    };
    return feedbacks[stage][qIdx] || '回答已收到，让我们继续。';
}

// ====== 对话式帮助系统 ======
function openHelp(stageNum) {
    const prog = state.progress[stageNum];
    const stage = stages[stageNum];
    const q = stage.questions[prog.qIdx];
    const userInput = $('answerInput')?.value.trim() || '';
    
    prog.hintsUsed++;
    saveState();
    
    // 分析学生输入
    let analysisHtml = '';
    if (userInput && q.concepts) {
        const found = q.concepts.filter(c => c.pattern.test(userInput));
        const missing = q.concepts.filter(c => !c.pattern.test(userInput));
        
        if (found.length > 0) {
            analysisHtml += `<div style="margin-bottom:10px"><span class="analysis-tag found">已涵盖</span>${found.map(c => c.found).join('；')}</div>`;
        }
        if (missing.length > 0) {
            analysisHtml += `<div><span class="analysis-tag missing">待补充</span>${missing.map(c => c.missing).join('；')}</div>`;
        }
    } else if (q.concepts) {
        analysisHtml = `<div><span class="analysis-tag missing">尚未作答</span>请尝试回答后，系统将分析你的思路并给出针对性建议。</div>`;
    }
    
    // 生成建议追问快捷标签
    let suggestionsHtml = '';
    if (q.followUps) {
        const topics = Object.keys(q.followUps).map(p => {
            const m = p.match(/[\u4e00-\u9fa5A-Za-z]+/);
            return m ? m[0] : p;
        });
        suggestionsHtml = topics.slice(0, 4).map(t => 
            `<div class="help-suggestion-chip" onclick="askFollowUp(${stageNum}, '${t}')">${t}</div>`
        ).join('');
    }
    
    // 替换输入面板为帮助面板 + 输入面板
    const area = $('dynamicArea');
    area.innerHTML = `
        <div class="help-panel" id="helpPanel">
            <div class="help-panel-header">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V9M8 11V11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                导师指导
            </div>
            ${analysisHtml ? `<div class="help-analysis">${analysisHtml}</div>` : ''}
            <div class="help-general">
                <strong>通用指导：</strong>${q.hint}
            </div>
            ${suggestionsHtml ? `<div class="help-suggestions">${suggestionsHtml}</div>` : ''}
            <div class="help-followup">
                <input type="text" class="help-followup-input" id="followupInput" placeholder="输入你的追问..." onkeydown="if(event.key==='Enter')askFollowUp(${stageNum})">
                <button class="help-followup-btn" onclick="askFollowUp(${stageNum})">追问</button>
            </div>
            <div class="help-history" id="helpHistory"></div>
            <div style="margin-top:14px;display:flex;gap:8px">
                <button class="btn-secondary" style="padding:8px 16px;font-size:13px" onclick="renderInputPanel(${stageNum})">返回作答</button>
            </div>
        </div>
        <div class="input-panel" id="inputPanel" hidden>
            <div class="input-panel-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5H17M3 10H17M3 15H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <span>请回答导师的提问</span>
            </div>
            <textarea id="answerInput" class="text-input" rows="4" placeholder="在此输入你的思考...">${userInput}</textarea>
            <div class="input-actions">
                <button class="btn-secondary" onclick="openHelp(${stageNum})">需要帮助</button>
                <button class="btn-primary" onclick="submitAnswer(${stageNum})">提交回答</button>
            </div>
        </div>
    `;
}

function askFollowUp(stageNum, preset, qIdxOverride) {
    const input = $('followupInput');
    const question = preset || input?.value.trim();
    if (!question) return;

    const prog = state.progress[stageNum];
    const stage = stages[stageNum];
    const q = stage.questions[qIdxOverride !== undefined ? qIdxOverride : prog.qIdx];

    // 记录追问
    prog.helpExchanges.push({ question, time: Date.now() });
    saveState();

    // 显示问题
    const history = $('helpHistory');
    if (history) {
        const qItem = document.createElement('div');
        qItem.className = 'help-history-item question';
        qItem.innerHTML = `<strong>追问：</strong>${question}`;
        history.appendChild(qItem);
    }

    // 匹配回答：优先当前题，其次阶段级知识库，若阶段已完成则合并全部问题的知识库匹配
    let followUps = q?.followUps || stage.followUps || {};
    let answer = null;
    for (const [pattern, response] of Object.entries(followUps)) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(question)) { answer = response; break; }
    }
    if (answer === null) {
        // 完成后的自由探讨：遍历本阶段所有问题匹配
        for (const qq of stage.questions) {
            if (!qq.followUps) continue;
            for (const [pattern, response] of Object.entries(qq.followUps)) {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(question)) { answer = response; break; }
            }
            if (answer !== null) break;
        }
    }
    if (answer === null && stage.followUps) {
        for (const [pattern, response] of Object.entries(stage.followUps)) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(question)) { answer = response; break; }
        }
    }
    if (answer === null) {
        answer = '这个问题值得思考。建议你结合本阶段的核心概念，从「是什么—为什么—怎么做」三个层面梳理；也可以先给出自己的判断，我们再逐一讨论。';
    }

    // 显示回答
    if (history) {
        setTimeout(() => {
            const aItem = document.createElement('div');
            aItem.className = 'help-history-item answer';
            aItem.innerHTML = `<strong>导师：</strong>${answer}`;
            history.appendChild(aItem);
            history.scrollTop = history.scrollHeight;
        }, 500);
    }

    // 清空输入
    if (input) input.value = '';
}

// ====== 阶段完成 ======
async function completeStage(stageNum) {
    const prog = state.progress[stageNum];
    prog.completed = true;
    prog.completeTime = Date.now();
    saveState();

    updateStepper();

    const container = $('stageContainer');
    const summaryHtml = getStageSummary(stageNum);

    // 在动态区域显示完成内容
    const area = $('dynamicArea');
    area.innerHTML = summaryHtml;

    showToast(`阶段${stageNum}已完成！`, 'success');
}

// 完成后返回阶段总结
function showStageSummary(stageNum) {
    const area = $('dynamicArea');
    area.innerHTML = getStageSummary(stageNum);
}

// 完成后继续深入探讨：自由追问本阶段任何概念
function continueExplore(stageNum) {
    const stage = stages[stageNum];

    // 收集本阶段全部可追问话题（题目级 + 阶段级知识库）
    const topics = [];
    stage.questions.forEach(q => {
        if (q.followUps) Object.keys(q.followUps).forEach(p => {
            const m = p.match(/[\u4e00-\u9fa5A-Za-z]+/);
            if (m) topics.push(m[0]);
        });
    });
    if (stage.followUps) {
        Object.keys(stage.followUps).forEach(p => {
            const m = p.match(/[\u4e00-\u9fa5A-Za-z]+/);
            if (m) topics.push(m[0]);
        });
    }
    const uniqueTopics = [...new Set(topics)].slice(0, 8);

    const area = $('dynamicArea');
    area.innerHTML = `
        <div class="help-panel" id="helpPanel">
            <div class="help-panel-header">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V9M8 11V11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                继续深入探讨
            </div>
            <div class="help-general">
                <strong>本阶段已完成。</strong>进入下一阶段前，你可以继续就本阶段的任何概念提出疑问——导师会逐一回应。学习不必被固定的题数限制。
            </div>
            ${uniqueTopics.length ? `<div class="help-suggestions">${uniqueTopics.map(t =>
                `<div class="help-suggestion-chip" onclick="askFollowUp(${stageNum}, '${t}')">${t}</div>`
            ).join('')}</div>` : ''}
            <div class="help-followup">
                <input type="text" class="help-followup-input" id="followupInput" placeholder="输入你想深入探讨的问题..." onkeydown="if(event.key==='Enter')askFollowUp(${stageNum})">
                <button class="help-followup-btn" onclick="askFollowUp(${stageNum})">提问</button>
            </div>
            <div class="help-history" id="helpHistory"></div>
            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn-secondary" style="padding:8px 16px;font-size:13px" onclick="showStageSummary(${stageNum})">返回阶段总结</button>
            </div>
        </div>
    `;
    $('followupInput')?.focus();
}

function getStageSummary(stageNum) {
    if (stageNum === 1) {
        return `
            <div class="summary-panel">
                <div class="summary-header">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10L7 14L17 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span>研究设计已确认</span>
                </div>
                <div class="summary-grid">
                    <div class="summary-item"><div class="summary-label">被解释变量 (Y)</div><div class="summary-value">${state.researchDesign.varY || '—'}</div></div>
                    <div class="summary-item"><div class="summary-label">核心解释变量 (X)</div><div class="summary-value">${state.researchDesign.varX || '—'}</div></div>
                    <div class="summary-item"><div class="summary-label">研究问题</div><div class="summary-value">${state.researchDesign.question || '—'}</div></div>
                    <div class="summary-item"><div class="summary-label">控制变量</div><div class="summary-value">${state.researchDesign.controls || '—'}</div></div>
                </div>
                <button class="btn-primary btn-next" onclick="navigate('stage2')">进入阶段二：数据获取<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M14 9L10 5M14 9L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="continueExplore(1)">继续深入探讨</button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="navigate('home')">返回首页</button>
            </div>
        `;
    } else if (stageNum === 2) {
        let tableHtml = '<thead><tr>';
        mockData.headers.forEach(h => tableHtml += `<th>${h}</th>`);
        tableHtml += '</tr></thead><tbody>';
        mockData.rows.forEach(row => { tableHtml += '<tr>'; row.forEach(c => tableHtml += `<td>${c}</td>`); tableHtml += '</tr>'; });
        tableHtml += '</tbody>';
        
        return `
            <div class="data-preview">
                <div class="data-preview-header">
                    <div class="data-preview-title"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 8H17M8 3V17" stroke="currentColor" stroke-width="1.5"/></svg><span>数据预览（前5行）</span></div>
                    <div class="data-source">${mockData.source}</div>
                </div>
                <div class="table-wrapper"><table class="data-table">${tableHtml}</table></div>
                <p class="data-note">注意：上表为系统提供的示例数据（前5行）。请按照本阶段给出的取数路径，亲手下载你自己变量的真实数据。此处请勿直接解读数据规律或得出分析结论——那将留到阶段四完成。</p>
                <button class="btn-primary btn-next" onclick="navigate('stage3')">进入阶段三：数据清洗<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M14 9L10 5M14 9L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="continueExplore(2)">继续深入探讨</button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="navigate('home')">返回首页</button>
            </div>
        `;
    } else if (stageNum === 3) {
        let dictRows = '';
        mockDict.forEach(row => { dictRows += '<tr>'; row.forEach(c => dictRows += `<td>${c}</td>`); dictRows += '</tr>'; });
        
        return `
            <div class="data-dict">
                <div class="data-dict-header"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 3H14L16 5V17H4V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 8H13M7 12H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>标准化数据字典</span></div>
                <div class="table-wrapper"><table class="data-table"><thead><tr><th>变量名</th><th>含义</th><th>频度</th><th>处理方式</th><th>数据来源</th></tr></thead><tbody>${dictRows}</tbody></table></div>
                <button class="btn-primary btn-next" onclick="navigate('stage4')">进入阶段四：实证推演<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M14 9L10 5M14 9L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="continueExplore(3)">继续深入探讨</button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="navigate('home')">返回首页</button>
            </div>
        `;
    } else if (stageNum === 4) {
        let tableHtml = '<thead><tr>';
        mockResult.headers.forEach(h => tableHtml += `<th>${h}</th>`);
        tableHtml += '</tr></thead><tbody>';
        mockResult.rows.forEach(row => { tableHtml += '<tr>'; row.forEach((c, i) => { tableHtml += i === 5 && c ? `<td><strong style="color:var(--success)">${c}</strong></td>` : `<td>${c}</td>`; }); tableHtml += '</tr>'; });
        tableHtml += '</tbody>';
        
        return `
            <div class="result-panel">
                <div class="result-header"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 12L9 18L21 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>实证分析完成 — 回归结果表</span></div>
                <div class="table-wrapper"><table class="data-table result-table">${tableHtml}</table></div>
                <div class="result-conclusion"><h4>结论解读</h4><p>${mockResult.conclusion}</p><p style="margin-top:10px;color:var(--text-light);font-size:13px;">注：*** 表示 1% 显著，** 表示 5% 显著，* 表示 10% 显著。</p></div>
                <button class="btn-primary btn-next" onclick="navigate('report')">查看学情报告<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M14 9L10 5M14 9L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="continueExplore(4)">继续深入探讨</button>
                <button class="btn-secondary btn-next" style="margin-left:10px" onclick="navigate('home')">返回首页</button>
            </div>
        `;
    }
    return '';
}

// ====== 学情报告页 ======
function renderReport() {
    // 填充学生信息
    $('formName').value = state.student.name || '';
    $('formStudentId').value = state.student.id || '';
    $('formCourse').value = state.student.course || '计量经济学';
    $('formTeacher').value = state.student.teacher || '';
    $('formReflection').value = state.student.reflection || '';
    
    // 渲染统计表
    const tbody = $('statsBody');
    let html = '';
    for (let i = 1; i <= 4; i++) {
        const p = state.progress[i];
        html += `<tr>
            <td><strong>阶段${i}</strong> ${stages[i].title}</td>
            <td>${p.completed ? '<span style="color:var(--success);font-weight:600">已完成</span>' : (p.qIdx > 0 ? '进行中' : '未开始')}</td>
            <td>${stages[i].questions.length ? `${p.answers.length}/${stages[i].questions.length}` : '—（资源导航）'}</td>
            <td>${p.hintsUsed}</td>
            <td>${p.helpExchanges.length}</td>
            <td>${fmtTime(p.startTime)}</td>
            <td>${fmtTime(p.completeTime)}</td>
        </tr>`;
    }
    tbody.innerHTML = html;
    
    // 汇总
    const totalAnswers = Object.values(state.progress).reduce((s, p) => s + p.answers.length, 0);
    const totalHints = Object.values(state.progress).reduce((s, p) => s + p.hintsUsed, 0);
    const totalFollowUps = Object.values(state.progress).reduce((s, p) => s + p.helpExchanges.length, 0);
    const completedCount = Object.values(state.progress).filter(p => p.completed).length;
    
    const lv = currentLevel();
    $('statsSummary').innerHTML = `
        <strong>学习总览：</strong>共完成 ${completedCount}/4 个阶段，回答 ${totalAnswers} 个问题，使用 ${totalHints} 次帮助，进行了 ${totalFollowUps} 次追问。
        引导水平：${lv ? `${LEVELS[lv].icon} ${LEVELS[lv].label}` : '未选择'}${state.levelHistory.length > 1 ? `（累计调整 ${state.levelHistory.length - 1} 次）` : ''}。
        ${state.globalStart ? `首次学习时间：${fmtTime(state.globalStart)}` : ''}
    `;
}

function saveStudentInfo() {
    state.student.name = $('formName').value.trim();
    state.student.id = $('formStudentId').value.trim();
    state.student.course = $('formCourse').value.trim();
    state.student.teacher = $('formTeacher').value.trim();
    state.student.reflection = $('formReflection').value.trim();
    saveState();
}

// ====== CSV 导出 ======
function exportCSV() {
    saveStudentInfo();
    
    const student = state.student;
    const lvLabel = currentLevel() ? `${LEVELS[currentLevel()].label}` : '未选择';
    const headers = ['姓名', '学号', '课程', '指导教师', '学习水平', '阶段', '阶段名称', '完成状态', '回答问题数', '问题总数', '使用帮助次数', '追问次数', '首次访问', '完成时间', '学习反思'];

    const rows = [];
    for (let i = 1; i <= 4; i++) {
        const p = state.progress[i];
        rows.push([
            student.name || '—',
            student.id || '—',
            student.course || '—',
            student.teacher || '—',
            lvLabel,
            `阶段${i}`,
            stages[i].title,
            p.completed ? '已完成' : (p.qIdx > 0 ? '进行中' : '未开始'),
            p.answers.length,
            stages[i].questions.length || '—',
            p.hintsUsed,
            p.helpExchanges.length,
            fmtTime(p.startTime),
            fmtTime(p.completeTime),
            i === 4 ? (student.reflection || '—') : ''
        ]);
    }
    
    let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    
    downloadCSV(csv, `学情报告_${student.name || 'student'}_${new Date().toLocaleDateString().replace(/\//g,'-')}.csv`);
}

function exportAnswers() {
    saveStudentInfo();
    
    const student = state.student;
    const headers = ['姓名', '学号', '阶段', '题号', '问题', '学生回答', '是否通过'];
    
    const rows = [];
    for (let i = 1; i <= 4; i++) {
        const stage = stages[i];
        const p = state.progress[i];
        stage.questions.forEach((q, qi) => {
            const ans = p.answers[qi] || '';
            const passed = ans ? (q.validate ? (q.validate(ans) ? '通过' : '未通过') : '—') : '未作答';
            // 清理 HTML 标签
            const cleanQ = q.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').substring(0, 100);
            rows.push([
                student.name || '—',
                student.id || '—',
                `阶段${i}`,
                `Q${qi + 1}`,
                cleanQ,
                ans || '—',
                passed
            ]);
        });
    }
    
    let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    
    downloadCSV(csv, `答题详情_${student.name || 'student'}_${new Date().toLocaleDateString().replace(/\//g,'-')}.csv`);
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
}

// ====== 教师管理台 ======
const teacherData = {
    students: [],   // [{ name, id, course, teacher, stages: {1:{status,answered,total,hints,exchanges,start,complete}, ...}, reflection }]
    answers: []     // [{ name, id, stage, qNum, question, answer, passed }]
};

// ====== 后端 API 配置 ======
const API_BASE = ''; // 同源时为空，跨域时改为后端地址
let backendOnline = false;
let liveReports = [];
let liveRefreshTimer = null;

async function checkBackend() {
    try {
        const resp = await fetch(`${API_BASE}/api/health`, { timeout: 5000 });
        if (resp.ok) { const data = await resp.json(); return data.ok === true; }
        return false;
    } catch { return false; }
}

async function submitToBackend() {
    saveStudentInfo();
    const student = state.student;
    if (!student.name || !student.id) {
        const sb = $('submitStatus');
        sb.className = 'submit-status error';
        sb.textContent = '请先填写姓名和学号';
        return;
    }

    // 组装提交数据
    const payload = {
        name: student.name,
        studentId: student.id,
        course: student.course || '',
        teacher: student.teacher || '',
        reflection: student.reflection || '',
        level: currentLevel() || '',
        levelLabel: currentLevel() ? LEVELS[currentLevel()].label : '未选择',
        levelHistory: state.levelHistory || [],
        stages: {},
        answers: []
    };
    for (let i = 1; i <= 4; i++) {
        const p = state.progress[i];
        payload.stages[i] = {
            status: p.completed ? '已完成' : (p.qIdx > 0 ? '进行中' : '未开始'),
            answered: p.answers.length,
            total: stages[i].questions.length,
            hints: p.hintsUsed,
            exchanges: p.helpExchanges.length,
            start: p.startTime ? new Date(p.startTime).toLocaleString() : '',
            complete: p.completeTime ? new Date(p.completeTime).toLocaleString() : ''
        };
    }
    for (let i = 1; i <= 4; i++) {
        const stage = stages[i];
        const p = state.progress[i];
        stage.questions.forEach((q, qi) => {
            const ans = p.answers[qi] || '';
            const passed = ans ? (q.validate ? (q.validate(ans) ? '通过' : '未通过') : '—') : '未作答';
            payload.answers.push({
                stage: `阶段${i}`,
                qNum: `Q${qi + 1}`,
                question: q.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').substring(0, 200),
                answer: ans,
                passed
            });
        });
    }

    const sb = $('submitStatus');
    const btn = $('btnSubmitBackend');
    btn.disabled = true;
    sb.className = 'submit-status info';
    sb.textContent = '正在提交...';

    try {
        const resp = await fetch(`${API_BASE}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (result.success) {
            sb.className = 'submit-status success';
            sb.textContent = `提交成功！教师后台已收到你的学情数据（当前共 ${result.count} 份）`;
            const hint = $('submitHint');
            hint.hidden = false;
            hint.textContent = `提交时间：${new Date().toLocaleString()}。后续如需更新，再次提交即可覆盖。`;
        } else {
            throw new Error(result.error || '提交失败');
        }
    } catch (e) {
        sb.className = 'submit-status error';
        sb.textContent = `提交失败：${e.message}。你可先下载 CSV 文件，稍后由教师手动导入。`;
    } finally {
        btn.disabled = false;
    }
}

// ====== 教师登录门 ======
function showTeacherLogin() {
    const container = document.querySelector('#pageTeacher .teacher-container');
    if (!container) return;
    container.innerHTML = `
        <div class="teacher-login-card">
            <div class="login-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="10" y="20" width="28" height="20" rx="4" stroke="currentColor" stroke-width="2.5"/>
                    <path d="M16 20V14C16 10.69 19.69 8 24 8C28.31 8 32 10.69 32 14V20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                    <circle cx="24" cy="30" r="3" fill="currentColor"/>
                </svg>
            </div>
            <h2 class="login-title">教师管理台</h2>
            <p class="login-subtitle">请输入教师访问密码以进入学情仪表盘</p>
            <div class="login-form">
                <input type="password" class="login-input" id="teacherPwdInput" placeholder="输入教师密码..." onkeydown="if(event.key==='Enter')tryTeacherLogin()">
                <button class="btn-primary btn-large" onclick="tryTeacherLogin()">进入</button>
            </div>
            <div class="login-hint" id="loginHint"></div>
            <button class="btn-back login-back" onclick="navigate('home')">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8L10 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                返回首页
            </button>
        </div>
    `;
    setTimeout(() => $('teacherPwdInput')?.focus(), 100);
}

function tryTeacherLogin() {
    const input = $('teacherPwdInput');
    const hint = $('loginHint');
    if (!input) return;
    const pwd = input.value.trim();
    if (pwd === TEACHER_TOKEN) {
        sessionStorage.setItem('teacherAuthed', '1');
        // 重新渲染教师容器为原始结构后加载
        location.reload();
    } else {
        hint.textContent = '密码错误，请重试';
        hint.className = 'login-hint error';
        input.value = '';
        input.focus();
    }
}

function teacherLogout() {
    sessionStorage.removeItem('teacherAuthed');
    sessionStorage.setItem('teacherGuardPushed', '0');
    navigate('home');
    showToast('已退出教师登录', 'info');
}

async function renderTeacher() {
    // 已登录进入面板：压入返回键防护（防止误触返回直接退出教师端）
    armTeacherGuard();
    // 先检测后端
    backendOnline = await checkBackend();
    const dot = $('liveDot');
    const txt = $('liveStatusText');

    if (backendOnline) {
        dot.className = 'live-dot online';
        txt.textContent = '在线 · 实时同步';
        $('liveMode').hidden = false;
        $('offlineMode').hidden = true;
        await loadLiveReports();
        startLiveRefresh();
    } else {
        dot.className = 'live-dot offline';
        txt.textContent = '离线 · CSV 模式';
        $('liveMode').hidden = true;
        $('offlineMode').hidden = false;
        renderImportedList();
        renderDashboard();
    }
}

async function loadLiveReports() {
    try {
        const resp = await fetch(`${API_BASE}/api/reports?token=${encodeURIComponent(TEACHER_TOKEN)}`);
        liveReports = await resp.json();
        renderLiveDashboard();
    } catch (e) {
        console.error('加载失败:', e);
    }
}

function startLiveRefresh() {
    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
    liveRefreshTimer = setInterval(loadLiveReports, 30000); // 30秒自动刷新
}

function stopLiveRefresh() {
    if (liveRefreshTimer) { clearInterval(liveRefreshTimer); liveRefreshTimer = null; }
}

function renderLiveDashboard() {
    const total = liveReports.length;
    if (total === 0) {
        $('liveCards').innerHTML = '<div class="dash-card" style="grid-column:1/-1"><div class="dash-label">暂无学生提交数据</div><div class="dash-value" style="font-size:16px;color:var(--text-secondary)">等待学生提交学情报告...</div></div>';
        $('liveCharts').innerHTML = '';
        $('liveTableBody').innerHTML = '';
        $('liveAtRiskList').innerHTML = '';
        return;
    }

    let stageComplete = [0, 0, 0, 0];
    let totalHints = 0, totalExchanges = 0, allDone = 0, notStarted = 0, inProgress = 0;

    liveReports.forEach(s => {
        let sCompleted = 0, sStarted = false;
        for (let i = 1; i <= 4; i++) {
            const st = s.stages && s.stages[i];
            if (st) {
                if (st.status === '已完成') { stageComplete[i - 1]++; sCompleted++; }
                if (st.answered > 0) sStarted = true;
                totalHints += st.hints || 0;
                totalExchanges += st.exchanges || 0;
            }
        }
        if (sCompleted === 4) allDone++;
        else if (sStarted) inProgress++;
        else notStarted++;
    });

    // 概览卡片
    $('liveCards').innerHTML = [
        { label: '已提交学生', value: total, color: 'var(--accent-blue)' },
        { label: '全部完成', value: allDone, color: 'var(--accent-green)' },
        { label: '进行中', value: inProgress, color: 'var(--accent-orange)' },
        { label: '未开始', value: notStarted, color: 'var(--accent-red)' },
        { label: '总求助次数', value: totalHints, color: 'var(--accent-purple)' },
        { label: '总追问次数', value: totalExchanges, color: 'var(--accent-teal)' }
    ].map(c => `<div class="dash-card"><div class="dash-value" style="color:${c.color}">${c.value}</div><div class="dash-label">${c.label}</div></div>`).join('');

    // 条形图
    const maxStage = Math.max(...stageComplete, 1);
    $('liveCharts').innerHTML = `<div class="chart-block">
        <div class="chart-title">各阶段完成人数</div>
        ${stageComplete.map((c, i) => `
            <div class="bar-row">
                <span class="bar-label">阶段${i + 1}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(c / maxStage * 100).toFixed(0)}%"></div></div>
                <span class="bar-value">${c}/${total}（${(c / total * 100).toFixed(0)}%）</span>
            </div>
        `).join('')}
    </div>`;

    // 学生明细表
    renderLiveTable(liveReports);

    // 关注名单
    const atRisk = liveReports.filter(s => {
        let completed = 0;
        for (let i = 1; i <= 4; i++) if (s.stages && s.stages[i] && s.stages[i].status === '已完成') completed++;
        return completed < 4;
    });
    $('liveAtRiskList').innerHTML = atRisk.length === 0
        ? '<p style="color:var(--text-secondary);padding:12px 0">暂无需要关注的学生</p>'
        : atRisk.map(s => {
            const missing = [];
            for (let i = 1; i <= 4; i++) {
                const st = s.stages && s.stages[i];
                if (!st || st.status !== '已完成') {
                    if (st && st.status === '进行中') missing.push(`阶段${i}(${st.answered}/${st.total})`);
                    else missing.push(`阶段${i}(未开始)`);
                }
            }
            return `<div class="risk-item"><span class="risk-name">${s.name || '未命名'} ${s.studentId ? '(' + s.studentId + ')' : ''}</span><span class="risk-detail">${missing.join('、')}</span></div>`;
        }).join('');
}

function renderLiveTable(data) {
    $('liveTableBody').innerHTML = data.map((s, idx) => {
        const cells = [];
        let totalH = 0, totalE = 0;
        for (let i = 1; i <= 4; i++) {
            const st = s.stages && s.stages[i];
            if (!st) { cells.push('<span class="cell-na">—</span>'); continue; }
            totalH += st.hints || 0; totalE += st.exchanges || 0;
            const cls = st.status === '已完成' ? 'cell-ok' : (st.status === '进行中' ? 'cell-wip' : 'cell-na');
            const txt = st.status === '已完成' ? '✓' : (st.status === '进行中' ? `${st.answered}/${st.total}` : '—');
            cells.push(`<span class="${cls}">${txt}</span>`);
        }
        const submitTime = s.submittedAt || s.updatedAt || '';
        const timeShort = submitTime ? submitTime.replace('T', ' ').substring(0, 16) : '—';
        return `<tr>
            <td>${s.name || '—'}</td>
            <td>${s.studentId || '—'}</td>
            <td style="text-align:center">${s.levelLabel || '—'}</td>
            ${cells.map(c => `<td style="text-align:center">${c}</td>`).join('')}
            <td style="text-align:center">${totalH}</td>
            <td style="text-align:center">${totalE}</td>
            <td style="font-size:11px;color:var(--text-secondary)">${timeShort}</td>
            <td><button class="btn-link" onclick="showStudentModal('${(s.studentId || '').replace(/'/g, "\\'")}')">详情</button></td>
        </tr>`;
    }).join('');
}

function filterLiveTable() {
    const kw = $('studentSearch').value.trim().toLowerCase();
    if (!kw) { renderLiveTable(liveReports); return; }
    const filtered = liveReports.filter(s =>
        (s.name || '').toLowerCase().includes(kw) || (s.studentId || '').toLowerCase().includes(kw)
    );
    renderLiveTable(filtered);
}

function showStudentModal(studentId) {
    const s = liveReports.find(r => r.studentId === studentId);
    if (!s) { showToast('未找到该学生数据', 'error'); return; }

    $('modalTitle').textContent = `${s.name || '未命名'} 的学情详情`;

    let html = '';

    // 基本信息
    html += '<div class="modal-section"><div class="modal-section-title">基本信息</div><div class="modal-info-grid">';
    html += infoItem('姓名', s.name);
    html += infoItem('学号', s.studentId);
    html += infoItem('引导水平', s.levelLabel || '未选择');
    html += infoItem('课程', s.course);
    html += infoItem('指导教师', s.teacher);
    const submitTime = s.submittedAt || s.updatedAt || '';
    html += infoItem('提交时间', submitTime ? submitTime.replace('T', ' ').substring(0, 16) : '—');
    html += '</div></div>';

    // 各阶段详情
    html += '<div class="modal-section"><div class="modal-section-title">各阶段学习情况</div>';
    for (let i = 1; i <= 4; i++) {
        const st = s.stages && s.stages[i];
        const stageName = stages[i] ? stages[i].title : `阶段${i}`;
        if (!st) {
            html += `<div class="modal-stage-row"><span class="modal-stage-name">${stageName}</span><span class="modal-stage-detail cell-na">未开始</span></div>`;
            continue;
        }
        const cls = st.status === '已完成' ? 'cell-ok' : (st.status === '进行中' ? 'cell-wip' : 'cell-na');
        let detail = `${st.answered}/${st.total} 题`;
        if (st.hints) detail += ` · 求助 ${st.hints} 次`;
        if (st.exchanges) detail += ` · 追问 ${st.exchanges} 次`;
        if (st.start) detail += ` · 开始: ${st.start}`;
        if (st.complete) detail += ` · 完成: ${st.complete}`;
        html += `<div class="modal-stage-row"><span class="modal-stage-name">${stageName}</span><span class="modal-stage-detail"><span class="${cls}">${st.status}</span> · ${detail}</span></div>`;
    }
    html += '</div>';

    // 学习反思
    if (s.reflection && s.reflection !== '—') {
        html += `<div class="modal-section"><div class="modal-section-title">学习反思</div><div class="modal-reflection">${s.reflection}</div></div>`;
    }

    // 答题详情
    if (s.answers && s.answers.length) {
        html += '<div class="modal-section"><div class="modal-section-title">答题详情</div>';
        s.answers.forEach(a => {
            const passCls = a.passed === '通过' ? 'cell-ok' : (a.passed === '未通过' ? 'cell-wip' : 'cell-na');
            html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">${a.stage} · ${a.qNum} <span class="${passCls}">[${a.passed}]</span></div>
                <div style="font-size:13px;color:var(--text);margin-bottom:4px">${a.question}</div>
                <div style="font-size:13px;color:var(--text-secondary);background:var(--bg);padding:8px;border-radius:6px">${a.answer || '未作答'}</div>
            </div>`;
        });
        html += '</div>';
    }

    $('modalBody').innerHTML = html;
    $('studentModal').hidden = false;
    armModalGuard();
}

function infoItem(label, value) {
    return `<div class="modal-info-item"><span class="modal-info-label">${label}</span><span class="modal-info-value">${value || '—'}</span></div>`;
}

// ===== 返回键防护（history guard）=====
// 问题：学生详情是弹窗（非路由），教师打开详情后按浏览器/手机返回键，
// 浏览器直接历史后退 → 跳回首页，被踢出教师端。
// 方案：打开弹窗/进入教师面板时压入一条"影子"历史记录，
// 返回键先消耗影子记录（hash 不变、不触发路由）：
//   - 弹窗开着 → 关闭弹窗（返回 = 关闭详情）
//   - 教师面板 → 第一次提示"再按一次退出"，第二次才真正退出
let modalGuardArmed = false;

function armModalGuard() {
    if (modalGuardArmed) return;
    try { history.pushState({ ecoModalGuard: true }, '', location.hash || '#'); modalGuardArmed = true; } catch (e) {}
}

function disarmModalGuard() {
    // 正常关闭弹窗时主动消掉影子记录（hash 相同，无视觉影响）
    if (!modalGuardArmed) return;
    modalGuardArmed = false;
    try { history.back(); } catch (e) {}
}

function armTeacherGuard() {
    // sessionStorage 防重复：刷新后影子记录仍在历史栈中，不能重复压入
    if (sessionStorage.getItem('teacherGuardPushed') === '1') return;
    try {
        history.pushState({ ecoTeacherGuard: true }, '', location.hash || '#');
        sessionStorage.setItem('teacherGuardPushed', '1');
    } catch (e) {}
}

window.addEventListener('popstate', () => {
    // 1) 弹窗影子被返回键消耗：hash 未变，关闭弹窗并吞掉这次返回
    if (modalGuardArmed) {
        modalGuardArmed = false;
        const m = $('studentModal');
        if (m && !m.hidden) { m.hidden = true; return; }
    }
    // 2) 教师面板影子被消耗：hash 仍为 #teacher（不触发 hashchange，面板保持显示）
    const hash = location.hash.replace('#', '') || 'home';
    if (hash === 'teacher' && sessionStorage.getItem('teacherGuardPushed') === '1' && sessionStorage.getItem('teacherAuthed') === '1') {
        sessionStorage.setItem('teacherGuardPushed', '0');
        showToast('再按一次返回将退出教师管理台', 'info');
    }
});

function closeStudentModal() { disarmModalGuard(); $('studentModal').hidden = true; }

// ESC 键 + 点击遮罩关闭
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('studentModal').hidden) closeStudentModal(); });
$('studentModal')?.addEventListener('click', e => { if (e.target.id === 'studentModal') closeStudentModal(); });

function exportLiveReport() {
    if (liveReports.length === 0) { showToast('暂无数据', 'error'); return; }
    // 优先用后端导出接口
    window.open(`${API_BASE}/api/export?token=${encodeURIComponent(TEACHER_TOKEN)}`, '_blank');
}

function exportLiveAnswers() {
    if (liveReports.length === 0) { showToast('暂无数据', 'error'); return; }
    window.open(`${API_BASE}/api/export-answers?token=${encodeURIComponent(TEACHER_TOKEN)}`, '_blank');
}

async function clearBackendData() {
    if (!confirm('确定清空后台全部学情数据？此操作不可恢复。')) return;
    try {
        await fetch(`${API_BASE}/api/clear?token=${encodeURIComponent(TEACHER_TOKEN)}`, { method: 'POST' });
        await loadLiveReports();
        showToast('已清空后台数据', 'info');
    } catch (e) { showToast('清空失败', 'error'); }
}

function renderTeacherOffline() {
    renderImportedList();
    renderDashboard();
}

// CSV 解析（处理 BOM、引号、逗号）
function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.some(c2 => c2 !== '')) rows.push(row);
                row = [];
            } else field += c;
        }
    }
    if (field !== '' || row.length > 0) { row.push(field); if (row.some(c2 => c2 !== '')) rows.push(row); }
    return rows;
}

// 从学情报告 CSV 提取学生数据
function parseStudentReport(csvText, filename) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) return null;
    const headers = rows[0].map(h => h.trim());
    const idx = {};
    ['姓名', '学号', '课程', '指导教师', '阶段', '阶段名称', '完成状态', '回答问题数', '问题总数', '使用帮助次数', '追问次数', '首次访问', '完成时间', '学习反思'].forEach(h => {
        idx[h] = headers.indexOf(h);
    });
    if (idx['姓名'] === -1) return null; // 不是学情报告格式

    const student = { name: '', id: '', course: '', teacher: '', stages: {}, reflection: '', filename };
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const stageStr = r[idx['阶段']] || '';
        const m = stageStr.match(/阶段(\d)/);
        if (!m) continue;
        const sn = parseInt(m[1]);
        if (!student.name) student.name = r[idx['姓名']] || '';
        if (!student.id) student.id = r[idx['学号']] || '';
        if (!student.course) student.course = r[idx['课程']] || '';
        if (!student.teacher) student.teacher = r[idx['指导教师']] || '';
        const reflection = r[idx['学习反思']] || '';
        if (reflection && reflection !== '—') student.reflection = reflection;

        student.stages[sn] = {
            status: r[idx['完成状态']] || '未开始',
            answered: parseInt(r[idx['回答问题数']]) || 0,
            total: parseInt(r[idx['问题总数']]) || 0,
            hints: parseInt(r[idx['使用帮助次数']]) || 0,
            exchanges: parseInt(r[idx['追问次数']]) || 0,
            start: r[idx['首次访问']] || '',
            complete: r[idx['完成时间']] || ''
        };
    }
    return student.name ? student : null;
}

// 从答题详情 CSV 提取
function parseStudentAnswers(csvText, filename) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim());
    const idx = {};
    ['姓名', '学号', '阶段', '题号', '问题', '学生回答', '是否通过'].forEach(h => {
        idx[h] = headers.indexOf(h);
    });
    if (idx['姓名'] === -1) return [];

    const answers = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        answers.push({
            name: r[idx['姓名']] || '',
            id: r[idx['学号']] || '',
            stage: r[idx['阶段']] || '',
            qNum: r[idx['题号']] || '',
            question: r[idx['问题']] || '',
            answer: r[idx['学生回答']] || '',
            passed: r[idx['是否通过']] || ''
        });
    }
    return answers;
}

function handleCSVFiles(files) {
    let imported = 0, failed = 0;
    let pending = files.length;
    if (pending === 0) return;

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            if (file.name.includes('答题详情') || file.name.includes('answers')) {
                // 答题详情
                const ans = parseStudentAnswers(text, file.name);
                if (ans.length) {
                    // 按 学号 去重合并
                    ans.forEach(a => {
                        const existing = teacherData.answers.find(x => x.id === a.id && x.stage === a.stage && x.qNum === a.qNum);
                        if (!existing) teacherData.answers.push(a);
                    });
                    imported++;
                } else failed++;
            } else {
                // 学情报告
                const student = parseStudentReport(text, file.name);
                if (student) {
                    // 去重：同学号覆盖
                    const existingIdx = teacherData.students.findIndex(s => s.id === student.id && student.id);
                    if (existingIdx >= 0) teacherData.students[existingIdx] = student;
                    else teacherData.students.push(student);
                    imported++;
                } else failed++;
            }
            pending--;
            if (pending === 0) {
                if (imported > 0) {
                    showToast(`成功导入 ${imported} 份${failed ? `，${failed} 份解析失败` : ''}`, 'success');
                    renderImportedList();
                    renderDashboard();
                } else {
                    showToast('导入失败，请确认 CSV 格式正确', 'error');
                }
            }
        };
        reader.onerror = () => { failed++; pending--; };
        reader.readAsText(file, 'UTF-8');
    });
}

function renderImportedList() {
    const box = $('importedList');
    const body = $('importedListBody');
    $('importedCount').textContent = teacherData.students.length;

    if (teacherData.students.length === 0 && teacherData.answers.length === 0) {
        box.hidden = true;
        return;
    }
    box.hidden = false;

    const items = [...teacherData.students];
    // 答题详情中可能有不在学情报告里的学生
    teacherData.answers.forEach(a => {
        if (!items.find(s => s.id === a.id) && a.name) {
            items.push({ name: a.name, id: a.id, stages: {}, reflection: '', filename: '(仅答题详情)' });
        }
    });

    body.innerHTML = items.map(s => {
        const completed = Object.entries(s.stages).filter(([, v]) => v.status === '已完成').length;
        return `<div class="imported-item">
            <span class="imported-name">${s.name || '未命名'} ${s.id ? '(' + s.id + ')' : ''}</span>
            <span class="imported-badge">${completed}/${Object.keys(s.stages).length || 0} 阶段完成</span>
            ${s.filename ? `<span class="imported-file">${s.filename}</span>` : ''}
        </div>`;
    }).join('');
}

function renderDashboard() {
    const dash = $('teacherDashboard');
    if (teacherData.students.length === 0) {
        dash.hidden = true;
        return;
    }
    dash.hidden = false;

    const total = teacherData.students.length;
    let stageComplete = [0, 0, 0, 0];
    let totalHints = 0, totalExchanges = 0, totalAnswered = 0, totalQuestions = 0;
    let allDone = 0, notStarted = 0, inProgress = 0;

    teacherData.students.forEach(s => {
        let sCompleted = 0, sStarted = false;
        for (let i = 1; i <= 4; i++) {
            const st = s.stages[i];
            if (st) {
                if (st.status === '已完成') { stageComplete[i - 1]++; sCompleted++; }
                if (st.answered > 0) sStarted = true;
                totalHints += st.hints || 0;
                totalExchanges += st.exchanges || 0;
                totalAnswered += st.answered || 0;
                totalQuestions += st.total || 0;
            }
        }
        if (sCompleted === 4) allDone++;
        else if (sStarted) inProgress++;
        else notStarted++;
    });

    // 概览卡片
    $('dashboardCards').innerHTML = [
        { label: '导入学生', value: total, icon: '<path d="M9 11C11.21 11 13 9.21 13 7C13 4.79 11.21 3 9 3C6.79 3 5 4.79 5 7C5 9.21 6.79 11 9 11ZM3 17C3 14.79 5.79 13 9 13C12.21 13 15 14.79 15 17" stroke="currentColor" stroke-width="2"/>', color: 'var(--accent-blue)' },
        { label: '全部完成', value: allDone, icon: '<path d="M7 9L10 12L15 6M4 9C4 5.69 6.69 3 10 3C13.31 3 16 5.69 16 9C16 12.31 13.31 15 10 15C6.69 15 4 12.31 4 9Z" stroke="currentColor" stroke-width="2"/>', color: 'var(--accent-green)' },
        { label: '进行中', value: inProgress, icon: '<path d="M10 3V5M10 15V17M3 10H5M15 10H17M5.5 5.5L6.9 6.9M13.1 13.1L14.5 14.5M5.5 14.5L6.9 13.1M13.1 6.9L14.5 5.5M10 7C8.34 7 7 8.34 7 10C7 11.66 8.34 13 10 13C11.66 13 13 11.66 13 10C13 8.34 11.66 7 10 7Z" stroke="currentColor" stroke-width="1.5"/>', color: 'var(--accent-orange)' },
        { label: '未开始', value: notStarted, icon: '<path d="M6 4H14C15.1 4 16 4.9 16 6V14C16 15.1 15.1 16 14 16H6C4.9 16 4 15.1 4 14V6C4 4.9 4.9 4 6 4ZM8 9H12" stroke="currentColor" stroke-width="2"/>', color: 'var(--accent-red)' },
        { label: '总求助次数', value: totalHints, icon: '<path d="M9 3C5.13 3 2 6.13 2 10C2 11.46 2.44 12.82 3.19 13.95L2 17L5.05 15.81C6.18 16.56 7.54 17 9 17C12.87 17 16 13.87 16 10C16 6.13 12.87 3 9 3Z" stroke="currentColor" stroke-width="1.5"/>', color: 'var(--accent-purple)' },
        { label: '总追问次数', value: totalExchanges, icon: '<path d="M3 4H15V12H3V4ZM3 12L6 9M15 12L12 9M3 4L6 7M15 4L12 7" stroke="currentColor" stroke-width="1.5"/>', color: 'var(--accent-teal)' }
    ].map(card => `<div class="dash-card">
        <div class="dash-icon" style="color:${card.color}"><svg width="28" height="28" viewBox="0 0 18 18" fill="none">${card.icon}</svg></div>
        <div class="dash-value">${card.value}</div>
        <div class="dash-label">${card.label}</div>
    </div>`).join('');

    // 各阶段完成率条形图
    const maxStage = Math.max(...stageComplete, 1);
    $('dashboardCharts').innerHTML = `<div class="chart-block">
        <h4 class="chart-title">各阶段完成人数</h4>
        ${stageComplete.map((c, i) => `
            <div class="bar-row">
                <span class="bar-label">阶段${i + 1}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(c / maxStage * 100).toFixed(0)}%"></div></div>
                <span class="bar-value">${c}/${total}</span>
            </div>
        `).join('')}
    </div>`;

    // 学生明细表
    $('teacherStatsBody').innerHTML = teacherData.students.map(s => {
        const cells = [];
        let totalH = 0, totalE = 0;
        for (let i = 1; i <= 4; i++) {
            const st = s.stages[i];
            if (!st) { cells.push('<span class="cell-na">—</span>'); continue; }
            totalH += st.hints || 0; totalE += st.exchanges || 0;
            const cls = st.status === '已完成' ? 'cell-ok' : (st.status === '进行中' ? 'cell-wip' : 'cell-na');
            const txt = st.status === '已完成' ? '✓' : (st.status === '进行中' ? `${st.answered}/${st.total}` : '—');
            cells.push(`<span class="${cls}">${txt}</span>`);
        }
        const refShort = s.reflection ? (s.reflection.length > 30 ? s.reflection.substring(0, 30) + '…' : s.reflection) : '—';
        return `<tr>
            <td>${s.name || '—'}</td>
            <td>${s.id || '—'}</td>
            ${cells.map(c => `<td style="text-align:center">${c}</td>`).join('')}
            <td style="text-align:center">${totalH}</td>
            <td style="text-align:center">${totalE}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${refShort}</td>
        </tr>`;
    }).join('');

    // 关注名单
    const atRisk = teacherData.students.filter(s => {
        const completed = Object.entries(s.stages).filter(([, v]) => v.status === '已完成').length;
        return completed < 4;
    });
    $('atRiskList').innerHTML = atRisk.length === 0
        ? '<p style="color:var(--text-secondary);padding:12px 0">暂无需要关注的学生，全班已完成全部阶段。</p>'
        : atRisk.map(s => {
            const missing = [];
            for (let i = 1; i <= 4; i++) {
                const st = s.stages[i];
                if (!st || st.status !== '已完成') {
                    if (st && st.status === '进行中') missing.push(`阶段${i}(进行中 ${st.answered}/${st.total})`);
                    else missing.push(`阶段${i}(未开始)`);
                }
            }
            return `<div class="risk-item">
                <span class="risk-name">${s.name || '未命名'} ${s.id ? '(' + s.id + ')' : ''}</span>
                <span class="risk-detail">${missing.join('、')}</span>
            </div>`;
        }).join('');
}

function clearImportedData() {
    teacherData.students = [];
    teacherData.answers = [];
    renderImportedList();
    renderDashboard();
    showToast('已清空全部导入数据', 'info');
}

function exportClassReport() {
    if (teacherData.students.length === 0) { showToast('暂无数据可导出', 'error'); return; }
    const headers = ['姓名', '学号', '课程', '指导教师', '阶段', '完成状态', '回答问题数', '问题总数', '使用帮助次数', '追问次数', '首次访问', '完成时间', '学习反思'];
    let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
    teacherData.students.forEach(s => {
        for (let i = 1; i <= 4; i++) {
            const st = s.stages[i] || { status: '未开始', answered: 0, total: 0, hints: 0, exchanges: 0, start: '', complete: '' };
            csv += [`"${s.name || '—'}"`, `"${s.id || '—'}"`, `"${s.course || '—'}"`, `"${s.teacher || '—'}"`,
                `"阶段${i}"`, `"${st.status}"`, `"${st.answered}"`, `"${st.total}"`, `"${st.hints}"`, `"${st.exchanges}"`,
                `"${st.start}"`, `"${st.complete}"`, `"${i === 4 ? (s.reflection || '—') : ''}"`].join(',') + '\n';
        }
    });
    downloadCSV(csv, `班级学情汇总_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
}

function exportClassAnswers() {
    if (teacherData.answers.length === 0 && teacherData.students.length === 0) {
        showToast('暂无答题数据可导出', 'error'); return;
    }
    const headers = ['姓名', '学号', '阶段', '题号', '问题', '学生回答', '是否通过'];
    let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
    if (teacherData.answers.length > 0) {
        teacherData.answers.forEach(a => {
            csv += [`"${a.name || '—'}"`, `"${a.id || '—'}"`, `"${a.stage}"`, `"${a.qNum}"`,
                `"${a.question}"`, `"${a.answer}"`, `"${a.passed}"`].join(',') + '\n';
        });
    }
    downloadCSV(csv, `班级答题详情汇总_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
}

// ====== 事件绑定 ======
$('menuToggle')?.addEventListener('click', () => $('sidebar').classList.toggle('open'));

document.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('click', () => {
        const stage = item.dataset.stage;
        if (stage === 'home') navigate('home');
        else if (stage === 'report') navigate('report');
        else navigate(`stage${stage}`);
    });
});

// 表单自动保存
['formName', 'formStudentId', 'formCourse', 'formTeacher', 'formReflection'].forEach(id => {
    document.addEventListener('input', (e) => {
        if (e.target.id === id) saveStudentInfo();
    });
});

// 快捷键 Ctrl+Enter 提交
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const panel = $('inputPanel');
        if (panel && !panel.hidden) {
            const hash = location.hash.replace('#', '');
            if (hash.startsWith('stage')) {
                submitAnswer(parseInt(hash.replace('stage', '')));
            }
        }
    }
});

// 路由监听
window.addEventListener('hashchange', handleRoute);

// 教师台 CSV 导入事件
$('csvFileInput')?.addEventListener('change', (e) => {
    if (e.target.files.length) handleCSVFiles(e.target.files);
    e.target.value = '';
});

const importZone = $('importZone');
if (importZone) {
    importZone.addEventListener('dragover', (e) => { e.preventDefault(); importZone.classList.add('drag-over'); });
    importZone.addEventListener('dragleave', () => importZone.classList.remove('drag-over'));
    importZone.addEventListener('drop', (e) => {
        e.preventDefault();
        importZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleCSVFiles(e.dataTransfer.files);
    });
}

// ====== AI 自由对话（通义千问）======
let aiChatHistory = []; // 当前面板的消息历史 [{role, content}]
let aiChatLoading = false;
let currentAISection = null; // 阶段五的子模块 id

function toggleAIChat() {
    const panel = $('aiChatPanel');
    if (!panel) return;
    if (panel.hidden) {
        // 打开：检测当前阶段
        const hash = location.hash.replace('#', '');
        const stageMatch = hash.match(/^stage(\d+)$/);
        const stageNum = stageMatch ? parseInt(stageMatch[1]) : 1;
        const stage = stages[stageNum];
        $('aiStageTag').textContent = stage ? `${stage.tag}·${stage.title}` : '';
        if (aiChatHistory.length === 0) {
            // 首次打开，推送欢迎语
            addAIMsg('system', `你好！我是 AI 导师。当前上下文：<b>${stage ? stage.title : '自由交流'}</b>。你可以就当前阶段或论文写作自由提问。`);
        }
        panel.hidden = false;
        setTimeout(() => $('aiChatInput')?.focus(), 200);
    } else {
        panel.hidden = true;
    }
}

function addAIMsg(role, content) {
    const area = $('aiChatMessages');
    if (!area) return;
    const wrap = document.createElement('div');
    wrap.className = `ai-msg ${role}`;
    wrap.innerHTML = `
        <div class="ai-msg-avatar">${role === 'tutor' ? 'AI' : (role === 'user' ? '我' : '💡')}</div>
        <div class="ai-msg-bubble"></div>
    `;
    wrap.querySelector('.ai-msg-bubble').innerHTML = role === 'system' ? content : escapeHTML(content).replace(/\n/g, '<br>');
    area.appendChild(wrap);
    area.scrollTop = area.scrollHeight;
    return wrap;
}

function escapeHTML(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendAIMessage(predefinedText) {
    if (aiChatLoading) return;
    const input = $('aiChatInput');
    const sendBtn = $('aiChatSend');
    const text = (predefinedText || input?.value || '').trim();
    if (!text) return;
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;
    aiChatLoading = true;

    addAIMsg('user', text);
    aiChatHistory.push({ role: 'user', content: text });

    // 加载提示
    const placeholder = addAIMsg('tutor', '');
    placeholder.querySelector('.ai-msg-bubble').innerHTML = '<span class="typing-dots-inline"><span></span><span></span><span></span></span>';

    try {
        const hash = location.hash.replace('#', '');
        const m = hash.match(/^stage(\d+)$/);
        const stageNum = m ? parseInt(m[1]) : 1;
        const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: stageNum, level: currentLevel() || 'intermediate', messages: aiChatHistory })
        });
        const data = await r.json();
        if (!r.ok) {
            placeholder.querySelector('.ai-msg-bubble').innerHTML = `<span style="color:#c62828">⚠ ${escapeHTML(data.error || ('请求失败 ' + r.status))}</span>`;
        } else {
            const reply = data.reply || '（AI 未返回内容）';
            placeholder.querySelector('.ai-msg-bubble').innerHTML = escapeHTML(reply).replace(/\n/g, '<br>');
            aiChatHistory.push({ role: 'assistant', content: reply });
        }
    } catch (e) {
        placeholder.querySelector('.ai-msg-bubble').innerHTML = `<span style="color:#c62828">⚠ 网络异常：${escapeHTML(e.message)}</span>`;
    } finally {
        aiChatLoading = false;
        if (sendBtn) sendBtn.disabled = false;
        if (!predefinedText) input?.focus();
    }
}

// 阶段五：论文设计模式（专用视图）
function renderPaperStage(stageNum) {
    const stage = stages[stageNum];
    const container = $('stageContainer');
    const tag = $('aiStageTag');
    if (tag) tag.textContent = `${stage.tag}·${stage.title}`;

    container.innerHTML = `
        <div class="stage-header">
            <div class="stage-tag">${stage.tag}</div>
            <h2>${stage.title}</h2>
            <p class="stage-intro">${stage.intro}</p>
        </div>
        <div class="paper-sections" id="paperSections">
            ${stage.sections.map(s => `
                <button class="paper-section-btn" data-section="${s.id}" onclick="selectPaperSection('${s.id}')">
                    <div class="paper-section-icon">${s.icon}</div>
                    <div class="paper-section-label">${s.label}</div>
                    <div class="paper-section-desc">${getPaperSectionDesc(s.id)}</div>
                </button>
            `).join('')}
        </div>
        <div class="paper-chat-box" id="paperChatBox">
            <div class="paper-chat-header">
                <span style="font-size:20px">💬</span>
                <span class="paper-chat-header-title" id="paperChatTitle">AI 论文导师</span>
            </div>
            <div class="paper-chat-messages" id="paperChatMessages">
                <div class="ai-msg system">
                    <div class="ai-msg-avatar">💡</div>
                    <div class="ai-msg-bubble">欢迎进入自主研究阶段！上方选择一个论文环节（选题/文献/设计/写作/答辩），我将以资深论文导师的身份与你深入讨论。<br><br>如果想泛泛聊聊，直接在下方输入框提问即可。</div>
                </div>
            </div>
            <div class="paper-chat-input-area">
                <textarea class="paper-chat-input" id="paperChatInput" placeholder="向 AI 论文导师提问（Enter 发送，Shift+Enter 换行）" rows="2"></textarea>
                <button class="paper-chat-send" id="paperChatSend" onclick="sendPaperMessage()">发送</button>
            </div>
        </div>
    `;
    currentAISection = null;
    aiChatHistory = []; // 阶段五独立历史
}

function getPaperSectionDesc(id) {
    const map = {
        topic: '评估选题可行性与研究价值',
        literature: '梳理文献脉络，找研究空白',
        design: '审视模型与变量设定',
        writing: '搭建论文结构框架',
        defense: '预测评委问题与应对'
    };
    return map[id] || '';
}

function selectPaperSection(id) {
    const stage = stages[5];
    const section = stage.sections.find(s => s.id === id);
    if (!section) return;
    currentAISection = id;
    // 切换按钮高亮
    document.querySelectorAll('.paper-section-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.section === id);
    });
    $('paperChatTitle').textContent = `📍 ${section.icon} ${section.label}`;
    // 自动发送 starter
    sendPaperMessage(section.starter);
}

async function sendPaperMessage(predefinedText) {
    if (aiChatLoading) return;
    const input = $('paperChatInput');
    const sendBtn = $('paperChatSend');
    const text = (predefinedText || input?.value || '').trim();
    if (!text) return;
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;
    aiChatLoading = true;

    const area = $('paperChatMessages');
    const userWrap = document.createElement('div');
    userWrap.className = 'ai-msg user';
    userWrap.innerHTML = `<div class="ai-msg-avatar">我</div><div class="ai-msg-bubble"></div>`;
    userWrap.querySelector('.ai-msg-bubble').innerHTML = escapeHTML(text).replace(/\n/g, '<br>');
    area.appendChild(userWrap);
    aiChatHistory.push({ role: 'user', content: text });

    const placeholder = document.createElement('div');
    placeholder.className = 'ai-msg tutor';
    placeholder.innerHTML = `<div class="ai-msg-avatar">AI</div><div class="ai-msg-bubble"><span class="typing-dots-inline"><span></span><span></span><span></span></span></div>`;
    area.appendChild(placeholder);
    area.scrollTop = area.scrollHeight;

    try {
        const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: 5, level: currentLevel() || 'intermediate', messages: aiChatHistory })
        });
        const data = await r.json();
        if (!r.ok) {
            placeholder.querySelector('.ai-msg-bubble').innerHTML = `<span style="color:#c62828">⚠ ${escapeHTML(data.error || ('请求失败 ' + r.status))}</span>`;
        } else {
            const reply = data.reply || '（AI 未返回内容）';
            placeholder.querySelector('.ai-msg-bubble').innerHTML = escapeHTML(reply).replace(/\n/g, '<br>');
            aiChatHistory.push({ role: 'assistant', content: reply });
        }
    } catch (e) {
        placeholder.querySelector('.ai-msg-bubble').innerHTML = `<span style="color:#c62828">⚠ 网络异常：${escapeHTML(e.message)}</span>`;
    } finally {
        aiChatLoading = false;
        if (sendBtn) sendBtn.disabled = false;
        if (!predefinedText) input?.focus();
        area.scrollTop = area.scrollHeight;
    }
}

// 切换阶段的 AI 历史（每阶段独立）
function resetAIChatForStage(stageNum) {
    aiChatHistory = [];
    const tag = $('aiStageTag');
    const stage = stages[stageNum];
    if (tag) tag.textContent = stage ? `${stage.tag}·${stage.title}` : '';
}

// AI 面板输入框快捷键
$('aiChatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAIMessage();
    }
});
$('paperChatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPaperMessage();
    }
});

// 初始化
if (!state.globalStart) {
    state.globalStart = Date.now();
    saveState();
}
handleRoute();
