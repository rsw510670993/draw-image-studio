# Draw 生图工作站 — 方案（v0.1，仅方案，未落地）

> 状态：**UI 预览版已上线**（2026-10-23，见文末「进度」）；生成通道尚未接入，当前为演示数据。
>
> 目标：替代已退役的 `/phpAiAPI/` 在首页导航中的位置，做一个**个人 AI 生图工作站**。
> 两条主通道：ChatGPT 订阅（沿用 dsh-image-gen 的 Codex 订阅通道）+ 即梦订阅（jimeng-free-api-all 反代）。
> 本机环境：Ubuntu VM，3 vCPU / 3.8G RAM / 34G 可用磁盘 / **无 GPU**、无 Docker；Node 24.22.1、PHP 8.3、nginx、systemd。

---

## 1. 结论先行

| 项 | 结论 |
|---|---|
| 站点名 | **Draw**（首页卡片标题 `Draw`，副标题「个人 AI 生图工作站 · GPT 订阅 / 即梦双通道」） |
| 网址 | **https://www.usagiviz.xyz/draw/**（与现有 `/aiOcr/`、`/pyGal/`、`/records/` 同级） |
| 形态 | 独立 Web 站（SPA + 本地 Node 网关 + SQLite + 本地图库），不在 DSH 对话里 |
| 通道 | ① ChatGPT 订阅（Codex 内部图片端点）② 即梦（自建 jimeng-free-api-all，127.0.0.1:30301） |
| 部署 | 两个 systemd 服务，均以 `coding` 用户运行；nginx 反代 + 现有 SSO Cookie 门 |
| 本地方案 | 不做本地扩散模型（无 GPU，ComfyUI/SD 不在本期） |
| 落地顺序 | 骨架 → 即梦通道 → 工作台/图库 → ChatGPT 通道 → 提示词库/对比 |

**为什么不用子域名（img.usagiviz.xyz）**：现有证书只签了 `www.usagiviz.xyz`，子域要另配 DNS + 证书 + 跨域 Cookie 处理；同域 `/draw/` 直接复用 SSO 登录态，首页导航链接也最短。若以后要独立域名，SPA 与 API 均为相对路径，迁移成本低。

---

## 2. 两条通道的可行性（基于源码核实，非猜测）

### 2.1 ChatGPT 订阅通道 — 可用，但需要一次 OAuth 授权

dsh-image-gen（Apache-2.0，`shanliuling/dsh-image-gen`）的实现路径：

- OAuth PKCE，client_id 用 Codex CLI 的公开 client（`app_EMoamEEZ73f0CkXaXp7hrann`），回调 `http://localhost:1455/auth/callback`；
- 生图直接调 `POST https://chatgpt.com/backend-api/codex/images/generations`（图生图走 `/edits`），
  model 固定 `gpt-image-2.5-flare`，请求头带 `chatgpt-account-id` + `originator: codex_cli_rs`；
- 返回 `{data:[{b64_json}]}`，token 过期自动 refresh（refresh token 会轮换）。

服务器实测：`auth.openai.com` 与 `chatgpt.com` 均可达（后者裸请求 403 是 Cloudflare 正常表现，带 token 的内部端点不受影响）。

**关键工程问题：回调地址是 `localhost:1455`，浏览器在用户本机。** 本机浏览器点完登录后回调会打到用户自己的 1455，到不了服务器。两种解法：

1. **手动 code 模式（推荐，零依赖）**：站点发起授权时把 verifier/state 存在服务端，弹出授权页；用户登录后浏览器跳到 `http://localhost:1455/...?code=...`（页面打不开），从地址栏复制 `code` 粘回站点完成换取。一次授权，长期 refresh。
2. SSH 隧道模式：`ssh -L 1455:127.0.0.1:1455 …` 后回调直达服务器，体验更顺，但每次换账号要开隧道。

> 该端点属于 ChatGPT 内部接口，非官方承诺，存在改版/风控风险；方案上按「独立账号 + 单路串行 + 失败降级到即梦」设计。

### 2.2 即梦通道 — 可用，官方反代项目

`jimeng-free-api-all`（GPL-3.0，v1.2.8，基于 LLM-Red-Team/jimeng-free-api）：

