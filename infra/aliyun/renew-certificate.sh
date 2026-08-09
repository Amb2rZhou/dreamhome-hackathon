#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${DREAMHOUSE_CERTBOT_CONFIG_DIR:-$HOME/.config/dreamhouse-letsencrypt}"

certbot renew \
  --config-dir "$CONFIG_DIR" \
  --work-dir "$CONFIG_DIR/work" \
  --logs-dir "$CONFIG_DIR/logs" \
  --deploy-hook "$SCRIPT_DIR/certbot-deploy-cdn.sh"
