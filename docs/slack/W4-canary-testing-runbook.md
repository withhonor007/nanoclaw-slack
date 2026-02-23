# W4 金丝雀测试运行手册

> 本手册覆盖从 Slack App 创建到金丝雀观察完成的完整流程。
> 运维/回滚/监控命令参见 [T10-canary-ops-rollback.md](T10-canary-ops-rollback.md)，本文不重复。

---

## §0 前置条件检查

开始前必须全部满足：

| # | 条件 | 验证命令 | 预期结果 |
|---|------|----------|----------|
| 0-1 | W4 全部 24 门控通过 | 查看 `.sisyphus/plans/slack-tracking-matrix.md` §5 | 24/24 ✅ |
| 0-2 | Git 工作树干净 | `git status` | `nothing to commit, working tree clean` |
| 0-3 | 当前状态为 undeployed | `./feature_docs/clean.sh status` | `Mode: undeployed` |
| 0-4 | 基线快照存在 | `./feature_docs/clean.sh snapshots` | 至少有 `undeployed-*` 快照 |
| 0-5 | 测试全部通过（undeployed） | `npx vitest run` | 345 tests, 0 failures |
| 0-6 | 构建成功 | `npm run build` | exit code 0 |

任一条件不满足，停止并修复后再继续。

---

## §1 Slack App 配置

如已有 Slack App，跳至 §2。

### 1.1 创建 App

1. 打开 https://api.slack.com/apps
2. 点击 **Create New App** → **From scratch**
3. 输入 App 名称（如 `NanoClaw`），选择目标 Workspace
4. 点击 **Create App**

### 1.2 启用 Socket Mode

1. 左侧导航 → **Socket Mode**
2. 开启 **Enable Socket Mode**
3. 创建 App-Level Token：
   - Token Name: `socket-mode`
   - Scope: `connections:write`
   - 点击 **Generate**
4. 复制 token（以 `xapp-` 开头）→ 记为 `SLACK_APP_TOKEN`

### 1.3 配置 Bot Token Scopes

左侧导航 → **OAuth & Permissions** → **Bot Token Scopes**，添加：

| Scope | 用途 |
|-------|------|
| `app_mentions:read` | 读取 @mention 事件 |
| `channels:history` | 读取公共频道消息历史 |
| `channels:read` | 列出公共频道 |
| `chat:write` | 发送消息 |
| `im:history` | 读取私聊消息历史 |
| `im:read` | 列出私聊 |
| `im:write` | 发起私聊 |
| `users:read` | 读取用户信息 |
| `groups:history` | （可选）读取私有频道历史 |
| `groups:read` | （可选）列出私有频道 |

### 1.4 安装到 Workspace

1. 左侧导航 → **Install App** → **Install to Workspace**
2. 授权后复制 **Bot User OAuth Token**（以 `xoxb-` 开头）→ 记为 `SLACK_BOT_TOKEN`

### 1.5 配置事件订阅

1. 左侧导航 → **Event Subscriptions** → 开启 **Enable Events**
2. 展开 **Subscribe to bot events**，添加：
   - `app_mention`
   - `message.channels`
   - `message.im`
   - `message.groups`（可选，对应 `groups:history` scope）
3. 点击 **Save Changes**

### 1.6 验证 App 配置

确认以下全部就绪：

- [ ] Socket Mode 已启用
- [ ] `SLACK_APP_TOKEN`（`xapp-...`）已记录
- [ ] `SLACK_BOT_TOKEN`（`xoxb-...`）已记录
- [ ] Bot Token Scopes 至少包含 8 个必选 scope
- [ ] Event Subscriptions 至少包含 3 个必选事件

---

## §2 环境配置

### 2.1 配置 `.env`

