# 草稿：Slack 集成路线图与下一阶段计划

## 需求（已确认）
- [primary_goal]：为 Slack 集成构建详细的开发路线图文档和下一阶段开发计划。
- [references_required]：以 `feature_docs/slack-edge-cases.md`、`feature_docs/slack-map.md` 以及 `claudecode-slackbot/` 代码作为输入来源。
- [delivery_mode]：立即开始规划，产出可执行的落地指导。

## 技术决策
- [plan_artifact]：在 `.sisyphus/plans/` 下产出一份综合工作计划，包含路线图阶段划分和具体的下一阶段任务。
- [architecture_alignment]：保持 NanoClaw 单进程 + SQLite + 轮询循环架构，避免引入独立 slackbot 的复杂性。
- [integration_boundary]：以 `.claude/skills/add-slack/` 包作为基线实现来源；路线图聚焦于将其应用并加固至生产就绪状态。
- [risk_order]：在功能扩展之前，优先保障可靠性和边界情况防护。

## 研究发现
- [current_runtime_gap]：主运行时目前在 `src/channels/` 中仅有 WhatsApp；Slack 实现以技能产物形式存在，尚未应用到线上 `src/`。
- [spec_compliance_state]：R1-R5、R7-R15 已在技能包中实现；关键缺失或不完整的部分包括子类型过滤、限流重试处理、token 生命周期事件以及运维加固。
- [highest_risks]：`message_changed`/URL 展开导致的重复处理、Slack 429 无重试/退避、socket 断连漂移，以及集成尚未应用到运行时。
- [oracle_guidance]：推荐 4 阶段排序：基础契约 + 持久化、风险优先加固、最小可行 MVP 集成、受控金丝雀发布。
- [transferable_patterns]：参考项目中优先可复用的模式为：队列/背压、滑动窗口限流、输入校验、结构化脱敏日志，以及 SDK 流错误规范化。
- [anti_patterns_to_avoid]：不引入独立 slackbot 的命令框架、MCP 权限工作流、工作目录子系统、功能开关平台或 HTTP 健康服务复杂性。

## 范围边界
- 包含：Slack 路线图排序、依赖感知的任务波次、实现护栏、下一阶段里程碑计划以及验证策略。
- 包含：明确区分"现在必须构建"与"延后处理"的事项。
- 排除：本次规划阶段的即时代码实现。
- 排除：与独立 `claudecode-slackbot` 的完整功能对齐。

## 开放问题
- [none_blocking]：首轮路线图和下一阶段计划生成无需用户做任何阻塞性决策。

## 测试策略决策
- **基础设施已就绪**：是（`vitest`、`tsc`、`npm test`、`npm run build`）。
- **自动化测试**：是（默认事后补测；对高风险逻辑如去重/重试和路由过滤选择性采用 TDD）。
- **Agent 执行 QA**：每项计划任务均为必须。
