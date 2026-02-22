#!/usr/bin/env bash
# clean.sh — NanoClaw 缓存与依赖清理工具
# 用于技能（插件）开发的多轮迭代测试
#
# 用法:
#   ./feature_docs/clean.sh              # 交互式菜单
#   ./feature_docs/clean.sh all          # 全量清理（不含数据）
#   ./feature_docs/clean.sh build        # 仅清理构建产物
#   ./feature_docs/clean.sh deps         # 重装依赖
#   ./feature_docs/clean.sh skill [name] # 卸载技能并清理残留
#   ./feature_docs/clean.sh ipc          # 清理 IPC 临时文件
#   ./feature_docs/clean.sh container    # 重建容器镜像
#   ./feature_docs/clean.sh data         # 清理运行时数据（危险）
#   ./feature_docs/clean.sh nuke         # 核弹级清理：全部重来

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 路径 ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

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

# 计算目录/文件大小（兼容 Linux 和 macOS）
dir_size() {
  if [[ -e "$1" ]]; then
    du -sh "$1" 2>/dev/null | cut -f1
  else
    echo "0"
  fi
}

# ── 清理函数 ──────────────────────────────────────────────

clean_build() {
  info "清理 TypeScript 构建产物..."
  rm -rf dist/
  # tsbuildinfo 增量编译缓存
  rm -f tsconfig.tsbuildinfo
  ok "dist/ 已删除"
}

clean_test_cache() {
  info "清理测试缓存..."
  # vitest 缓存
  rm -rf node_modules/.vitest
  # coverage 报告
  rm -rf coverage/
  ok "测试缓存已清除"
}

clean_deps() {
  info "清理并重装 node_modules (当前大小: $(dir_size node_modules))..."
  rm -rf node_modules/
  if [[ -f package-lock.json ]]; then
    info "检测到 package-lock.json，执行 npm ci..."
    npm ci --no-audit --no-fund
  else
    info "未检测到 package-lock.json，执行 npm install..."
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
  else
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
  fi
}

clean_ipc() {
  info "清理 IPC 临时目录..."
  rm -rf data/ipc/
  ok "data/ipc/ 已删除"
}

clean_container() {
  info "清理容器镜像和构建缓存..."
  
  local runtime="${CONTAINER_RUNTIME:-docker}"
  
  # 停止运行中的 nanoclaw 容器
  local running
  running=$($runtime ps -q --filter "name=nanoclaw-" 2>/dev/null || true)
  if [[ -n "$running" ]]; then
    info "停止运行中的 nanoclaw 容器..."
    echo "$running" | xargs $runtime stop 2>/dev/null || true
    ok "容器已停止"
  fi
  
  # 删除镜像
  if $runtime images nanoclaw-agent --format '{{.ID}}' 2>/dev/null | head -1 | grep -q .; then
    $runtime rmi nanoclaw-agent:latest 2>/dev/null || true
    ok "nanoclaw-agent:latest 镜像已删除"
  else
    info "未找到 nanoclaw-agent 镜像"
  fi
  
  # 清理 buildkit 缓存（解决 COPY 步骤缓存不失效的问题）
  if confirm "是否清理 Docker buildkit 缓存？（确保完全干净的重建）"; then
    $runtime builder prune -f 2>/dev/null || true
    ok "buildkit 缓存已清理"
  fi
  
  # 重建
  if confirm "是否立即重建容器镜像？"; then
    info "重建容器镜像..."
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
  echo ""
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
  echo ""
  clean_build
  clean_test_cache
  clean_skill_state
  clean_logs
  clean_deps
  clean_env_sync
  echo ""
  ok "全量清理完成。运行 npm run build 验证。"
}

