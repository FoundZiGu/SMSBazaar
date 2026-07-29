# SMSBazaar

SMSBazaar 是一个用于对比 `OPENAI(ChatGPT)` 短信接码价格和库存的单页面看板。

项目通过服务端定时拉取多家短信平台 API，把不同平台的国家、价格、库存统一归一化，然后在前端按国家维度展示最低价、总库存、在线平台数和各平台明细。

在线访问：[https://sms.fur.li/](https://sms.fur.li/)

## 功能特性

- 固定对比 `OPENAI(ChatGPT)` 服务的接码价格和库存。
- 已接入 7 家短信平台：Hero SMS、SMSBower、5sim、NexSMS、GrizzlySMS、SMS Verification Number、SMSPool。
- 国家统一使用 ISO2 做主键，解决各平台国家 ID 不一致的问题。
- 国家名称显示为中文名，后面带英文名。
- 价格默认显示人民币，同时显示美元换算价。
- 支持按国家、平台、状态和价格/库存排序筛选。
- 支持展开国家查看各平台明细，平台多档价格默认折叠。
- 支持四种业务模式：先手机号注册 OAuth、后手机号绑定 OAuth、目前推荐国家、WhatsApp 接码。
- Node.js 部署每天从 OpenAI 官网同步 API 与 WhatsApp 支持地区，失败时保留上次成功清单。
- 后端默认每 1 分钟自动刷新一次快照。
- 保留管理员手动刷新接口，公网默认需要管理员密钥。
- 前端支持跟随系统、亮色、暗色主题。

## 技术架构

- 前端：React SPA + Vite。
- 后端：Express API + 静态文件托管。
- 存储：SQLite，保存最近快照、刷新状态、汇率缓存和服务配置。
- 部署：构建后一个 Node.js 进程即可同时提供 API 和前端页面。

## 环境要求

- Node.js 20 或更新版本。
- npm。
- 至少配置你需要启用的平台 API key。

## 本地开发

```bash
npm install
cp .env.example .env
npm run dev
```

本地开发时：

- 前端地址：`http://localhost:5173`
- 后端地址：`http://localhost:8787`
- Vite 会把 `/api` 请求代理到后端。

## 生产构建

```bash
npm install
npm run build
npm start
```

默认生产服务监听 `PORT=8787`，并托管 `dist/client` 下的前端构建产物。

## 环境变量

在服务器上复制 `.env.example` 为 `.env`，然后填写真实 API key。

```env
PORT=8787
REFRESH_INTERVAL_MS=60000
REFRESH_COOLDOWN_MS=30000
DATABASE_PATH=./data/app.sqlite
EXCHANGE_RATE_URL=https://api.frankfurter.app/latest?from=USD
RECOMMENDED_COUNTRY_PATHS_FILE=./data/recommended-country-paths.txt
OPENAI_SUPPORTED_COUNTRIES_FILE=./data/openai-supported-api-countries.txt
OPENAI_WHATSAPP_COUNTRIES_FILE=./data/openai-supported-whatsapp-countries.txt
OPENAI_COUNTRY_SYNC_STATE_FILE=./data/openai-country-sync-state.json
OPENAI_COUNTRY_SYNC_ENABLED=true
OPENAI_COUNTRY_SYNC_MODE=browser
OPENAI_COUNTRY_SYNC_INTERVAL_MS=86400000
OPENAI_COUNTRY_SYNC_RETRY_MS=3600000
OPENAI_COUNTRY_SYNC_CHECK_MS=3600000
OPENAI_COUNTRY_SYNC_PAGE_TIMEOUT_MS=120000
OPENAI_COUNTRY_SYNC_BROWSER_HOME=./data/chrome-home
OPENAI_COUNTRY_SYNC_REMOTE_API_URL=https://raw.githubusercontent.com/FoundZiGu/SMSBazaar/main/data/openai-supported-api-countries.txt
OPENAI_COUNTRY_SYNC_REMOTE_WHATSAPP_URL=https://raw.githubusercontent.com/FoundZiGu/SMSBazaar/main/data/openai-supported-whatsapp-countries.txt
OPENAI_COUNTRY_SYNC_PROXY_API_URL=https://r.jina.ai/http://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories
OPENAI_COUNTRY_SYNC_PROXY_WHATSAPP_URL=https://r.jina.ai/http://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ADMIN_REFRESH_TOKEN=
EXPOSE_PROVIDER_ERRORS=false
```

平台 API key：

```env
HERO_SMS_API_KEY=
SMSBOWER_API_KEY=
FIVESIM_API_KEY=
NEXSMS_API_KEY=
GRIZZLYSMS_API_KEY=
SMS_VERIFICATION_API_KEY=
SMSPOOL_API_KEY=
```

平台服务码也可以通过环境变量覆盖：

```env
HERO_SMS_SERVICE_CODE=dr
SMSBOWER_SERVICE_CODE=dr
FIVESIM_SERVICE_CODE=openai
NEXSMS_SERVICE_CODE=dr
GRIZZLYSMS_SERVICE_CODE=dr
SMS_VERIFICATION_SERVICE_CODE=dr
SMSPOOL_SERVICE_CODE=671
SMSPOOL_NATIVE_SERVICE_NAME=OpenAI / ChatGPT
SMSPOOL_REFRESH_INTERVAL_MS=180000
SMSPOOL_STOCK_MODE=pool
SMSPOOL_STOCK_BATCH_SIZE=20
SMSPOOL_INCLUDE_POOL_NAMES=false
```

SMSPool 使用官方原生 API：`/request/pricing` 获取价格档位，`/sms/stock` 获取库存。`SMSPOOL_SERVICE_CODE=671` 对应 `OpenAI / ChatGPT`；如果你的环境里仍保留旧的 `dr`，程序会通过 `SMSPOOL_NATIVE_SERVICE_NAME` 自动解析原生服务 ID。

`SMSPOOL_STOCK_MODE=pool` 表示按价格池查询库存，库存会挂到真实有库存的 pool 上，避免把国家总库存误挂到最低价但不可购买的 pool。不要用价格阈值过滤低价池，因为 SMSPool 里存在真实有库存的低价池。

`SMSPOOL_REFRESH_INTERVAL_MS=180000` 表示 SMSPool 单独每 3 分钟刷新一次，其它平台仍按全局 `REFRESH_INTERVAL_MS=60000` 刷新。这样可以保留页面 1 分钟更新，同时避开 SMSPool 的 120 秒限流窗口。

`SMSPOOL_STOCK_BATCH_SIZE=20` 表示每次 SMSPool 真实刷新只查询 20 个国家的库存，其他国家沿用上一次成功库存；价格仍然全量刷新。这可以避免一次性查询 155 个国家库存导致 `429`。

## 推荐国家配置

目前推荐国家从 `data/recommended-country-paths.txt` 读取。

每一行格式：

```txt
ISO2 PATH
```

`PATH` 含义：

- `0`：推荐走先手机号注册 OAuth。
- `1`：推荐走后手机号绑定 OAuth。

示例：

```txt
GB 1
PH 0
```

前端只显示业务文案，不展示原始 `0/1`，也不暴露服务器上的配置文件路径。

## OpenAI 支持国家

先手机号注册 OAuth 模式读取 `data/openai-supported-api-countries.txt`，WhatsApp 接码模式读取 `data/openai-supported-whatsapp-countries.txt`。

两个文件都使用一行一个 ISO2 国家或地区代码。Node.js 服务默认每 24 小时使用无头浏览器直接读取对应 OpenAI Help Center 官方页面；同步失败后每小时重试，并始终保留上次成功文件。项目使用 `puppeteer-core`，服务器需安装 Chrome/Chromium；程序会自动查找常见 Linux 路径，也可以通过 `PUPPETEER_EXECUTABLE_PATH` 显式指定。`OPENAI_COUNTRY_SYNC_BROWSER_HOME` 应指向服务进程可写的持久化目录。

低内存 VPS 建议设置 `OPENAI_COUNTRY_SYNC_MODE=remote`：GitHub Actions 每天通过 Jina Reader 读取 OpenAI 官方文章并刷新仓库清单，VPS 只下载经过官方源 URL、数量和 ISO2 校验的清单，不在生产机启动 Chrome。Jina Reader 仅作为 Cloudflare Challenge 的传输代理；无法验证官方源 URL或解析结果时不会覆盖旧清单。

官方来源：

- API 支持国家和地区：[OpenAI API - Supported Countries and Territories](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories)
- WhatsApp 验证地区：[Which countries do you support for WhatsApp phone verification?](https://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification)

需要立即验证或强制同步时，可以运行：

```bash
npm run sync:countries
```

## API

```http
GET /api/meta
GET /api/compare?mode=register|bind|recommended|whatsapp&country=US&provider=smsbower&status=in_stock&sort=price_asc
POST /api/refresh
```

`POST /api/refresh` 需要管理员密钥，二选一传入：

```http
x-admin-refresh-token: your-token
Authorization: Bearer your-token
```

如果 `ADMIN_REFRESH_TOKEN` 为空，手动刷新接口会返回 `503 admin_refresh_not_configured`。

## VPS 部署建议

推荐部署方式：

- 使用 `pm2` 或 `systemd` 守护 Node.js 进程。
- 使用 Nginx 反向代理到 `127.0.0.1:8787`。
- 开启 HTTPS。
- `.env` 不要提交到仓库。
- SQLite 数据库建议放在持久化目录，例如 `/var/lib/smsbazaar/app.sqlite`。
- 公网部署保持 `EXPOSE_PROVIDER_ERRORS=false`，避免暴露上游平台的详细错误。
- 设置强随机 `ADMIN_REFRESH_TOKEN`。

PM2 示例：

```bash
npm install
npm run build
pm2 start src/server.js --name smsbazaar
pm2 save
```

Nginx 反向代理示例：

```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Cloudflare Workers 部署（可选）

除了 VPS 部署，项目也支持部署到 Cloudflare Workers（入口在 `workers/`，与 Node.js 部署方式互不影响）：

- API 和静态前端由同一个 Worker 提供（Workers Assets 托管 `dist/client`）。
- 存储使用 Workers KV 替代 SQLite（快照、平台状态、汇率缓存合并为一个 KV key）。
- 定时刷新使用 Cron Triggers 替代 Node 进程里的 `setInterval`。

部署步骤：

```bash
npm install

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV namespace，并把生成的 id 填入 wrangler.toml
npx wrangler kv namespace create SMSBAZAAR_KV

# 3. 配置平台 API key 和管理员密钥（按需）
npx wrangler secret put HERO_SMS_API_KEY
npx wrangler secret put SMSBOWER_API_KEY
npx wrangler secret put FIVESIM_API_KEY
npx wrangler secret put NEXSMS_API_KEY
npx wrangler secret put GRIZZLYSMS_API_KEY
npx wrangler secret put SMS_VERIFICATION_API_KEY
npx wrangler secret put SMSPOOL_API_KEY
npx wrangler secret put ADMIN_REFRESH_TOKEN

# 4. 构建前端并部署
npm run deploy:worker
```

本地调试 Workers 版本：

```bash
npm run dev:worker
# 手动触发一次定时刷新（模拟 Cron）
curl "http://localhost:8787/__scheduled?cron=*%2F2+*+*+*+*"
```

与 Node.js 部署的差异：

- 数据存在 KV 中，不再需要 `DATABASE_PATH`。
- 推荐国家和 OpenAI 支持国家配置在构建时打包进 Worker（`data/*.txt`），修改后需要重新 `wrangler deploy` 生效。Workers 版本不运行 Puppeteer，每日官网同步仅适用于 Node.js 部署。
- 刷新历史只保留最近一次刷新事件。
- 默认 Cron 为每 2 分钟一次：免费版 KV 每天限 1000 次写入，每 2 分钟刷新约 720 次/天可留在免费额度内；Workers 付费版可在 `wrangler.toml` 里改成 `* * * * *` 每分钟刷新。
- 手动刷新接口 `POST /api/refresh` 行为不变，仍需 `ADMIN_REFRESH_TOKEN`。
- 服务码等非敏感覆盖项（如 `SMSPOOL_SERVICE_CODE`）可加到 `wrangler.toml` 的 `[vars]` 中。

## 开源注意事项

- `.env`、SQLite 数据库、构建产物、日志文件和 `node_modules` 已被 `.gitignore` 忽略。
- `data/*.txt` 是公开配置模板，会进入仓库。
- 生产依赖可用 `npm audit --omit=dev` 检查。

## 友情链接

- [LINUX DO - 新的理想型社区](https://linux.do/)

## License

MIT
