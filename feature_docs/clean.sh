#!/usr/bin/env bash
# clean.sh — NanoClaw 开发状态管理与清理工具
#
# 第一性原理：
# 1) 状态分离：明确 undeployed(技能开发态) / deployed(运行验证态)
# 2) 可回放：先快照再切换，可随时 restore
# 3) 最小破坏：保留历史清理命令，避免打断既有习惯
#
# 用法:
#   ./feature_docs/clean.sh                     # 交互式菜单
#   ./feature_docs/clean.sh status              # 查看当前状态
#   ./feature_docs/clean.sh backup <name>       # 创建快照
#   ./feature_docs/clean.sh restore <name>      # 还原快照
#   ./feature_docs/clean.sh switch undeployed   # 切到未部署开发态
#   ./feature_docs/clean.sh switch deployed     # 应用 add-slack 技能并切到已部署态
#
# 兼容命令（保留）:
#   build/test/deps/skill/ipc/container/env/logs/git/all/data/nuke

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 路径与常量 ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

STATE_DIR="/dev/disk/disk1/clawbot/dev-state-snapshots"
SKILL_PATH=".claude/skills/add-slack"
STATE_FILE=".nanoclaw/state.yaml"
MODE_FILE=".nanoclaw/dev-mode"
HOOK_MARK="# managed-by-clean-sh"

CORE_GUARDS=(
  "src/index.ts"
  "src/config.ts"
  "src/types.ts"
  "src/db.ts"
  "src/router.ts"
  "src/ipc.ts"
  "src/task-scheduler.ts"
  "package.json"
  "package-lock.json"
  ".env.example"
)

# ── 工具函数 ──────────────────────────────────────────────
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }

confirm() {
  local msg="$1"
  echo -en "${YELLOW}${msg} [y/N]${NC} "
  read -r ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "缺少依赖命令: $cmd"
    exit 1
  fi
}

dir_size() {
  if [[ -e "$1" ]]; then
    du -sh "$1" 2>/dev/null | cut -f1
  else
    echo "0"
  fi
}

timestamp() {
  date +"%Y%m%d-%H%M%S"
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

ensure_nanoclaw_dir() {
  mkdir -p .nanoclaw
}

set_mode() {
  local mode="$1"
  ensure_nanoclaw_dir
  echo "$mode" > "$MODE_FILE"
}

get_mode() {
  if [[ -f "$MODE_FILE" ]]; then
    cat "$MODE_FILE"
    return
  fi

  if skill_applied; then
    echo "deployed"
  else
    echo "undeployed"
  fi
}

snapshot_path() {
  local name="$1"
  echo "$STATE_DIR/$name"
}

list_snapshots() {
  ensure_state_dir
  find "$STATE_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed "s#^$STATE_DIR/##" | sort || true
}

latest_snapshot_by_prefix() {
  local prefix="$1"
  list_snapshots | grep -E "^${prefix}-" | tail -n 1 || true
}

git_dirty_paths() {
  git status --porcelain -- "$@" 2>/dev/null || true
}

has_apply_skill_support() {
  [[ -f "scripts/apply-skill.ts" ]]
}

skill_applied() {
  [[ -f "$STATE_FILE" ]] && grep -q "add-slack" "$STATE_FILE"
}

core_dirty() {
  [[ -n "$(git_dirty_paths "${CORE_GUARDS[@]}")" ]]
}

detect_state() {
  if core_dirty; then
    echo "dirty-core"
    return
  fi

  if skill_applied; then
    echo "deployed"
    return
  fi

  echo "undeployed"
}

copy_guard_files() {
  local dest_root="$1"
  mkdir -p "$dest_root/core"

  local file
  for file in "${CORE_GUARDS[@]}"; do
    if [[ -f "$file" ]]; then
      mkdir -p "$dest_root/core/$(dirname "$file")"
      cp "$file" "$dest_root/core/$file"
    fi
  done
}

restore_guard_files() {
  local src_root="$1"

  local file
  for file in "${CORE_GUARDS[@]}"; do
    if [[ -f "$src_root/core/$file" ]]; then
      mkdir -p "$(dirname "$file")"
      cp "$src_root/core/$file" "$file"
    fi
  done
}

write_manifest() {
  local snapshot_dir="$1"
  local mode="$2"
  local state
  state="$(detect_state)"

  cat >"$snapshot_dir/manifest.txt" <<EOF
name=$(basename "$snapshot_dir")
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
mode=$mode
detected_state=$state
git_head=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
skill_path=$SKILL_PATH
EOF
}

create_snapshot() {
  local requested_name="${1:-manual-$(timestamp)}"
  local mode="${2:-manual}"

  ensure_state_dir
  local target
  target="$(snapshot_path "$requested_name")"

  if [[ -e "$target" ]]; then
    err "快照已存在: $requested_name"
    exit 1
  fi

  mkdir -p "$target"
  copy_guard_files "$target"

  if [[ -d "$SKILL_PATH" ]]; then
    mkdir -p "$target/skill"
    cp -R "$SKILL_PATH" "$target/skill/add-slack"
  fi

  if [[ -f "$STATE_FILE" ]]; then
    mkdir -p "$target/nanoclaw"
    cp "$STATE_FILE" "$target/nanoclaw/state.yaml"
  fi

  write_manifest "$target" "$mode"
  ok "快照已创建: $requested_name"
}

restore_snapshot() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    err "restore 需要快照名"
    exit 1
  fi

  local src
  src="$(snapshot_path "$name")"
  if [[ ! -d "$src" ]]; then
    err "快照不存在: $name"
    exit 1
  fi

  local dirty
  dirty="$(git status --porcelain 2>/dev/null || true)"
  if [[ -n "$dirty" ]] && ! confirm "工作区有未提交变更，继续还原可能覆盖文件。是否继续？"; then
    info "已取消还原"
    return
  fi

  restore_guard_files "$src"

  if [[ -d "$src/skill/add-slack" ]]; then
    rm -rf "$SKILL_PATH"
    mkdir -p "$(dirname "$SKILL_PATH")"
    cp -R "$src/skill/add-slack" "$SKILL_PATH"
  fi

  if [[ -f "$src/nanoclaw/state.yaml" ]]; then
    mkdir -p .nanoclaw
    cp "$src/nanoclaw/state.yaml" "$STATE_FILE"
  fi

  local restored_mode
  restored_mode="$(awk -F= '/^mode=/{print $2}' "$src/manifest.txt" 2>/dev/null || true)"
  if [[ "$restored_mode" == "undeployed" || "$restored_mode" == "deployed" ]]; then
    set_mode "$restored_mode"
  fi

  ok "快照已还原: $name"
}

