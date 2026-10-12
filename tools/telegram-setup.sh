#!/usr/bin/env bash
# Telegram setup for the trip finance workspace: bot secrets, deploy, webhook registration.
#
# Run this yourself. The bot token is typed into a hidden prompt (or piped) and goes straight into
# Cloudflare; the webhook secret is generated here and used for both Cloudflare and Telegram. Neither
# value is ever printed, written to the repo, or passed as a command-line argument.
#
#   bash tools/telegram-setup.sh              # secrets -> confirm deploy -> register + verify webhook
#   bash tools/telegram-setup.sh --secrets-only   # stop after the secrets
#   bash tools/telegram-setup.sh --yes        # no confirmation prompts (non-interactive)
#   bash tools/telegram-setup.sh --dry-run    # print what it would do, touch nothing
#
# Order matters: secrets -> deploy -> webhook. A webhook pointed at a Worker that lacks the secrets
# answers 401 on every delivery and Telegram backs off, so this script checks the route is live and
# carrying the secret before it registers anything.

set -euo pipefail

ORIGIN="${ORIGIN:-https://trip-finance-workspace.waiyanmt.workers.dev}"
WEBHOOK_PATH="/api/telegram/webhook"
DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"
SECRETS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --secrets-only) SECRETS_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf '✖ unknown option: %s\n' "$arg"; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { say "✖ $*"; exit 1; }

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

fingerprint() { printf '%s' "$1" | sha256sum | cut -c1-12; }

# Read a secret without echoing it: silently from the terminal, or straight from a pipe.
read_secret() {
  local label="$1" value=""
  if [ ! -t 0 ]; then
    IFS= read -r value
  else
    IFS= read -r -s -p "${label}: " value
    echo
  fi
  [ -n "$value" ] || fail "no ${label} given"
  printf '%s' "$value"
}

confirm() {
  local prompt="$1" reply=""
  if [ "$ASSUME_YES" = "1" ]; then say "${prompt} — proceeding (--yes)"; return 0; fi
  if [ ! -t 0 ]; then say "${prompt} — skipping (stdin is not a terminal; pass --yes to proceed)"; return 1; fi
  read -r -p "${prompt} [y/N] " reply || reply=""
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN — nothing is set, deployed or registered."
  say ""
  say "1. printf '<BOT_TOKEN>' | npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather"
  say "2. printf '<WEBHOOK_SECRET>' | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET"
  say "   the secret is generated here with: openssl rand -hex 32"
  say "3. npx wrangler deploy"
  say "4. curl -sS -X POST -o /dev/null -w '%{http_code}' '${ORIGIN}${WEBHOOK_PATH}'   # expect 401, not 404"
  say "5. curl -sS -X POST 'https://api.telegram.org/bot<BOT_TOKEN>/setWebhook' \\"
  say "     -H 'content-type: application/json' \\"
  say "     -d '{\"url\":\"${ORIGIN}${WEBHOOK_PATH}\",\"secret_token\":\"<WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\"],\"drop_pending_updates\":true}'"
  say "6. curl -sS 'https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo'   # expect no last_error_message"
  say "7. curl -sS -X POST 'https://api.telegram.org/bot<BOT_TOKEN>/setMyCommands' \\\\"
  say "     -H 'content-type: application/json' \\\\"
  say "     -d '{\\\"commands\\\":[{\\\"command\\\":\\\"start\\\",\\\"description\\\":\\\"Open the trip menu, or connect a trip\\\"},{\\\"command\\\":\\\"disconnect\\\",\\\"description\\\":\\\"Stop trip notifications in this chat\\\"}]}'"
  say "   the Worker publishes the same list itself on the first update after a deploy, so this step is"
  say "   only needed when the bot is set up without ever receiving an update"
  exit 0
fi

command -v npx >/dev/null 2>&1 || fail "npx not found"

say "Setting the two Worker secrets. Values are piped into wrangler, never printed."
TOKEN="$(read_secret 'Bot token from @BotFather (input hidden)')"
SECRET="$(new_secret)"
say "  bot token      sha256:$(fingerprint "$TOKEN")…"
say "  webhook secret sha256:$(fingerprint "$SECRET")…  (generated here, stored only in Cloudflare)"

printf '%s' "$TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
printf '%s' "$SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
say ""
say "Secret names on the Worker (names only — wrangler never shows values):"
npx wrangler secret list

if [ "$SECRETS_ONLY" = "1" ]; then
  say ""
  say "Stopped after the secrets (--secrets-only). The webhook must be registered with this same"
  say "generated secret, which is stored nowhere — so finish by re-running this script without"
  say "--secrets-only, or register the webhook by hand with a secret you keep."
  exit 0
fi

if ! confirm "Deploy the Worker now with 'npx wrangler deploy'?"; then
  say ""
  say "Not deploying. The feature stays dark until the deploy carries these secrets; when you deploy,"
  say "re-run this script to register the webhook."
  exit 0
fi
npx wrangler deploy

say ""
say "Checking the webhook route is live before registering it: ${ORIGIN}${WEBHOOK_PATH}"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${ORIGIN}${WEBHOOK_PATH}")"
case "$CODE" in
  401|403) say "  route live (${CODE} without the secret header) ✓" ;;
  404|405) fail "route is ${CODE} — the deploy is not live yet, so the webhook is not being registered (Telegram would back off on a dead URL)" ;;
  *)       say "  note: route answered ${CODE}; continuing" ;;
