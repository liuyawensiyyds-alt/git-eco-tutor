/**
 * 计量经济学教学系统 — 后端服务器（Render 部署版）
 * 双模式存储：
 *   - 有 DATABASE_URL 环境变量 → PostgreSQL（Render 云端运行）
 *   - 无 DATABASE_URL → 本地 JSON 文件（本地开发调试）
 *
 * 前端文件从 ./dist 目录提供（与 server.js 同级的 dist/）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;
const DIST_DIR = path.join(__dirname, 'dist');

// 教师访问令牌——Render 环境变量优先，否则用默认值；前端 app.js 需同步修改
const TEACHER_TOKEN = process.env.TEACHER_TOKEN || 'eco-teacher-2026';

// 通义千问（阿里云百炼）API 配置 — 学生自由对话与论文设计模块使用
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-turbo'; // 也可选 qwen-plus

// ====== 各阶段/场景的系统提示词（让 AI 知道当前在哪一阶段、应该扮演什么角色） ======
const STAGE_SYSTEM_PROMPTS = {
    1: `你是一位资深计量经济学导师，正在指导学生完成"研究设计"阶段（明确被解释变量 Y、核心解释变量 X、控制变量、研究假设）。
你的风格：
- 启发式引导：先用一句话讲清本环节要做什么、有什么判断标准，再让学生说想法，然后针对性点评
- 每轮回复都必须先给实质内容（讲清一个概念、举一个例子、给一个方向），最多追问一个问题
- 鼓励发散：对同一变量多角度讨论
- 延展性强：举真实顶刊案例、指出学生思路的潜在问题
- 评价学生想法时，先讲清楚"好在哪里 / 问题出在哪里"及理由，再让他重新审视；不要用一句反问把问题丢回去
- 适合本科生到研究生初学者，中文回答
请用对话式语气，像面对面交流。`,

    2: `你是一位计量经济学导师，正在指导"数据获取"阶段（帮助学生找到合适的宏观/金融/调查数据源）。
你的风格：
- 除了给"去哪里下载"，必须同时讲清楚"为什么需要这组数据、它在回归里扮演什么角色"：是作为被解释变量 Y、核心解释变量 X、控制变量、中介/机制变量还是工具变量（IV）；不说明用途就给链接等于没讲
- 具体瑕瑜必陈：给出候选数据源时，逐个说明覆盖范围、时间起点、更新频率、口径差异，再推荐一个最适合他当前 Y/X 的，并说明理由
- 当学生已经明确 Y 和 X 时，直接推荐 1 个主数据源 + 1 个备用数据源，附上 VAR 对应的指标英文名/代码
- 结合学生的研究场景讲：例如"你研究的是省级面板还是企业面板""这是年度还是月度数据""该变量的量纲是否需要平减"
- 不替学生做决定，但要把每个选项的适用条件讲透；学生犹豫或卡住时，直接帮他选定一个并说明理由
- 提醒数据局限：样本期、频率、缺失值、口径变更
中文回答，对话式。`,

    3: `你是一位计量经济学导师，正在指导"数据清洗与变量构建"阶段。
你的风格：
- 强调规范性：缺失值、对数化、缩尾、平减等处理的理由
- 给出检查清单：单位根、异常值、共线性
- 用具体例子说明：CPI 怎么平减到 2010 年价格、面板数据怎么对齐
- 引导先做数据字典
中文回答，对话式。`,

    4: `你是一位计量经济学导师，正在指导"实证推演"阶段（OLS/GMM/面板/工具变量等模型选择与结果解读）。
你的风格：
- 强调因果推断与假设检验
- 解释每个回归系数、显著性、R² 的含义
- 指出常见错误：内生性、遗漏变量、双向因果
- 给出稳健性检验建议
- 学生结果有误时，先直接指出错在哪里、正确的做法是什么，再引导他重新审视；不要只反问"你觉得这里有问题吗"
中文回答，对话式。`,

    5: `你是一位计量经济学论文写作导师，正在指导学生完成一篇实证类经管类本科/硕士毕业论文。
学生已经完成"研究设计→数据→清洗→实证"四个阶段，现在进入自主研究与论文写作阶段。

你的任务：
1. **选题**：帮学生评估选题的可行性、贡献度、可行性。追问：研究问题是否清晰？是否有 2-3 篇可模仿的顶刊文献？数据是否可得？
2. **文献综述**：帮学生梳理文献脉络，指出综述缺漏、研究空白、研究假设的文献依据。
3. **实证设计**：帮学生审视模型设定、变量选取、稳健性检验设计的合理性。
4. **写作框架**：帮学生搭建摘要、引言、文献综述、研究设计、实证结果、结论的标准结构，逐节给出写作要点。
5. **答辩准备**：预测评委可能问的问题，提示应对思路。

风格：
- 严谨、像一位耐心的导师
- 给具体可操作的建议（不是空泛套话）
- 多用真实论文案例（Top 5、JB、JFE、《经济研究》《管理世界》等）
- 鼓励学生先说想法、再给反馈；但学生没想法时，你要先抛出一个带案例的方向，再让他选
- 不替学生写完整段落，但可以示范 1-2 句开头
中文回答，对话式。`,

    general: `你是计量经济学教学助手，正在与学生自由交流。
回答要：自然、灵活、有延展性、像真人在对话。
不要机械地分点列项，要根据学生问题给最适合的回答。
中文，对话式。`
};

// ====== 通用引导准则（所有阶段共用）：先讲清楚，再引导思考；卡壳就直给 ======
const GUIDANCE_CORE = `

【引导准则 · 每一条都必须遵守】
1. 禁止"只提问不讲解"。每一轮回复都要先给实质内容——讲清一个概念、给一步做法、举一个例子——然后最多追问一个问题。绝不允许以"你觉得呢？""你怎么想的？"作为回复的主体或唯一内容。
2. 说人话。术语第一次出现时先用人话解释一句（可打比方、可举身边例子），再给专业表述。不要靠堆术语显得专业，学生听不懂等于没教。
3. 提问必须"带台阶"：给 2-3 个候选方向、或一个半完成的例子，让学生挑、改、补全，而不是开放式反问。一轮只问一个问题。
4. 一次只推进一个知识点，讲透再往下走。回复一般控制在 400 字以内，学生要求展开时再写长。
5. 主动识别卡壳信号。学生出现下列任一情况，立即切换到"直给模式"：
   ① 明确说不懂——"不知道/不懂/不理解/没听懂/不会/没思路/想不到/什么意思/太难了/搞不定/太抽象/看不懂"；
   ② 表达放弃或敷衍——"随便/都行/跳过/不会做/救救我/帮我直接说/有没有答案"；
   ③ 连续两轮答不上来、答非所问，或回答明显偏离问题。
6. 【直给模式】停止一切追问，本轮回复不得出现反问句，按以下顺序给：
   ① 先给结论或直接做法（一句话说清）；
   ② 再给可照做的步骤，标为第一步、第二步…；
   ③ 给一个能照着改的完整示例（公式 / 代码片段 / 写法模板 / 具体到变量名的示范）；
   ④ 最后一句鼓励他自己动手改一改。允许学生直接采用你的答案进入下一环节，不要拦着他说"再想想"。
7. 学生明确求助或表示赶时间时，直接给答案，不要先追问一轮再给。
8. 判断"学生听得懂"的标准：假设对方只学过一学期计量经济学。如果他显然连基础概念都不熟，就自动降级到更简单的讲法。`;

// ====== 学生已明确卡住时追加的强约束（由前端检测 struggle 触发） ======
const STRUGGLE_ADDON = `

【当前状态 · 学生已卡住或明确表示不理解】
- 本轮禁止出现任何反问句，禁止说"你再想想""你觉得呢"
- 直接给结论 → 分步骤做法 → 一个可以照抄并改写的完整示例
- 语言降到最简：假设对方完全没学过这个知识点，先讲"这是什么"，再讲"怎么做"
- 如果内容确实有难度，先给一个生活化类比，再讲专业版本
- 结尾可以给一句"要不要我把第 X 步再展开讲讲？"，但绝不能用它代替讲解`;

// ====== 按学生水平适配的追加指令（解决"初学者被反问卡住""回答笼统"问题） ======
const LEVEL_SYSTEM_ADDONS = {
    beginner: `

【重要】当前学生自评为「初学者」：计量概念基础薄弱，容易被反问式引导卡住。你必须调整教学方式：
- 直接讲解概念和做法，禁止用反问代替讲解（不要"你觉得呢？"式回应）
- 每次只讲一个知识点，讲透再往下走
- 多用生活化例子和类比；用到术语时，先用一句话解释术语
- 给出具体可操作的步骤："第一步…第二步…"
- 如果学生理解有误，直接指出错在哪里并给出正确理解
- 回答必须具体（给公式、给数据源名、给代码片段），禁止笼统套话`,
    intermediate: `

当前学生自评为「进阶」：已学过计量经济学基础。
- 以启发式引导为主，但每一轮都要先给实质内容（方向、要点、例子），再抛一个带台阶的问题，不要连续追问
- 学生卡壳、答非所问或直接求解时，立刻切换为直给：给明确方法和答案，不要反复绕弯`,

    advanced: `

当前学生自评为「高级」：熟悉计量方法。
- 保持苏格拉底式追问，可以深入讨论识别策略、渐近性质、稳健性检验的技术细节，不必回避技术性内容，也不必停留在基础概念
- 但"追问"不等于"只提问"：你要先给出自己的判断、文献依据或半完成的分析，再让他往下做
- 学生明确表示不理解或卡住时，无视本水平设定，一律直给`
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

// ====== 双模式存储层 ======
let pool = null;
let DATA_FILE = null;

if (process.env.DATABASE_URL) {
    // PostgreSQL 模式（Render 云端）
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    console.log('[storage] PostgreSQL 模式');
} else {
    // 本地 JSON 文件模式
    const dataDir = path.join(__dirname, 'data');
    DATA_FILE = path.join(dataDir, 'reports.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    console.log('[storage] 本地 JSON 文件模式');
}

function readLocal() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return []; }
}

function writeLocal(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureTable() {
    if (!pool) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reports (
            student_id TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            submitted_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

async function readReports() {
    if (pool) {
        const result = await pool.query('SELECT data FROM reports ORDER BY submitted_at ASC');
        return result.rows.map(row => row.data);
    }
    return readLocal();
}

async function upsertReport(report) {
    const now = new Date().toISOString();

    if (pool) {
        // 先查已有记录（合并用）
        const existing = await findReport(report.studentId);
        const entry = existing
            ? { ...existing, ...report, updatedAt: now }
            : { ...report, submittedAt: now, updatedAt: now };
        await pool.query(
            `INSERT INTO reports (student_id, data) VALUES ($1, $2)
             ON CONFLICT (student_id) DO UPDATE SET data = $2, updated_at = NOW()`,
            [report.studentId, JSON.stringify(entry)]
        );
        return entry;
    }

    // 本地模式
    const reports = readLocal();
    const idx = reports.findIndex(r => r.studentId === report.studentId);
    if (idx >= 0) {
        reports[idx] = { ...reports[idx], ...report, updatedAt: now };
    } else {
        reports.push({ ...report, submittedAt: now, updatedAt: now });
    }
    writeLocal(reports);
    return reports[Math.max(idx, 0)];
}

async function findReport(studentId) {
    if (!studentId) return null;
    if (pool) {
        const result = await pool.query('SELECT data FROM reports WHERE student_id = $1', [studentId]);
        return result.rows[0] ? result.rows[0].data : null;
    }
    const reports = readLocal();
    return reports.find(r => r.studentId === studentId) || null;
}

async function deleteReport(studentId) {
    if (pool) {
        await pool.query('DELETE FROM reports WHERE student_id = $1', [studentId]);
        return;
    }
    let reports = readLocal();
    reports = reports.filter(r => r.studentId !== studentId);
    writeLocal(reports);
}

async function clearAllReports() {
    if (pool) {
        await pool.query('DELETE FROM reports');
        return;
    }
    writeLocal([]);
}

// ====== 工具函数 ======

function sendJSON(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

// 校验教师令牌：从 URL ?token= 或 Authorization 头读取
function checkTeacherToken(req, urlObj) {
    const q = urlObj.searchParams.get('token') || '';
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    return q === TEACHER_TOKEN || auth === TEACHER_TOKEN;
}

// RFC 5987: Content-Disposition 头中的中文文件名需编码
function contentDisposition(name) {
    return `attachment; filename="report.csv"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// 简易 IP 限流：每 IP 每分钟最多 20 次 AI 调用
const rateMap = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    const arr = (rateMap.get(ip) || []).filter(t => now - t < 60000);
    if (arr.length >= 20) { rateMap.set(ip, arr); return false; }
    arr.push(now);
    rateMap.set(ip, arr);
    return true;
}

// ====== 服务器 ======

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // 防御畸形 URL（如 "//"）导致服务崩溃
    let url;
    try {
        url = new URL(req.url, `http://localhost:${PORT}`);
    } catch (e) {
        console.warn('[http] invalid URL:', JSON.stringify(req.url));
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
    }
    const p = url.pathname;

    // ===== API 路由 =====

    // 健康检查
    if (p === '/api/health' && req.method === 'GET') {
        try {
            const reports = await readReports();
            sendJSON(res, 200, { ok: true, count: reports.length, time: new Date().toISOString(), llm: !!DASHSCOPE_API_KEY });
        } catch (e) {
            sendJSON(res, 200, { ok: true, count: 0, time: new Date().toISOString(), note: 'db initializing', llm: !!DASHSCOPE_API_KEY });
        }
        return;
    }

    // ===== AI 自由对话（通义千问）=====
    if (p === '/api/chat' && req.method === 'POST') {
        if (!DASHSCOPE_API_KEY) {
            sendJSON(res, 503, { error: 'AI 对话未配置（管理员尚未设置 DASHSCOPE_API_KEY）' });
            return;
        }
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (!checkRateLimit(ip)) {
            sendJSON(res, 429, { error: '请求太频繁，请稍后再试（每分钟最多 20 次）' });
            return;
        }
        try {
            const body = await readBody(req);
            const stage = String(body.stage || 'general');
            const messages = Array.isArray(body.messages) ? body.messages : [];
            if (messages.length === 0) { sendJSON(res, 400, { error: '消息不能为空' }); return; }
            // 学生卡壳（前端检测：明确表示不理解 / 长时间无进展 / 重复答不上来）→ 强制直给模式
            const struggling = body.struggle === true;
            let sysPrompt = (STAGE_SYSTEM_PROMPTS[stage] || STAGE_SYSTEM_PROMPTS.general)
                + GUIDANCE_CORE
                + (LEVEL_SYSTEM_ADDONS[body.level] || '');
            if (struggling) sysPrompt += STRUGGLE_ADDON;
            console.log('[chat] stage=%s level=%s struggle=%s', stage, body.level || '-', struggling);
            const r = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
                },
                body: JSON.stringify({
                    model: LLM_MODEL,
                    messages: [
                        { role: 'system', content: sysPrompt },
                        ...messages.slice(-20) // 最多保留最近 20 轮
                    ],
                    temperature: 0.8,
                    top_p: 0.9,
                    max_tokens: 1500
                })
            });
            if (!r.ok) {
                const errText = await r.text();
                console.error('[chat] DashScope error:', r.status, errText.slice(0, 300));
                sendJSON(res, 502, { error: `AI 服务异常 (${r.status})` });
                return;
            }
            const data = await r.json();
            const reply = data.choices?.[0]?.message?.content || '抱歉，我这边暂时没听清，能再说一遍吗？';
            sendJSON(res, 200, { reply, model: LLM_MODEL, stage });
        } catch (e) {
            console.error('[chat] error:', e.message);
            sendJSON(res, 500, { error: e.message });
        }
        return;
    }

    // 学生提交学情
    if (p === '/api/submit' && req.method === 'POST') {
        try {
            const report = await readBody(req);
            if (!report.studentId) {
                sendJSON(res, 400, { error: '缺少学号' });
                return;
            }
            await upsertReport(report);
            const reports = await readReports();
            sendJSON(res, 200, { success: true, count: reports.length, message: '学情已提交至教师后台' });
        } catch (e) {
            sendJSON(res, 400, { error: e.message });
        }
        return;
    }

    // 教师获取全部学情（需教师令牌）
    if (p === '/api/reports' && req.method === 'GET') {
        if (!checkTeacherToken(req, url)) { sendJSON(res, 401, { error: '无权访问，请提供教师令牌' }); return; }
        try {
            const reports = await readReports();
            sendJSON(res, 200, reports);
        } catch (e) {
            sendJSON(res, 500, { error: e.message });
        }
        return;
    }

    // 删除单个学生学情（需教师令牌）
    if (p.startsWith('/api/reports/') && req.method === 'DELETE') {
        if (!checkTeacherToken(req, url)) { sendJSON(res, 401, { error: '无权操作' }); return; }
        const id = decodeURIComponent(p.replace('/api/reports/', ''));
        await deleteReport(id);
        const reports = await readReports();
        sendJSON(res, 200, { success: true, count: reports.length });
        return;
    }

    // 清空全部（需教师令牌）
    if (p === '/api/clear' && req.method === 'POST') {
        if (!checkTeacherToken(req, url)) { sendJSON(res, 401, { error: '无权操作' }); return; }
        await clearAllReports();
        sendJSON(res, 200, { success: true, message: '已清空全部数据' });
        return;
    }

    // 导出全班 CSV（需教师令牌）
    if (p === '/api/export' && req.method === 'GET') {
        if (!checkTeacherToken(req, url)) { sendJSON(res, 401, { error: '无权导出' }); return; }
        const reports = await readReports();
        const headers = ['姓名', '学号', '课程', '指导教师', '学习水平', '阶段', '完成状态', '回答问题数', '问题总数', '使用帮助次数', '追问次数', '首次访问', '完成时间', '学习反思', '提交时间'];
        let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
        reports.forEach(s => {
            for (let i = 1; i <= 4; i++) {
                const st = (s.stages && s.stages[i]) || { status: '未开始', answered: 0, total: 0, hints: 0, exchanges: 0, start: '', complete: '' };
                csv += [`"${s.name || '—'}"`, `"${s.studentId || '—'}"`, `"${s.course || '—'}"`, `"${s.teacher || '—'}"`, `"${s.levelLabel || '未选择'}"`,
                    `"阶段${i}"`, `"${st.status}"`, `"${st.answered}"`, `"${st.total}"`, `"${st.hints}"`, `"${st.exchanges}"`,
                    `"${st.start || ''}"`, `"${st.complete || ''}"`, `"${i === 4 ? (s.reflection || '') : ''}"`,
                    `"${s.submittedAt || s.updatedAt || ''}"`].join(',') + '\n';
            }
        });
        res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': contentDisposition(`班级学情汇总_${new Date().toISOString().slice(0,10)}.csv`)
        });
        res.end(csv);
        return;
    }

    // 导出全班答题详情 CSV（需教师令牌）
    if (p === '/api/export-answers' && req.method === 'GET') {
        if (!checkTeacherToken(req, url)) { sendJSON(res, 401, { error: '无权导出' }); return; }
        const reports = await readReports();
        const headers = ['姓名', '学号', '阶段', '题号', '问题', '学生回答', '是否通过'];
        let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
        reports.forEach(s => {
            if (s.answers && Array.isArray(s.answers)) {
                s.answers.forEach(a => {
                    csv += [`"${s.name || '—'}"`, `"${s.studentId || '—'}"`, `"${a.stage || ''}"`, `"${a.qNum || ''}"`,
                        `"${(a.question || '').replace(/"/g, '""')}"`, `"${(a.answer || '').replace(/"/g, '""')}"`, `"${a.passed || ''}"`].join(',') + '\n';
                });
            }
        });
        res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': contentDisposition(`班级答题详情_${new Date().toISOString().slice(0,10)}.csv`)
        });
        res.end(csv);
        return;
    }

    // ===== 静态文件服务 =====
    let filePath = p === '/' ? '/index.html' : p;
    // SPA fallback: 无扩展名的路径都返回 index.html
    const ext = path.extname(filePath);
    if (!ext) filePath = '/index.html';

    const fullPath = path.join(DIST_DIR, filePath);
    // 防止路径遍历
    if (!fullPath.startsWith(DIST_DIR)) {
        sendJSON(res, 403, { error: 'Forbidden' });
        return;
    }

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, data2) => {
                if (err2) { res.writeHead(404); res.end('Not found'); }
                else {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(data2);
                }
            });
        } else {
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(data);
        }
    });
});

// 启动
async function start() {
    try {
        if (pool) await ensureTable();
    } catch (e) {
        console.error('[startup] 表初始化失败（稍后重试）:', e.message);
    }
    server.listen(PORT, () => {
        console.log('========================================');
        console.log('  计量经济学教学系统 — 后端服务已启动');
        console.log('========================================');
        console.log(`  学生端：    ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
        console.log(`  教师后台：  ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/#teacher`);
        console.log(`  教师令牌：  ${TEACHER_TOKEN}  ← 教师登录用此密码`);
        console.log(`  存储模式：  ${pool ? 'PostgreSQL' : '本地 JSON 文件'}`);
        console.log(`  AI 对话：   ${DASHSCOPE_API_KEY ? `已启用 (${LLM_MODEL})` : '未配置（学生自由对话将提示 503）'}`);
        console.log('========================================');
    });
}

start();