switch_to_undeployed() {
  local snapshot_name="${1:-}"
  if [[ -z "$snapshot_name" ]]; then
    snapshot_name="$(latest_snapshot_by_prefix "undeployed")"
  fi

  if [[ -n "$snapshot_name" ]]; then
    info "使用快照恢复 undeployed 状态: $snapshot_name"
    restore_snapshot "$snapshot_name"
  else
    warn "未找到 undeployed 前缀快照，将执行最小清理并尝试卸载 add-slack 状态"
    clean_skill_state "add-slack"
  fi

  clean_build
  clean_test_cache
  clean_ipc
  set_mode "undeployed"
  ok "已切换到 undeployed（技能开发态）"
}

switch_to_deployed() {
  local snapshot_name="${1:-}"

  if [[ -n "$snapshot_name" ]]; then
    info "使用快照恢复 deployed 状态: $snapshot_name"
    restore_snapshot "$snapshot_name"
  else
    if ! has_apply_skill_support; then
      err "缺少 scripts/apply-skill.ts，无法自动切换到 deployed"
      exit 1
    fi

    info "执行 apply-skill 写入运行态（add-slack）..."
    npx tsx scripts/apply-skill.ts "$SKILL_PATH"
  fi

  set_mode "deployed"
  ok "已切换到 deployed（运行验证态）"
}

core_guard_staged() {
  local path
  for path in "${CORE_GUARDS[@]}"; do
    if git diff --cached --name-only -- "$path" | grep -q .; then
      return 0
    fi
  done
  return 1
}

run_guard_check() {
  local mode
  mode="$(get_mode)"

  if [[ "$mode" == "deployed" ]]; then
    info "guard-check: 当前为 deployed 模式，允许核心 guard 变更进入验证流。"
    return 0
  fi

  if core_guard_staged; then
    err "guard-check 失败：undeployed 模式禁止提交核心 guard 文件变更。"
    err "请先执行: ./feature_docs/clean.sh switch deployed"
    err "若为误改，执行: ./feature_docs/clean.sh switch undeployed <baseline-snapshot>"
    git diff --cached --name-only -- "${CORE_GUARDS[@]}"
    return 1
  fi

  ok "guard-check 通过：未发现核心 guard 暂存变更（mode=$mode）。"
}