esac

say ""
say "Registering the webhook"
BODY="$(python3 - "$ORIGIN" "$WEBHOOK_PATH" "$SECRET" <<'PY'
import json, sys
origin, path, secret = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
    "url": origin + path,
    "secret_token": secret,
    "allowed_updates": ["message"],
    "drop_pending_updates": True,
}))
PY
)"
RESULT="$(curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  --data-binary "@-" <<<"$BODY")"
python3 - "$RESULT" <<'PY' || fail "setWebhook rejected the registration: $(printf '%s' "$RESULT" | head -c 200)"
import json, sys
sys.exit(0 if json.loads(sys.argv[1]).get("ok") else 1)
PY
say "✓ webhook registered"

say ""
say "Registering the bot command menu"
COMMANDS="$(python3 - <<'PY'
import json
print(json.dumps({"commands": [
    {"command": "start", "description": "Open the trip menu, or connect a trip"},
    {"command": "disconnect", "description": "Stop trip notifications in this chat"},
]}, ensure_ascii=False))
PY
)"
RESULT="$(curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/setMyCommands" \
  -H 'content-type: application/json' \
  --data-binary "$COMMANDS")"
python3 - "$RESULT" <<'PY' || fail "setMyCommands rejected the menu: $(printf '%s' "$RESULT" | head -c 200)"
import json, sys
sys.exit(0 if json.loads(sys.argv[1]).get("ok") else 1)
PY
LIST="$(curl -sS "https://api.telegram.org/bot${TOKEN}/getMyCommands")"
python3 - "$LIST" <<'PY'
import json, sys
commands = json.loads(sys.argv[1]).get("result", [])
print("  registered     : %s" % ", ".join("/" + c.get("command", "") for c in commands))
PY

ME="$(curl -sS "https://api.telegram.org/bot${TOKEN}/getMe")"
INFO="$(curl -sS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo")"
python3 - "$ME" "$INFO" <<'PY'
import json, sys
me = json.loads(sys.argv[1]).get("result", {})
info = json.loads(sys.argv[2]).get("result", {})
print("  bot            : @%s (%s)" % (me.get("username"), me.get("first_name")))
print("  webhook url    : %s" % info.get("url"))
print("  pending updates: %s" % info.get("pending_update_count"))
print("  last error     : %s" % (info.get("last_error_message") or "none"))
print("  allowed updates: %s" % ",".join(info.get("allowed_updates") or []))
PY

say ""
say "Done. Open a workspace -> Setup -> Telegram notifications -> Connect Telegram chat."
say "Disable later with: curl -sS -X POST 'https://api.telegram.org/bot<TOKEN>/deleteWebhook'"
