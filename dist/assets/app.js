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
const LEVELS = {
    beginner: {
        label: '初学者', icon: '🌱',
        desc: '计量基础薄弱或概念不清晰。系统直接讲解概念、给出示例回答，手把手带你走，不会被反问卡住。',
        hintAfter: 1,     // 失败 1 次后自动展开提示
        exampleAfter: 2   // 失败 2 次后自动展示参考示例
    },
    intermediate: {
        label: '进阶', icon: '🚀',
        desc: '学过计量经济学基础课程。以启发式引导为主，卡住时自动给提示，必要时给示例。',
        hintAfter: 2,
        exampleAfter: 3
    },
    advanced: {
        label: '高级', icon: '🎓',
        desc: '熟悉计量方法与实证流程。纯苏格拉底式追问，不主动给提示，挑战最深的理解。',
        hintAfter: 99,
        exampleAfter: 99
    }
};

function currentLevel() {
    return (state.level && LEVELS[state.level]) ? state.level : null;
}

function setLevel(lv, silent) {
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
                        { name: '国家统计局 · 国家数据平台', url: 'https://data.stats.gov.cn', content: 'GDP、CPI、PPI、PMI、固定资产投资、社零总额、工业增加值、居民收入', freq: '月度/季度/年度', how: '按指标·地区·时间筛选 → 导出 Excel（免费免注册）' },
                        { name: '中国人民银行', url: 'http://www.pbc.gov.cn', content: 'M0/M1/M2、社融规模、LPR/SHIBOR 利率、汇率、外汇储备', freq: '月度（LPR 每月20日）', how: '官网"调查统计"栏目' },
                        { name: '财政部', url: 'http://www.mof.gov.cn', content: '财政收支、税收收入、国债发行、地方政府债务', freq: '月度/年度', how: '官网"财政数据"栏目' },
                        { name: '海关总署', url: 'http://www.customs.gov.cn', content: '进出口贸易额、贸易顺差/逆差、按商品/国别分类数据', freq: '月度', how: '官网统计栏目；细粒度 HS 编码数据走海关统计咨询网' },
                        { name: '商务部', url: 'http://www.mofcom.gov.cn', content: 'FDI 利用外资、对外投资 ODI、消费市场、电商交易额', freq: '月度/季度', how: '官网统计数据栏目' }
                    ]
                },
                {
                    id: 'finance', label: '金融与资本市场', icon: '📈',
                    tip: '股价、财务报表、债券、基金数据。学校已购 Wind/CSMAR 权限时优先使用。',
                    sources: [
                        { name: 'CSMAR / Wind / 中经研究数据库', url: 'https://www.gtarsc.com', content: '上市公司财务三表、股票行情、治理结构（高校图书馆通常已购买）', freq: '日度及以上', how: '先问图书馆/院系拿权限 → 导出目标企业名单（带股票代码）→ 用 VLOOKUP 匹配财务指标' },
                        { name: 'AKShare（Python · 免费）', url: 'https://akshare.akfamily.xyz', content: 'A股/期货/基金/宏观数据，Wind 的免费开源替代', freq: '日度/实时', how: 'pip install akshare → 按接口文档调用，返回 DataFrame' },
                        { name: 'Tushare（Python）', url: 'https://tushare.pro', content: '股票日线、财务数据、宏观数据（基础免费，高级需积分）', freq: '日度', how: '注册取 token → pip install tushare' },
                        { name: '巨潮资讯网', url: 'http://www.cninfo.com.cn', content: '上市公司年报/季报/公告全文', freq: '按披露', how: '可批量下载 XBRL 结构化财务数据' },
                        { name: '中国债券信息网 / 外汇交易中心', url: 'https://www.chinabond.com.cn', content: '国债收益率曲线、债券指数 / 人民币汇率中间价、SHIBOR', freq: '日度', how: '官网数据栏目直接下载' }
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
                        { name: '世界银行 WDI', url: 'https://data.worldbank.org', content: '全球各国 GDP、人口、贸易等宏观指标', freq: '年度', how: '在线筛选 → 批量下载 / 支持 API' },
                        { name: 'IMF', url: 'https://www.imf.org', content: '国际金融统计 IFS、世界经济展望 WEO', freq: '月度/年度', how: '官网 Data 栏目' },
                        { name: 'OECD', url: 'https://data.oecd.org', content: '发达国家经济社会环境指标', freq: '多频度', how: '按主题、国家筛选后导出' },
                        { name: 'UN Comtrade', url: 'https://comtrade.un.org', content: '国际贸易明细（按 HS 编码/国别）', freq: '年度/月度', how: '官网检索或 API（海关细粒度数据在此获取）' },
                        { name: 'Google Dataset Search', url: 'https://datasetsearch.research.google.com', content: '跨平台数据集搜索引擎', freq: '—', how: '输入变量关键词检索已有数据集' }
                    ]
                },
                {
                    id: 'micro', label: '微观调查数据', icon: '👥',
                    tip: '研究个体/家庭行为时使用，官网申请（学术用途免费），审核需时日，尽早申请。',
                    sources: [
                        { name: 'CFPS 中国家庭追踪调查', url: 'https://www.isss.pku.edu.cn/cfps/', content: '家庭收入消费、教育、健康、代际关系（个体面板）', freq: '两年一轮', how: '官网注册 → 学术用途申请 → 审核通过后下载' },
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

// 完成阶段二（数据源导航模式）
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
    navigate('home');
    showToast('已退出教师登录', 'info');
}

async function renderTeacher() {
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
}

function infoItem(label, value) {
    return `<div class="modal-info-item"><span class="modal-info-label">${label}</span><span class="modal-info-value">${value || '—'}</span></div>`;
}

function closeStudentModal() { $('studentModal').hidden = true; }

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