write_git_hook() {
  local hook_path="$1"
  cat > "$hook_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
$HOOK_MARK
repo_root="\$(git rev-parse --show-toplevel)"
"\$repo_root/feature_docs/clean.sh" guard-check
EOF
  chmod +x "$hook_path"
}

install_guard_hooks() {
  require_cmd git
  local git_dir
  git_dir="$(git rev-parse --git-dir)"

  local pre_commit="$git_dir/hooks/pre-commit"
  local pre_push="$git_dir/hooks/pre-push"

  if [[ -f "$pre_commit" ]] && ! grep -q "$HOOK_MARK" "$pre_commit"; then
    err "检测到已有 pre-commit 钩子且非 clean.sh 管理，请手动合并后再重试。"
    return 1
  fi

  if [[ -f "$pre_push" ]] && ! grep -q "$HOOK_MARK" "$pre_push"; then
    err "检测到已有 pre-push 钩子且非 clean.sh 管理，请手动合并后再重试。"
    return 1
  fi

  write_git_hook "$pre_commit"
  write_git_hook "$pre_push"
  ok "防误操作硬闸已安装：pre-commit / pre-push"
}

show_status() {
  local state
  state="$(detect_state)"
  echo -e "${BOLD}开发状态报告${NC}"
  echo "  状态: $state"
  echo "  模式锁: $(get_mode)"
  echo "  快照目录: $STATE_DIR"
  echo "  快照数量: $(list_snapshots | wc -l | tr -d ' ')"
  echo "  skills/add-slack: $(dir_size "$SKILL_PATH")"
  echo "  .nanoclaw: $(dir_size .nanoclaw)"

  if core_dirty; then
    warn "核心 guard 文件存在未提交变更："
    git_dirty_paths "${CORE_GUARDS[@]}"
  fi
}

# ── 清理函数（兼容保留）────────────────────────────────────

clean_build() {
  info "清理 TypeScript 构建产物..."
  rm -rf dist/
  rm -f tsconfig.tsbuildinfo
  ok "dist/ 与 tsbuildinfo 已清理"
}

clean_test_cache() {
  info "清理测试缓存..."
  rm -rf node_modules/.vitest
  rm -rf coverage/
  ok "测试缓存已清除"
}

clean_deps() {
  info "清理并重装 node_modules (当前大小: $(dir_size node_modules))..."
  rm -rf node_modules/
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  ok "依赖重装完成"
}

clean_skill_state() {
  local skill_name="${1:-}"

  if [[ -z "$skill_name" ]]; then
    info "清理全部技能状态..."
    rm -rf .nanoclaw/
    ok ".nanoclaw/ 已删除"
    return
  fi

  info "卸载技能: $skill_name"
  if [[ -f scripts/uninstall-skill.ts ]]; then
    npx tsx scripts/uninstall-skill.ts "$skill_name" || {
      warn "自动卸载失败，无法保证 .nanoclaw 状态一致性"
      if confirm "是否删除整个 .nanoclaw 状态目录以确保一致性？"; then
        rm -rf .nanoclaw/
        ok ".nanoclaw/ 已删除"
      else
        warn "已跳过状态目录删除，请手动检查 .nanoclaw/state.yaml"
      fi
    }
  else
    warn "uninstall-skill.ts 不存在，直接清理状态"
    rm -rf .nanoclaw/
  fi

  ok "技能 $skill_name 清理完成"
}

clean_ipc() {
  info "清理 IPC 临时目录..."
  rm -rf data/ipc/
  ok "data/ipc/ 已删除"
}

clean_container() {
  info "清理容器镜像和构建缓存..."
  local runtime="${CONTAINER_RUNTIME:-docker}"

  local running
  running=$($runtime ps -q --filter "name=nanoclaw-" 2>/dev/null || true)
  if [[ -n "$running" ]]; then
    info "停止运行中的 nanoclaw 容器..."
    echo "$running" | xargs $runtime stop 2>/dev/null || true
    ok "容器已停止"
  fi

  if $runtime images nanoclaw-agent --format '{{.ID}}' 2>/dev/null | head -1 | grep -q .; then
    $runtime rmi nanoclaw-agent:latest 2>/dev/null || true
    ok "nanoclaw-agent:latest 镜像已删除"
  else
    info "未找到 nanoclaw-agent 镜像"
  fi

  if confirm "是否清理容器构建缓存？"; then
    $runtime builder prune -f 2>/dev/null || true
    ok "构建缓存已清理"
  fi

  if confirm "是否立即重建容器镜像？"; then
    bash container/build.sh
    ok "容器镜像重建完成"
  fi
}

