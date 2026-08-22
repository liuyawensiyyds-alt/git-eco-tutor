# 计量经济学教学系统

苏格拉底式计量经济学四阶段教学引导系统，含学生端学习流程与教师学情后台。

## 部署到 Render（免费）

### 1. 创建 GitHub 仓库

1. 注册/登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 命名如 `eco-tutor`，选 **Public**，点 **Create repository**
4. 点 **uploading an existing file** 链接，把本目录所有文件拖入，点 **Commit changes**

### 2. 创建 Render PostgreSQL 数据库

1. 注册/登录 [Render](https://render.com)（可用 GitHub 账号直接登录）
2. 进入 Dashboard → **New +** → **Postgres**
3. 命名如 `eco-tutor-db`，选 **Free** 套餐
4. 创建后，进入数据库页面 → **Connections** 标签 → 复制 **Internal Database URL**（以 `postgresql://` 开头）

### 3. 创建 Render Web Service

1. Dashboard → **New +** → **Web Service**
2. 选择刚才的 GitHub 仓库 `eco-tutor`
3. 配置：
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. 点 **Advanced** → **Add Environment Variable**：
   - Key: `DATABASE_URL`，Value: 上一步复制的 Internal Database URL
   - Key: `TEACHER_TOKEN`，Value: 你的教师密码（如 `my-secret-key-2026`）
5. 点 **Create Web Service**

### 4. 访问

部署完成后（约 2-5 分钟），Render 会给你一个地址如 `https://eco-tutor.onrender.com`：

- **学生端**: `https://eco-tutor.onrender.com`
- **教师后台**: `https://eco-tutor.onrender.com/#teacher`（输入 TEACHER_TOKEN 密码登录）

## 注意事项

- Render 免费档：15 分钟无人访问会休眠，下一次请求自动唤醒（约 30 秒）
- Render 免费 PostgreSQL：**90 天后到期**，届时需付费 $7/月 或提前导出数据迁移
- 教师密码在环境变量 `TEACHER_TOKEN` 中设置，可在 Render 后台随时修改

## 本地开发

```bash
npm install
node server.js
# 无 DATABASE_URL 时使用本地 JSON 文件存储（server/data/reports.json）
```
