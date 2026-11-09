#!/bin/zsh
# Start only the dedicated Harness browser. Does not install software or edit Harness settings.
set -eu
browser_root=${DSH_BROWSER_RUNTIME_DIR:-"$HOME/.dsh/browser-dom"}
if [[ "$browser_root" != /* ]]; then
  print -u2 'DSH_BROWSER_RUNTIME_DIR must be an absolute directory.'
  exit 1
fi
browser_executable='/Applications/Google Chrome.app'
if [[ ! -d "$browser_executable" ]]; then
  print -u2 'Google Chrome is not installed in /Applications.'
  exit 1
fi
browser_pid=$(/usr/sbin/lsof -nP -t -iTCP:9222 -sTCP:LISTEN 2>/dev/null | /usr/bin/head -n 1 || true)
if [[ -n "$browser_pid" ]]; then
  browser_args=$(/bin/ps -p "$browser_pid" -o command=)
  if [[ "$browser_args" == *"--user-data-dir=$browser_root/profile"* ]]; then
    print 'Harness DOM browser is already running.'
    exit 0
  fi
  print -u2 'Port 9222 belongs to another process. No browser was started or attached.'
  exit 1
fi
/bin/mkdir -p "$browser_root/profile"
/bin/chmod 700 "$browser_root" "$browser_root/profile"
/usr/bin/open -n -a "$browser_executable" --args \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  "--user-data-dir=$browser_root/profile" --no-first-run --no-default-browser-check \
  --new-window about:blank