clean_env_sync() {
  info "重新同步 .env 到容器环境..."
  mkdir -p data/env
  if [[ -f .env ]]; then
    cp .env data/env/env
    ok ".env 已同步到 data/env/env"
  else
    warn ".env 文件不存在"
  fi
}

clean_logs() {
  info "清理日志文件 (当前大小: $(dir_size logs/))..."
  rm -f logs/nanoclaw.log logs/nanoclaw.error.log logs/setup.log
  ok "日志已清除"
}

clean_data() {
  local wipe_auth="${1:-false}"

  warn "⚠️  这将删除运行时数据（SQLite 数据库、认证信息、会话）"
  warn "   包括: store/messages.db, data/env/, data/ipc/, auth 状态文件"
  if [[ "$wipe_auth" == "true" ]]; then
    warn "   并删除: store/auth/（会导致 WhatsApp 需要重新认证）"
  else
    warn "   注意: 默认保留 store/auth/（不会清除 WhatsApp 登录态）"
  fi

  if ! confirm "确定要清理运行时数据吗？这不可逆！"; then
    info "已取消"
    return
  fi

  rm -f store/messages.db
  rm -rf data/env/
  rm -rf data/ipc/
  rm -f store/auth-status.txt store/qr-auth.html store/qr-data.txt
  if [[ "$wipe_auth" == "true" ]]; then
    rm -rf store/auth/
    ok "运行时数据已清除（含 store/auth/）"
  else
    ok "运行时数据已清除（认证信息保留在 store/auth/）"
  fi
}

clean_git_untracked() {
  info "检查 git 未跟踪的文件..."
  local untracked
  untracked=$(git clean -nXd 2>/dev/null || true)
  if [[ -n "$untracked" ]]; then
    echo "$untracked"
    if confirm "是否删除以上被 .gitignore 忽略的文件？"; then
      git clean -fXd
      ok "未跟踪文件已清除"
    fi
  else
    info "没有需要清理的未跟踪文件"
  fi
}

# ── 组合操作 ──────────────────────────────────────────────

do_all() {
  info "执行全量清理（不含运行时数据）..."
  clean_build
  clean_test_cache
  clean_skill_state
  clean_logs
  clean_deps
  clean_env_sync
  ok "全量清理完成。运行 npm run build 验证。"
}

do_nuke() {
  err "☢️  核弹级清理：将删除构建产物、依赖、技能状态、容器镜像、运行时数据、日志"
  if ! confirm "最后确认：真的要执行核弹级清理吗？"; then
    info "已取消"
    return
  fi

  clean_build
  clean_test_cache
  clean_skill_state
  clean_ipc
  clean_logs
  clean_data true
  clean_container
  clean_deps
  clean_env_sync
  ok "核弹级清理完成。下一步: npm run build && npm test"
}

# ── 交互式菜单 ────────────────────────────────────────────

