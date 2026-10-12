#!/usr/bin/env bash
# Telegram setup for the trip finance workspace: bot secrets + webhook registration.
#
# Run this yourself — the bot token is piped straight into Cloudflare and never lands in the repo,
# a log, or an agent transcript. The webhook secret is generated here, used for both Cloudflare and
# Telegram, and never printed.
#
#   bash tools/telegram-setup.sh            # set both secrets, then register + verify the webhook
#   DRY_RUN=1 bash tools/telegram-setup.sh  # print exactly what it would do, touch nothing
#
# Order matters: secrets first, then `npx wrangler deploy`, then connect a chat from
# Setup -> Telegram notifications -> Connect Telegram chat.

set -euo pipefail

ORIGIN="${ORIGIN:-https://trip-finance-workspace.waiyanmt.workers.dev}"
WEBHOOK_PATH="/api/telegram/webhook"
DRY_RUN="${DRY_RUN:-0}"

say() { printf '%s\n' "$*"; }
fail() { say "✖ $*"; exit 1; }

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

# Read a secret without ever echoing it: silently from the terminal, or straight from a pipe.
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

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN — nothing is set and nothing is registered."
  say ""
  say "1. printf '<BOT_TOKEN>' | npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather"
  say "2. printf '<WEBHOOK_SECRET>' | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET"
  say "   the secret is generated with: openssl rand -hex 32"
  say "3. curl -sS -X POST 'https://api.telegram.org/bot<BOT_TOKEN>/setWebhook' \\"
  say "     -H 'content-type: application/json' \\"
  say "     -d '{\"url\":\"${ORIGIN}${WEBHOOK_PATH}\",\"secret_token\":\"<WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\"],\"drop_pending_updates\":true}'"
  say "4. curl -sS 'https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo'   # expect no last_error_message"
  say "5. npx wrangler secret list                                           # expect both names, no values"
  exit 0
fi

command -v npx >/dev/null 2>&1 || fail "npx not found"
say "Setting the two Worker secrets (values are never printed)."
TOKEN="$(read_secret 'Bot token from @BotFather (input hidden)')"
SECRET="$(new_secret)"

printf '%s' "$TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
printf '%s' "$SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
say ""
say "Secret names now on the Worker (names only, values are never shown):"
npx wrangler secret list

say ""
say "Registering the webhook at ${ORIGIN}${WEBHOOK_PATH}"
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
python3 - "$RESULT" <<'PY' || fail "setWebhook failed: $(printf '%s' "$RESULT" | head -c 200)"
import json, sys
r = json.loads(sys.argv[1])
sys.exit(0 if r.get("ok") else 1)
PY
say "✓ webhook registered"

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
say "Done. Next: npx wrangler deploy — the routes only exist once the Worker carries these secrets."
say "Then open a workspace -> Setup -> Telegram notifications -> Connect Telegram chat."
