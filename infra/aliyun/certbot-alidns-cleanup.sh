#!/usr/bin/env bash
set -euo pipefail

RECORD_ID="${CERTBOT_AUTH_OUTPUT:-}"
if [[ -n "$RECORD_ID" ]]; then
  aliyun alidns DeleteDomainRecord --RecordId "$RECORD_ID" >/dev/null
fi