在项目根目录 `.env` 中添加（或修改）：

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here
SLACK_ONLY=true          # true=仅 Slack；false=Slack+WhatsApp 并行
# SLACK_FILTER_BOT_MESSAGES=true  # 可选：过滤其他 bot 消息
```

### 2.2 同步到容器环境

```bash
mkdir -p data/env && cp .env data/env/env
```

或使用 clean.sh：

```bash
./feature_docs/clean.sh env
```

### 2.3 验证环境变量

```bash
grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' .env
grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' data/env/env
```

两处输出应一致。Token 值不应为空或占位符。

---

## §3 双态部署切换

此步骤将项目从 undeployed（技能开发态）切换到 deployed（已部署验证态）。

### 3.1 创建部署前快照

```bash
# 确认当前状态
./feature_docs/clean.sh status
# 预期输出: Mode: undeployed

# 创建快照（保留回退路径）
./feature_docs/clean.sh backup pre-canary
```

### 3.2 切换到 deployed 状态

```bash
# 执行 apply-skill.ts 并切换状态
./feature_docs/clean.sh switch deployed
```

此命令会：
1. 运行 `npx tsx scripts/apply-skill.ts .claude/skills/add-slack`
2. 将技能包代码写入 `src/` 运行时
3. 合并 npm 依赖（`@slack/bolt`）
4. 合并 `.env.example` 条目
5. 设置 `.nanoclaw/dev-mode` 为 `deployed`

### 3.3 验证部署态

```bash
# 安装新依赖（apply-skill 可能更新了 package.json）
npm install

# 运行测试（deployed 态应有 384 tests）
npx vitest run

# 构建
npm run build
```

全部通过后：

```bash
# 创建 deployed 快照
./feature_docs/clean.sh backup canary-deployed
```

### 3.4 部署态验证清单

| # | 检查项 | 命令 | 预期 |
|---|--------|------|------|
| 3-1 | 状态为 deployed | `./feature_docs/clean.sh status` | `Mode: deployed` |
| 3-2 | slack.ts 存在于 src/ | `ls src/channels/slack.ts` | 文件存在 |
| 3-3 | @slack/bolt 已安装 | `ls node_modules/@slack/bolt/package.json` | 文件存在 |
| 3-4 | 测试通过 | `npx vitest run` | 384 tests, 0 failures |
| 3-5 | 构建成功 | `npm run build` | exit code 0 |

---

## §4 服务启动与初始健康检查

### 4.1 重启服务

```bash
# Linux (systemd)
systemctl --user restart nanoclaw

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 4.2 初始健康检查（前 5 分钟）

服务启动后立即执行以下检查：

#### 检查 1：Socket Mode 连接成功

```bash
# Linux
journalctl --user -u nanoclaw --since '5 min ago' | grep 'Slack bot connected via Socket Mode'

# macOS
grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log | tail -1
```

**成功标志**：出现 `Slack bot connected via Socket Mode`，且其前无 `Slack auth.test failed`。

**失败处理**：
- 若出现 `Slack auth.test failed` → 检查 `SLACK_BOT_TOKEN` 是否正确
- 若出现 `invalid_auth` → Token 已过期或被撤销，返回 §1.4 重新生成
- 若无任何 Slack 相关日志 → 检查 `.env` 中 `SLACK_ONLY` 或 `SLACK_BOT_TOKEN` 是否存在

#### 检查 2：无启动错误

```bash
# Linux
journalctl --user -u nanoclaw --since '5 min ago' -p err

# macOS
cat logs/nanoclaw.error.log
```

**成功标志**：无输出（无错误）。

#### 检查 3：发送测试消息

在 Slack 中向 bot 发送 `!chatid`（或 `@BotName !chatid`）。

```bash
# 确认消息被接收和处理
# Linux
journalctl --user -u nanoclaw --since '5 min ago' | grep -E 'Slack message sent|chatid'

# macOS
grep -E 'Slack message sent|chatid' logs/nanoclaw.log | tail -5
```

**成功标志**：bot 回复了频道 ID，日志中出现 `Slack message sent`。

### 4.3 初始健康检查清单

