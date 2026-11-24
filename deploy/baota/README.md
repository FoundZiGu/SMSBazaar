# 宝塔低维护部署

这组文件用于保留宝塔 Node 项目管理，同时补齐小内存 VPS 的故障恢复和本地备份。
默认项目名为 `smsbazaar`，项目目录为 `/www/wwwroot/smsbazaar`。备份任务通过 `run-with-project-node.py` 自动使用宝塔为项目选择的 Node 版本，升级运行时后无需再修改定时任务。
部署到其它服务器前，先检查路径、原生依赖与运行时的兼容性，以及宝塔提供的 `is_stop_by_user` 接口是否一致。

## 自动处理范围

- 每分钟请求本机 `/api/meta`，连续三次异常后通过宝塔接口重启项目。
- 项目 Node/npm 总 RSS 连续三次达到 384 MiB 时尝试恢复。
- 读取宝塔主动停止标记，用户主动停止的项目不会自动拉起。
- 恢复操作放入独立 systemd scope，避免健康检查结束时误杀 Node；scope 上限为 512 MiB 内存和 512 MiB Swap。
- 宝塔面板及 Nginx 通过 PIDFile 和 systemd 自动恢复异常退出，宝塔任务进程由健康检查补充检测。
- 保留系统安全更新，为更新服务设置 192 MiB 软内存线、384 MiB 硬上限和 512 MiB Swap 上限。
- 下载更新安排在北京时间 04:00，安装更新安排在 04:30，各随机延后最多五分钟。
- 每天北京时间 03:00 左右生成 SQLite 在线备份，包含 `.env` 与国家配置；仅 root 可读，保留七天。
- 备份校验成功后清理三十天以前的已完成刷新记录，保留十四天的分钟内存采样。
- 网站日志按天或达到 25 MiB 时轮转，保留七份压缩日志。

## 部署位置

| 源文件 | 服务器位置 |
| --- | --- |
| `healthcheck.py`、`backup.cjs`、`run-with-project-node.py` | `/usr/local/lib/smsbazaar/` |
| 四个 `smsbazaar-*.service/timer` | `/etc/systemd/system/` |
| `bt-recovery.conf` | `/etc/systemd/system/bt.service.d/smsbazaar-recovery.conf` |
| `nginx-recovery.conf` | `/etc/systemd/system/nginx.service.d/smsbazaar-recovery.conf` |
| `apt-resources.conf` | 两个 `apt-daily*.service.d/smsbazaar-resources.conf` |
| 两个 `apt-*.timer.conf` | 对应 `apt-daily*.timer.d/smsbazaar-schedule.conf` |
| `logrotate.conf` | `/etc/logrotate.d/smsbazaar` |

另外需确保 Swap 已启用并写入 `/etc/fstab`，建议小内存机器使用 2 GiB Swap、`vm.swappiness=20`。
修改前保留原配置，使用 `systemd-analyze verify` 和 `logrotate --debug` 校验后再启用。
初次安装 PIDFile drop-in 后，需要重启对应服务，才能让 systemd 正确跟踪实际进程。

```bash
systemctl daemon-reload
systemctl enable --now smsbazaar-healthcheck.timer smsbazaar-backup.timer
```

## 查看与暂停

```bash
systemctl list-timers 'smsbazaar-*'
journalctl -u smsbazaar-healthcheck.service -u smsbazaar-backup.service
```

在宝塔中主动停止项目即可停止自动恢复该项目；再次启动后恢复监测。
维护整个服务器时，可暂时停止健康检查定时器，结束后再启动：

```bash
systemctl stop smsbazaar-healthcheck.timer
systemctl start smsbazaar-healthcheck.timer
```

内存 CSV 位于 `/var/lib/smsbazaar-maintenance/`，每行依次为 Unix 时间、项目 RSS KiB、API 是否正常。
备份位于 `/www/server/smsbazaar-data/backups/`；其中含有 API 密钥，不能放到网站公开目录或提交到 Git。
本机备份无法覆盖整台 VPS 或磁盘丢失，重要数据还应定期复制到独立存储。
网站和宝塔面板的证书续期仍交由现有宝塔及 Certd 流水线处理。