do_nuke() {
  echo ""
  err "☢️  核弹级清理：将删除所有构建产物、依赖、技能状态、"
  err "   容器镜像、运行时数据、日志。仅保留源码和 git 历史。"
  echo ""
  if ! confirm "最后确认：真的要执行核弹级清理吗？"; then
    info "已取消"
    return
  fi
  echo ""
  clean_build
  clean_test_cache
  clean_skill_state
  clean_ipc
  clean_logs
  clean_data true
  clean_container
  clean_deps
  clean_env_sync
  echo ""
  ok "核弹级清理完成。项目已恢复到接近初始状态。"
  info "下一步: npm run build && npm test"
}

# ── 交互式菜单 ────────────────────────────────────────────

show_menu() {
  echo ""
  echo -e "${BOLD}🧹 NanoClaw 清理工具${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${CYAN}1${NC})  build       清理 TypeScript 构建产物 (dist/)"
  echo -e "  ${CYAN}2${NC})  test        清理测试缓存 (vitest, coverage)"
  echo -e "  ${CYAN}3${NC})  deps        删除并重装 node_modules"
  echo -e "  ${CYAN}4${NC})  skill       卸载技能并清理残留"
  echo -e "  ${CYAN}5${NC})  ipc         清理 IPC 临时目录 (data/ipc/)"
  echo -e "  ${CYAN}6${NC})  container   清理并重建容器镜像"
  echo -e "  ${CYAN}7${NC})  env         重新同步 .env 到容器环境"
  echo -e "  ${CYAN}8${NC})  logs        清理日志文件"
  echo -e "  ${CYAN}9${NC})  git         清理 .gitignore 忽略的未跟踪文件"
  echo -e "  ${YELLOW}d${NC})  data        清理运行时数据 ${RED}(危险)${NC}"
  echo -e "  ${CYAN}a${NC})  all         全量清理（不含运行时数据）"
  echo -e "  ${RED}0${NC})  nuke        核弹级清理 ${RED}(极度危险)${NC}"
  echo -e "  ${CYAN}q${NC})  退出"
  echo ""
  echo -e "${BOLD}当前状态:${NC}"
  echo -e "  node_modules: $(dir_size node_modules)"
  echo -e "  dist:         $(dir_size dist)"
  echo -e "  logs:         $(dir_size logs)"
  echo -e "  store:        $(dir_size store)"
  echo -e "  .nanoclaw:    $(dir_size .nanoclaw)"
  echo ""
  echo -en "选择操作 [1-9/a/d/0/q]: "
  read -r choice
  echo ""
  
  case "$choice" in
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

# ── 入口 ──────────────────────────────────────────────────

main() {
  local cmd="${1:-}"
  local arg="${2:-}"
  
  case "$cmd" in
    "")        show_menu ;;
    build)    clean_build ;;
    test)     clean_test_cache ;;
    deps)     clean_deps ;;
    skill)    clean_skill_state "$arg" ;;
    ipc)      clean_ipc ;;
    container) clean_container ;;
    env)      clean_env_sync ;;
    logs)     clean_logs ;;
    git)      clean_git_untracked ;;
    all)      do_all ;;
    data)     clean_data ;;
    nuke)     do_nuke ;;
    -h|--help|help)
      echo "用法: $0 [command] [args]"
      echo ""
      echo "命令:"
      echo "  build       清理 TypeScript 构建产物"
      echo "  test        清理测试缓存"
      echo "  deps        删除并重装 node_modules"
      echo "  skill [name] 卸载技能（留空清理全部状态）"
      echo "  ipc         清理 IPC 临时目录 (data/ipc/)"
      echo "  container   清理并重建容器镜像"
      echo "  env         同步 .env 到容器环境"
      echo "  logs        清理日志"
      echo "  git         清理 .gitignore 忽略的未跟踪文件"
      echo "  all         全量清理（不含数据）"
      echo "  data        清理运行时数据（危险）"
      echo "  nuke        核弹级全量清理"
      echo ""
      echo "无参数运行进入交互式菜单。"
      ;;
    *)
      err "未知命令: $cmd"
      echo "运行 $0 --help 查看帮助"
      exit 1
      ;;
  esac
}

main "$@"