- OpenAI 兼容：`POST /v1/images/generations`，参数 `model / prompt / negative_prompt / ratio / resolution / n(1~8) / response_format / filePaths(参考图≤10)`；
- 模型：`jimeng-image-5.0-pro / 5.0-lite / 4.7 / 4.6 / 4.5 / 4.1 / 4.0 / 3.1 / 3.0 / 2.0-pro`；
- **返回的是 byteimg 签名 URL（会过期），必须由生图站立刻下载落盘**；
- 账号：即梦 `sessionid` Cookie（可多账号逗号分隔轮询）或控制台建的 `jm_` API Key + 账号池（AES-256-GCM 加密存）；
- 积分（免费每日 66）：3.0/3.1 1K=1 分/张；5.0-lite 2K=3 分；4.x 2K=4 分；5.0-pro 2K=8 分。积分不足自动降级重试；
- 附带 Web 管理控制台（账号池 / Key / 媒体库 / 日志），**不对公网暴露**，仅本机访问或 SSH 隧道；
- 可选「浏览器传输层」用于破 Seedance 视频风控，需要 Chromium（约 400MB+），图片模型通常不需要，**本期关掉**；
- **许可证是 GPL-3.0**：以独立进程部署、只走 HTTP API，不把它的代码链接进生图站；如需改它源码，改动部分按 GPL 开源。生图站自身代码不受传染。

### 2.3 为什么不直接拿 dsh-image-gen 当站点

它是 DSH 插件：前端依赖 `@deepseek-ai/dsh-client-ui-slots`、attachment、settings 等宿主能力，图存在 DSH 工作区，不能独立成站。正确姿势是**借它的 provider 实现与交互设计**（codex/Grok/Google 订阅通道、图库/工作台结构），服务端与前端另写。

---

## 3. 总体架构

```
浏览器 ──https──> nginx (www.usagiviz.xyz)
                   ├─ /draw/        静态 SPA（SSO Cookie 门）
                   ├─ /draw/api/*   → 127.0.0.1:30300  image-studio (Node/Fastify)
                   ├─ /draw/media/* → /var/www/html/draw/data/media（SSO 门）
                   └─ /login /auth/check  现有 SSO

image-studio (30300)
   ├─ 任务队列（并发 2，即梦账号内串行）──> provider: chatgpt-sub ──> chatgpt.com backend-api
   ├─ SQLite（jobs / images / prompts / settings / accounts）
   ├─ 落盘器（下载外链图 → media/YYYY/MM + sharp 缩略图）
   └─ provider: jimeng ──> 127.0.0.1:30301  jimeng-free-api (systemd, GPL 独立进程) ──> jimeng.jianying.com
```

**选型**

| 层 | 选择 | 理由 |
|---|---|---|
| 后端 | Node 24 + Fastify + better-sqlite3 | 与现有 Node/Jimeng 一致，编译工具齐全，轻 |
| 前端 | React 19 + Vite + 原生 CSS（浅色，和首页导航同一套视觉语言） | 无重框架负担；参考 dsh-image-gen 的 Studio/图库交互 |
| 队列 | 进程内队列 + SQLite 状态持久化 + SSE 进度推送 | 单用户规模足够，重启可恢复 |
| 存储 | SQLite + 本地文件（media/thumbs/uploads） | 图不入库，便于备份与清理 |
| 鉴权 | 复用 `/auth/check` SSO（90 天 Cookie）+ API 401 JSON | 与 records/server-maintenance 一致，不新增登录体系 |

---

## 4. 功能范围

### P0（可用）
- **工作台**：提示词、负向提示词、通道/模型、比例、分辨率、张数、参考图（≤10 张，图生图）、生成、实时进度。
- **任务与历史**：异步队列、失败原因、重试、取消；刷新后状态可恢复。
- **图库**：瀑布流、按通道/模型/日期/收藏筛选、大图查看、下载、删除、复制提示词、送回工作台。
- **渠道状态**：即梦账号/积分（`/v1/account/status`）、ChatGPT 账号（邮箱、token 有效期、最近错误）。
- **设置**：默认通道/模型/比例、并发数、存储上限、账号管理（即梦 sessionid、ChatGPT 登录/登出）。

### P1（体验）
- **多模型对比**：同一 prompt 并发 GPT + 即梦，并排比较、批量保存。
- **提示词库**：导入 `awesome-gpt-image-2`（541 条，分类/风格/场景）+ 手绘风格案例；搜索、收藏、一键带入工作台。
- **批量与回收站**：批量生成/下载；软删除 30 天 + 存储配额自动清理（跳过收藏）。

### P2（可选）
- 即梦视频（Seedance，接口已具备，工作站侧加视频卡片即可）。
- 无限画布、提示词变量模板、生成参数预设。

**明确不做**：公开注册/多人协作、公网分享链接、本地 ComfyUI、自动发布到社交平台。

---

## 5. 网址与页面

| 路径 | 内容 |
|---|---|
| `/draw/` | 工作台（默认落地页） |
| `/draw/gallery` | 图库 |
| `/draw/prompts` | 提示词库（P1） |
| `/draw/compare` | 多模型对比（P1） |
| `/draw/settings` | 设置与渠道状态 |
| `/draw/api/*` | JSON API（SSE：`/draw/api/events`） |
| `/draw/media/*` | 图片/缩略图静态输出（SSO 保护） |

