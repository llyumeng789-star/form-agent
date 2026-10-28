#!/bin/zsh
# 常驻 Chrome（远程调试模式）。用 Bash 工具的 run_in_background 启动，
# 不要用 `nohup ... &` —— 那种进程会随命令结束被回收。
# 浏览器常驻后，各步骤脚本通过 CDP 连上来干活，做完就退，无需长驻 node 进程。
#
# 三种模式：
#   ./browser_daemon.sh           隔离 profile（/tmp/jobhunt/chrome-profile），安全，默认用这个
#   ./browser_daemon.sh --copy    ⛔ 已永久禁用 —— 见下方「为什么 --copy 被禁用」
#   ./browser_daemon.sh --real    ⚠️ 已废弃：新版 Chrome 禁止在默认数据目录开调试端口
#
# 为什么 --copy 被禁用（2026-09-08 事故，血的教训）：
#   --copy 把日常 profile 的 Cookies 复制到副本目录供调试用。这会让**同一份登录凭证
#   同时活跃在两个 Chrome 实例里**（用户的日常 Chrome + 本 daemon）。Google 检测到后
#   判定为凭证泄露，直接撤销会话 —— 结果是把用户的 Chrome 账号踢下线了。
#   同时两个实例一起跑还会互相干扰，最终两个都被迫退出，用户开着的所有标签页一并没了。
#
#   结论：**永远不要复制用户的登录凭证。** 需要登录态时，用隔离 profile 手动登录目标
#   网站（只有那一个网站需要登录，代价就是每次登录一次），不要动用户的 Chrome。

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9222

case "$1" in
  --real)
    echo "ERROR: --real 不可用 —— 新版 Chrome 禁止在默认数据目录开远程调试端口" >&2
    exit 8
    ;;
  --copy)
    echo "ERROR: --copy 已永久禁用（会把用户 Chrome 踢下线，2026-09-08 事故）。" >&2
    echo "       改用不带参数的隔离 profile，然后手动登录目标网站。" >&2
    exit 7
    ;;
  *)
    PROFILE="/tmp/jobhunt/chrome-profile"
    ;;
esac

# profile 被占用时直接失败并说明原因，而不是静默起一个无效实例
if [ -e "$PROFILE/SingletonSocket" ] || [ -e "$PROFILE/SingletonLock" ]; then
  echo "ERROR: profile in use ($PROFILE) — 日常 Chrome 还开着，先完全退出再运行本脚本" >&2
  exit 9
fi

exec "$CHROME" \
  --remote-debugging-port=$PORT \
  --user-data-dir="$PROFILE" \
  --no-sandbox \
  --disable-setuid-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-blink-features=AutomationControlled \
  --restore-last-session \
  about:blank