show_menu() {
  echo ""
  echo -e "${BOLD}🧹 NanoClaw 状态与清理工具${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${CYAN}s${NC})  status                  查看当前状态"
  echo -e "  ${CYAN}g${NC})  guard-check             运行防误操作检查"
  echo -e "  ${CYAN}h${NC})  install-guard           安装 pre-commit / pre-push 硬闸"
  echo -e "  ${CYAN}b${NC})  backup                  创建快照"
  echo -e "  ${CYAN}r${NC})  restore                 还原快照"
  echo -e "  ${CYAN}u${NC})  switch undeployed       切到技能开发态"
  echo -e "  ${CYAN}p${NC})  switch deployed         切到运行验证态"
  echo -e "  ${CYAN}1${NC})  build                   清理 TypeScript 构建产物"
  echo -e "  ${CYAN}2${NC})  test                    清理测试缓存"
  echo -e "  ${CYAN}3${NC})  deps                    删除并重装 node_modules"
  echo -e "  ${CYAN}4${NC})  skill                   卸载技能并清理残留"
  echo -e "  ${CYAN}5${NC})  ipc                     清理 IPC 临时目录"
  echo -e "  ${CYAN}6${NC})  container               清理并重建容器镜像"
  echo -e "  ${CYAN}7${NC})  env                     重新同步 .env 到容器环境"
  echo -e "  ${CYAN}8${NC})  logs                    清理日志"
  echo -e "  ${CYAN}9${NC})  git                     清理 .gitignore 忽略的未跟踪文件"
  echo -e "  ${YELLOW}d${NC})  data                    清理运行时数据 ${RED}(危险)${NC}"
  echo -e "  ${CYAN}a${NC})  all                     全量清理（不含运行时数据）"
  echo -e "  ${RED}0${NC})  nuke                    核弹级清理 ${RED}(极度危险)${NC}"
  echo -e "  ${CYAN}q${NC})  退出"
  echo ""
  show_status
  echo ""
  echo -en "选择操作 [s/g/h/b/r/u/p/1-9/a/d/0/q]: "
  read -r choice
  echo ""

  case "$choice" in
    s|S) show_status ;;
    g|G) run_guard_check ;;
    h|H) install_guard_hooks ;;
    b|B)
      echo -en "快照名称（留空自动命名）: "
      read -r name
      create_snapshot "${name:-manual-$(timestamp)}" "manual"
      ;;
    r|R)
      echo "可用快照:"
      list_snapshots || true
      echo -en "输入要还原的快照名称: "
      read -r name
      restore_snapshot "$name"
      ;;
    u|U)
      echo -en "undeployed 快照名（留空自动取最新 undeployed-*）: "
      read -r name
      switch_to_undeployed "$name"
      ;;
    p|P)
      echo -en "deployed 快照名（留空则执行 apply-skill）: "
      read -r name
      switch_to_deployed "$name"
      ;;
    1) clean_build ;;
    2) clean_test_cache ;;
    3) clean_deps ;;
    4)
      echo -en "技能名称（留空清理全部状态）: "
      read -r sname
      clean_skill_state "$sname"
      ;;
    5) clean_ipc ;;
    6) clean_container ;;
    7) clean_env_sync ;;
    8) clean_logs ;;
    9) clean_git_untracked ;;
    d|D) clean_data ;;
    a|A) do_all ;;
    0) do_nuke ;;
    q|Q) exit 0 ;;
    *) err "无效选择" ;;
  esac

  echo ""
  if confirm "继续其他操作？"; then
    show_menu
  fi
}

show_help() {
  cat <<EOF
用法: $0 [command] [args]

状态管理命令:
  status                        查看当前开发状态
  guard-check                   检查是否误提交核心 guard 文件（undeployed 下强制）
  install-guard                 安装 pre-commit / pre-push 硬闸
  backup <name>                 创建快照（保存核心文件+skills+.nanoclaw/state）
  restore <name>                还原快照
  switch undeployed [snapshot]  切换到未部署开发态
  switch deployed [snapshot]    切换到已部署运行态（无 snapshot 时执行 apply-skill）
  snapshots                     列出快照

兼容清理命令:
  build                         清理 TypeScript 构建产物
  test                          清理测试缓存
  deps                          删除并重装 node_modules
  skill [name]                  卸载技能（留空清理全部状态）
  ipc                           清理 IPC 临时目录
  container                     清理并重建容器镜像
  env                           同步 .env 到容器环境
  logs                          清理日志
  git                           清理 .gitignore 忽略的未跟踪文件
  all                           全量清理（不含运行时数据）
  data                          清理运行时数据（危险）
  nuke                          核弹级全量清理

无参数运行进入交互式菜单。
EOF
}

# ── 入口 ──────────────────────────────────────────────────

main() {
  local cmd="${1:-}"
  local arg1="${2:-}"
  local arg2="${3:-}"

  require_cmd git

  case "$cmd" in
    "") show_menu ;;
    status) show_status ;;
    guard-check) run_guard_check ;;
    install-guard) install_guard_hooks ;;
    backup)
      create_snapshot "${arg1:-manual-$(timestamp)}" "manual"
      ;;
    restore)
      restore_snapshot "$arg1"
      ;;
    switch)
      case "$arg1" in
        undeployed) switch_to_undeployed "$arg2" ;;
        deployed) switch_to_deployed "$arg2" ;;
        *)
          err "switch 仅支持 undeployed 或 deployed"
          exit 1
          ;;
      esac
      ;;
    snapshots) list_snapshots ;;
    build) clean_build ;;
    test) clean_test_cache ;;
    deps) clean_deps ;;
    skill) clean_skill_state "$arg1" ;;
    ipc) clean_ipc ;;
    container) clean_container ;;
    env) clean_env_sync ;;
    logs) clean_logs ;;
    git) clean_git_untracked ;;
    all) do_all ;;
    data) clean_data ;;
    nuke) do_nuke ;;
    -h|--help|help) show_help ;;
    *)
      err "未知命令: $cmd"
      show_help
      exit 1
      ;;
  esac
}

main "$@"