首页导航改动：在 `/var/www/html/index.nginx-debian.html` 的 `nav.grid` 增加一张卡片（替换已移除的 phpaiapi 位置）：

```html
<a class="card" href="/draw/">
  <h2>Draw</h2>
  <p>个人 AI 生图工作站 · GPT 订阅 / 即梦双通道</p>
</a>
```

并把「当前共有 4 个子页面」改为 5。

---

## 6. 数据模型（SQLite）

```sql
jobs(id TEXT PK, provider TEXT, model TEXT, prompt TEXT, negative TEXT,
     params TEXT, status TEXT, error TEXT, created_at INT, started_at INT, finished_at INT)
images(id TEXT PK, job_id TEXT, provider TEXT, model TEXT, path TEXT, thumb TEXT,
       width INT, height INT, bytes INT, sha256 TEXT, revised_prompt TEXT,
       favorite INT DEFAULT 0, deleted_at INT, created_at INT)
prompts(id TEXT PK, title TEXT, category TEXT, styles TEXT, text TEXT,
        source TEXT, favorite INT DEFAULT 0)
settings(key TEXT PK, value TEXT)
accounts(provider TEXT PK, label TEXT, meta TEXT, secret BLOB, updated_at INT)
```

目录布局（`/var/www/html/draw/`）：

```
PLAN.md
web/                 # 前端构建产物（nginx 静态根）
server/              # 后端源码（src/、package.json、dist/）
data/
  studio.db
  secrets/master.key # 0600，AES-256-GCM 主密钥
  media/YYYY/MM/     # 原图
  thumbs/YYYY/MM/    # 缩略图
  uploads/           # 参考图临时件（24h 清理）
vendor/jimeng/       # jimeng-free-api-all 固定版本副本（独立进程，数据在 data/jimeng）
```

---

## 7. 部署与运维

**端口**：30300（image-studio，仅 127.0.0.1）、30301（jimeng，仅 127.0.0.1）。均未被占用。按你的建议统一选 **30000 以上**的端口，降低被端口扫描命中的概率；两个服务都只监听 127.0.0.1，不对外。

**systemd（示意）**

```ini
# /etc/systemd/system/image-studio.service
[Service]
User=coding
WorkingDirectory=/var/www/html/draw/server
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production PORT=30300

# /etc/systemd/system/jimeng.service
[Service]
User=coding
WorkingDirectory=/var/www/html/draw/vendor/jimeng
ExecStart=/usr/bin/node --enable-source-maps dist/index.js
Restart=always
EnvironmentFile=/var/www/html/draw/data/secrets/jimeng.env
```

**nginx（示意）**

```nginx
location = /draw { return 301 /draw/; }

location ^~ /draw/api/ {
    include snippets/sso-gate.conf;
    proxy_pass http://127.0.0.1:30300/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;
    client_max_body_size 20m;
}

location ^~ /draw/media/ {
    include snippets/sso-gate.conf;
    alias /var/www/html/draw/data/media/;
    expires 30d;
}

location ^~ /draw/ {
    include snippets/sso-gate.conf;
    root /var/www/html/draw/web;
    index index.html;
    try_files $uri $uri/ /draw/index.html;
}
```

注意：API 的 401 要让前端收到 JSON（而不是 302 到登录页 HTML），用一个 `error_page 401 = @draw_api_401 { return 401 '{"error":"unauthorized"}'; }` 的命名 location，前端拿到 401 后跳 `/login?next=/draw/`。落地时用 curl 验证三种情况（未登录/已登录/无权限）。

**备份与清理**
- 每日 03:30 systemd timer：`sqlite3 studio.db ".backup"` → `data/backups/`，保留 7 份；`media` 只备份索引不做全量（图可再生，收藏图可另打包）。
- 存储上限默认 **5GB**，超限按「未收藏 + 最旧」清理；删除先进回收站 30 天。

**回滚**
- 停用只需 `systemctl disable --now image-studio jimeng` + 注释 nginx 的 `/draw/` 段并 reload；
- nginx 配置改动前备份为 `default.bak-YYYYMMDD`（沿用现有习惯）；
- 站点目录整体可删，不影响其他站点。

---

## 8. 安全与合规