| # | 检查项 | 结果 |
|---|--------|------|
| 4-1 | Socket Mode 连接成功 | ☐ |
| 4-2 | 无启动错误 | ☐ |
| 4-3 | 测试消息收发正常 | ☐ |

全部通过 → 进入 §5 金丝雀观察期。
任一失败 → 参见 §7 回滚流程。

---

## §5 金丝雀观察期

金丝雀期没有固定计时器。当 §6 中全部五个条件均满足时才结束。

### 观察期行为准则

- 不要主动制造故障（除非进行 §5.1 的可选合成演练）
- 保持正常使用 bot，积累自然流量
- 每 4-8 小时执行一次 §6 的诊断命令
- 发现任何 §7 回滚触发条件时立即回滚

### 5.1 可选：合成演练

低流量场景下，某些条件（如 429 限流）可能永远不会自然触发。
以下条件可通过测试验证替代自然观察：

| 条件 | 替代验证方式 |
|------|------------|
| Socket 重连 | 测试套件中 `socket_stale → reconnect` 路径已覆盖（`slack.test.ts`） |
| 限流恢复 | 测试套件中 429 重试路径已覆盖（`slack.test.ts`） |

其余三个条件（幂等性、稳定运行时、Token 有效性）必须通过实际运行观察。

---

## §6 成功诊断

逐一验证以下五个金丝雀退出条件。每个条件附带具体的 grep 命令和成功判定标准。

### 条件 1：Token 有效性 ✓

**含义**：`auth.test()` 成功，bot 身份已验证。

```bash
# Linux
journalctl --user -u nanoclaw | grep 'Slack bot connected via Socket Mode'
journalctl --user -u nanoclaw | grep 'Slack auth.test failed'

# macOS
grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log
grep 'Slack auth.test failed' logs/nanoclaw.log
```

**成功判定**：
- ✅ 至少一条 `Slack bot connected via Socket Mode`
- ✅ 零条 `Slack auth.test failed`
- ✅ 零条 `token_revoked` 或 `app_uninstalled`

### 条件 2：Socket 重连恢复 ✓

**含义**：看门狗检测到 stale 后成功重连，事件处理恢复。

```bash
# Linux
journalctl --user -u nanoclaw | grep -E 'socket_stale|socket_reconnect'

# macOS
grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log
```

**成功判定**（二选一）：
- ✅ 自然触发：出现 `socket_stale` 后紧跟无 `err` 字段的 `socket_reconnect`，后续事件正常处理
- ✅ 测试替代：`npx vitest run src/channels/slack.test.ts` 中看门狗重连路径通过

**失败信号**：`socket_stale` 后 5 分钟内无 `socket_reconnect` → 触发回滚

### 条件 3：限流恢复 ✓

**含义**：收到 429 后自动等待并重试成功。

```bash
# Linux
journalctl --user -u nanoclaw | grep slack_rate_limited
journalctl --user -u nanoclaw | grep slack_send_failed

# macOS
grep slack_rate_limited logs/nanoclaw.log
grep slack_send_failed logs/nanoclaw.log
```

**成功判定**（二选一）：
- ✅ 自然触发：出现 `slack_rate_limited`（含 `retry_after_s`），该消息后续无 `slack_send_failed`
- ✅ 测试替代：`npx vitest run src/channels/slack.test.ts` 中 429 重试路径通过

**失败信号**：同一频道连续 3 次 `slack_send_failed` → 触发回滚

### 条件 4：消息幂等性 ✓

**含义**：50+ 条入站消息，零重复 Agent 调用。

```bash
# 统计已处理消息数
# Linux
journalctl --user -u nanoclaw | grep -c 'Slack message sent'

# macOS
grep -c 'Slack message sent' logs/nanoclaw.log
```

**成功判定**：
- ✅ `Slack message sent` 计数 ≥ 50
- ✅ 日志中无 `UNIQUE constraint` 违规
- ✅ 无同一 `channel:ts` 键被处理两次的记录

