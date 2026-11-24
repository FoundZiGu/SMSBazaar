# VPS 前置 Cloudflare Worker

`worker.mjs` 是部署在现有 VPS 之前的反向代理，不是仓库 `workers/index.js` 的 KV 聚合服务入口。不要把两个 Worker 的代码混在一起。

## 部署

1. 在 Cloudflare 打开当前负责反向代理的 Worker，替换为本目录的 `worker.mjs`。
2. 在该 Worker 的变量设置中添加 `ORIGIN_HOST`，值为已有的灰云回源主机名，仅填主机名，不含协议、端口和路径。回源主机名应保存在部署配置中，不要提交到公开仓库。
3. 确保 Worker 兼容日期不早于 `2024-11-11`，以支持 `cache: "no-store"`；新部署可使用当前日期。
4. 保留现有自定义主机名及 Worker 路由配置，部署后检查 `X-SMSBazaar-Proxy-Version: 20261022`。

## 缓存范围

- 公共 `/assets/` 与 `/fonts/` 的 GET/HEAD 请求：成功响应边缘缓存一天。
- 首页、`index.html`、其它路径及 API：子请求使用 `no-store`，响应也设置为不可缓存。
- 带 Cookie 或 Authorization 的请求：不缓存。
- 错误及重定向响应：不缓存；原始查询参数、请求方法和请求体保留。
- 不使用仅 Enterprise 支持的自定义 `cf.cacheKey`。

旧版 `fetch()` 缓存通常使用改写后的回源 URL 作为缓存键。只清理入口域名的 URL，可能无法清理该子请求缓存。需要确认缓存所在的 Worker/回源 Zone 后，按实际回源 URL 清理，或在该 Zone 执行全量清理；不要仅凭入口域名判断缓存归属。

若额外开启了独立的 Workers Caching，或前面还有其它 CDN，应同时排除 HTML/API 缓存。该脚本只能控制它自身发出的子请求与返回响应。