- 全站 SSO（与 records 同一 Cookie 门），不新增加密入口；单用户，无注册。
- 凭据：即梦 sessionid / ChatGPT refresh token 均 AES-256-GCM 加密入库，主密钥 `data/secrets/master.key` 0600，**不进 git、不进记忆、不进日志**；日志脱敏（参考 dsh-image-gen 的 `redact.ts`）。
- 上传/生成参数限长；`client_max_body_size 20m`；API 限速（nginx `limit_req`，生成接口另做服务端并发上限）。
- 即梦管理控制台不反代、不暴露；需要时 SSH 隧道访问 `127.0.0.1:30301/dashboard`。
- 生成的图片属于个人内容，media 目录不列目录、仅经 SSO 输出。
- 许可证：dsh-image-gen（Apache-2.0）借鉴处保留署名；jimeng-free-api-all（GPL-3.0）独立进程部署，代码不混编。
- 合规提示：两条通道都基于订阅账号的非公开接口，存在上游风控/改版风险，仅个人使用，不对外提供生成服务。

---

## 9. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| ChatGPT 内部端点改版/风控 | 通道不可用 | provider 抽象可降级；失败任务自动提示切换即梦；单账号串行、限速 |
| 即梦 sessionid 过期 | 生成失败 | 状态页显示账号健康；设置页支持粘贴更新；多账号池轮询 |
| 即梦外链签名 URL 过期 | 图丢失 | 生成完成立即下载落盘（P0 必做，先落盘再入库） |
| 无 GPU | 不能本地出图 | 本期只做云端订阅通道；需要本地模型时另议（换机/租卡） |
| 磁盘 34G | 图库膨胀 | 5GB 配额 + 回收站 + 缩略图；备份只留元数据 |
| GPL 传染 | 法务 | 独立进程 + HTTP 调用，不链接代码 |
| 订阅账号封禁 | 个人损失 | 建议用独立小号/子账号，不与主账号混用 |

---

## 10. 落地步骤（确认后执行）

1. **骨架**：目录、git init、Vite 前端脚手架、Fastify 后端骨架、systemd 两个 unit、nginx location + 首页导航卡片；curl 验收 SSO 与 401 JSON。
2. **即梦通道**：构建部署 jimeng-free-api-all（固定版本），配置 `127.0.0.1:30301`；用户提供 sessionid（或控制台建 `jm_` Key）；冒烟：`/ping`、`/v1/models`、用 3.0 1K 生成 1 张（1 积分）。
3. **P0 工作台**：任务队列、SSE 进度、落盘/缩略图、图库、状态页、设置页。
4. **ChatGPT 通道**：OAuth 手动 code 模式接入，登录后实测生成 1 张；失败自动提示。
5. **P1**：提示词库导入（541 条）、对比页、批量/回收站/配额清理。
6. **收尾**：备份 timer、README（运维速查）、清理构建残留、实测验收清单全过。

**验收清单（摘要）**：首页导航可进；未登录跳登录；登录后工作台可生成；即梦/ GPT 各出 1 张并落盘；图库可看/下载/删除；状态页显示账号与积分；重启服务后任务与图库不丢；`nginx -t` 通过；无密钥出现在页面/日志/记忆。

---

## 11. 需要你拍板/提供

1. **站名与网址**：默认 `Draw` + `/draw/`；备选 `Image Studio` + `/studio/`、`Paint` + `/paint/`。
2. **即梦账号**：浏览器登录 jimeng.jianying.com → F12 → Application → Cookies → 复制 `sessionid`（可多个，逗号分隔）。我建议先给一个，验证通了再加。
3. **ChatGPT 订阅账号**：落地第 4 步时用；采用「授权页 + 复制 code 粘回」的方式，不需要把密码给我。
4. **存储上限**：默认 5GB，可改。
5. **是否要视频生成**（即梦 Seedance）：默认 P2，先不做。
6. **是否装 Chromium**（即梦浏览器传输层，应对视频风控）：默认不装。

---

## 12. 进度

- **2026-10-23 UI 预览版上线**：`https://www.usagiviz.xyz/draw/`（SSO Cookie 门），首页导航已加 Draw 卡片（共 5 个）。
  - 前端源码 `app/`（Vite + React 19 + 自研 CSS），构建产物 `web/`；
  - 已实现：工作台（通道切换、提示词、模型/分辨率/比例/张数、参考图、进度、结果网格）、图库（筛选/搜索/瀑布流/详情弹层/收藏/删除）、对比（P1 占位）、灵感（24 条示例，正式版导入 541 条）、设置（通道状态/默认参数/存储）；
  - 生成仍为前端模拟（演示数据），真实通道未接；`/draw/api`、`/draw/media` 待后端接入后启用；
  - 预览截图在 `docs/preview/`（不进 nginx 暴露目录）。
- **2026-10-23 v0.2 GPT 通道真实接通**：手机完成 OAuth 登录（手动 code），后端 draw-api 保存加密 token；`POST /draw/api/generate` 调 `chatgpt.com/backend-api/codex/images/generations`，实测单张约 28 秒、1536×1024 输出，落盘 `data/media/YYYY/MM/` 并入库；图库、收藏、软删除均走真实 API。即梦通道、参考图（图生图）、批量生成仍未接。