**失败信号**：同一 `channel:ts` 触发两次 Agent 调用 → 触发回滚

### 条件 5：稳定运行时 ✓

**含义**：连续 24 小时无未捕获异常。

```bash
# 检查错误日志
# Linux
journalctl --user -u nanoclaw -p err --since '24 hours ago'

# macOS
cat logs/nanoclaw.error.log

# 检查进程运行时间
# Linux
systemctl --user status nanoclaw | grep Active

# macOS
launchctl list | grep nanoclaw
```

**成功判定**：
- ✅ `logs/nanoclaw.error.log` 为空或不存在
- ✅ 进程连续运行 ≥ 24 小时（无崩溃重启）
- ✅ 零 unhandled rejection 或 uncaught exception

**失败信号**：未捕获异常导致进程崩溃 → 触发回滚

### 金丝雀退出检查清单

| # | 条件 | 判定方式 | 结果 |
|---|------|---------|------|
| C1 | Token 有效性 | 日志验证 | ☐ |
| C2 | Socket 重连恢复 | 日志或测试 | ☐ |
| C3 | 限流恢复 | 日志或测试 | ☐ |
| C4 | 消息幂等性（≥50条） | 日志计数 | ☐ |
| C5 | 稳定运行时（≥24h） | 进程状态 | ☐ |

全部 ☑ → 进入 §8 金丝雀退出与推广。
任一失败 → 参见 §7 回滚流程。

---

## §7 回滚流程

### 7.1 双态回滚（推荐）

使用 clean.sh 快照回滚到 undeployed 状态：

```bash
# 回滚到部署前快照
./feature_docs/clean.sh switch undeployed pre-canary

# 验证状态
./feature_docs/clean.sh status
# 预期: Mode: undeployed

# 重新安装依赖（快照可能还原了 package.json）
npm install

# 验证测试通过
npx vitest run
# 预期: 345 tests, 0 failures

# 重建并重启
npm run build
systemctl --user restart nanoclaw    # Linux
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

### 7.2 回滚触发条件与详细命令

参见 [T10-canary-ops-rollback.md](T10-canary-ops-rollback.md) §回滚触发条件 和 §回滚命令序列。

### 7.3 回滚后检查

| # | 检查项 | 命令 | 预期 |
|---|--------|------|------|
| 7-1 | 状态为 undeployed | `./feature_docs/clean.sh status` | `Mode: undeployed` |
| 7-2 | slack.ts 不在 src/ | `ls src/channels/slack.ts 2>/dev/null` | 文件不存在 |
| 7-3 | 测试通过 | `npx vitest run` | 345 tests |
| 7-4 | 服务正常运行 | `systemctl --user status nanoclaw` | active (running) |

---

## §8 金丝雀退出与推广

§6 全部五个条件满足后执行以下步骤。

### 8.1 创建金丝雀成功快照

```bash
./feature_docs/clean.sh backup canary-passed
```

### 8.2 记录金丝雀结果

在 `.sisyphus/plans/slack-tracking-matrix.md` 中更新金丝雀状态：
- 标记 T10 金丝雀为 PASSED
- 记录观察期时长和关键指标（消息数、运行时间）

### 8.3 推广决策

金丝雀通过后，deployed 状态即为生产状态。后续操作：

1. **保持 deployed 状态运行** — 不需要额外切换
2. **提交当前状态** — `git add -A && git commit -m "feat(slack): canary passed, promote to production"`
3. **清理快照**（可选） — 保留 `pre-canary` 和 `canary-passed`，可删除中间快照

### 8.4 后续维护

- 监控命令参见 [T10-canary-ops-rollback.md](T10-canary-ops-rollback.md) §监控命令
- 如需回到开发态修改技能包：`./feature_docs/clean.sh switch undeployed canary-passed`
- 修改完成后重新部署：重复 §3-§4 流程