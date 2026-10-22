# 管理员刷新接口安全说明

此说明适用于 Node.js 后端的 `POST /api/refresh`，不改变独立的 Workers KV 后端。现有前置反向代理 Worker 仍将请求转发给 Node.js。

## 密钥校验

- 管理员密钥继续通过 `ADMIN_REFRESH_TOKEN` 配置，支持 `x-admin-refresh-token` 或 `Authorization: Bearer ...`。
- 未配置密钥时返回 `503 admin_refresh_not_configured`，接口不会执行刷新。
- 两侧密钥先计算固定长度的 SHA-256 摘要，再通过 `crypto.timingSafeEqual` 比较，避免直接比较字符串以及不同长度引起的比较异常。
- 请使用至少 32 字节随机生成的密钥，不要复用短信供应商 API key。例如：`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。

## 失败请求与刷新频率

- 同一来源在固定 60 秒窗口内，前 5 次无效密钥请求返回 `403 forbidden`，之后返回 `429 rate_limited` 和 `Retry-After`。
- 失败计数最多保留 1024 个来源；后续失败请求会清除过期记录。容量已满时，不新增来源记录，新来源的失败请求直接返回 `429`，不会驱逐仍有效的计数或无限占用内存。
- 正确密钥先完成校验，不会被匿名失败计数锁定，并清除当前来源的失败计数。通过认证后仍受刷新控制器现有的冷却和防并发机制保护，默认冷却 30 秒。
- 这是失败响应限流，不是严格的密钥猜测次数上限：每次请求仍需校验密钥以避免共享代理地址造成管理员锁定。它不能替代高熵密钥；需要严格的请求次数限制时，应在可信边缘或 Nginx 按真实客户端地址限流。
- 失败计数保存在单个 Node.js 进程内，重启会清空，多进程之间不共享。它不会影响自动定时刷新，也不会改变供应商拉取间隔。

## 可信代理

默认不信任 `X-Forwarded-For`、`CF-Connecting-IP` 等客户端可伪造的转发头，来源使用直连对端地址。

若 Node.js 只由本机 Nginx 转发，可以按实际拓扑配置：

```dotenv
TRUST_PROXY=loopback
```

支持逗号分隔的明确代理 IP、CIDR 或 Express 的命名地址范围，不接受无条件信任所有代理的 `true` 或按跳数信任的配置。修改后需重启 Node.js。

Nginx 应覆盖转发头，保证 Node.js 收到的地址来自可信链路，例如：

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

如果前面还有 Cloudflare，Nginx 必须先仅对 Cloudflare 官方来源地址启用可信真实 IP 还原，再传递 `$remote_addr`。不要直接信任任意客户端提交的 `CF-Connecting-IP`；未完成该配置时，计数可能仍按 Cloudflare 出口地址聚合，但正确管理员密钥不会因此失效。
