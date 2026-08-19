#!/bin/bash
# 检测经 Cloudflare 访问站点是否被重定向劫持。
# 同时探源站,用于区分「CF 层被改」和「源站挂了」。
# 状态变化时写 /var/log/lingxia-monitor.log 与 syslog；持续异常每小时复报一次。

URL="https://xingx.shop/api/health"
LOG=/var/log/lingxia-monitor.log
STATE=/var/lib/lingxia-monitor.state
mkdir -p "$(dirname "$STATE")"

EDGE="$(curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{redirect_url}' "$URL" 2>/dev/null)"
CODE="${EDGE%% *}"
REDIR="${EDGE#* }"
ORIGIN="$(curl -sS -k -o /dev/null --max-time 10 --resolve xingx.shop:443:127.0.0.1 -w '%{http_code}' "$URL" 2>/dev/null)"
NOW="$(date '+%F %T %z')"
EPOCH="$(date +%s)"

if [ "$CODE" = "200" ] && [ -z "$REDIR" ]; then
  STATUS=OK
  DETAIL="edge=200 origin=$ORIGIN"
else
  STATUS=ALERT
  DETAIL="edge=$CODE redirect=${REDIR:-none} origin=$ORIGIN"
fi

PREV="$(cut -d' ' -f1 "$STATE" 2>/dev/null)"
PREV_TS="$(cut -d' ' -f2 "$STATE" 2>/dev/null)"

log() {
  echo "$NOW [$1] $2" >> "$LOG"
  logger -t lingxia-monitor "$1 $2"
}

if [ "$STATUS" != "$PREV" ]; then
  if [ "$STATUS" = ALERT ]; then
    if [ "$ORIGIN" = "200" ]; then
      log ALERT "经 Cloudflare 访问异常但源站正常,疑似 CF 层重定向劫持 -- $DETAIL"
    else
      log ALERT "站点不可用 -- $DETAIL"
    fi
  else
    log RECOVERED "站点恢复正常 -- $DETAIL"
  fi
  echo "$STATUS $EPOCH" > "$STATE"
elif [ "$STATUS" = ALERT ] && [ $((EPOCH - ${PREV_TS:-0})) -ge 3600 ]; then
  log ALERT "持续异常 -- $DETAIL"
  echo "$STATUS $EPOCH" > "$STATE"
fi

[ "$STATUS" = OK ]
