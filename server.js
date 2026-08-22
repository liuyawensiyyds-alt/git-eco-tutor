/**
 * 计量经济学教学系统 — 后端服务器（Render 部署版）
 * 双模式存储：
 *   - 有 DATABASE_URL 环境变量 → PostgreSQL（Render 云端运行）
 *   - 无 DATABASE_URL → 本地 JSON 文件（本地开发调试）
 *
 * 前端文件从 ../dist 目录提供
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;
const DIST_DIR = path.join(__dirname, '..', 'dist');

// 教师访问令牌——Render 环境变量优先，否则用默认值；前端 app.js 需同步修改
const TEACHER_TOKEN = process.env.TEACHER_TOKEN || 'eco-teacher-2026';

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

// ====== 服务器 ======

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    // ===== API 路由 =====

    // 健康检查
    if (p === '/api/health' && req.method === 'GET') {
        try {
            const reports = await readReports();
            sendJSON(res, 200, { ok: true, count: reports.length, time: new Date().toISOString() });
        } catch (e) {
            sendJSON(res, 200, { ok: true, count: 0, time: new Date().toISOString(), note: 'db initializing' });
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
        const headers = ['姓名', '学号', '课程', '指导教师', '阶段', '完成状态', '回答问题数', '问题总数', '使用帮助次数', '追问次数', '首次访问', '完成时间', '学习反思', '提交时间'];
        let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';
        reports.forEach(s => {
            for (let i = 1; i <= 4; i++) {
                const st = (s.stages && s.stages[i]) || { status: '未开始', answered: 0, total: 0, hints: 0, exchanges: 0, start: '', complete: '' };
                csv += [`"${s.name || '—'}"`, `"${s.studentId || '—'}"`, `"${s.course || '—'}"`, `"${s.teacher || '—'}"`,
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
        console.log('========================================');
    });
}

start();
