#!/usr/bin/env bash
set -euo pipefail

ZONE="dreamhouse.top"
DOMAIN="${CERTBOT_DOMAIN:?CERTBOT_DOMAIN is required}"
VALIDATION="${CERTBOT_VALIDATION:?CERTBOT_VALIDATION is required}"

if [[ "$DOMAIN" == "$ZONE" ]]; then
  RR="_acme-challenge"
elif [[ "$DOMAIN" == *".$ZONE" ]]; then
  HOST="${DOMAIN%.$ZONE}"
  RR="_acme-challenge.$HOST"
else
  echo "Unsupported certificate domain: $DOMAIN" >&2
  exit 1
fi

RECORD_ID="$(aliyun alidns AddDomainRecord \
  --DomainName "$ZONE" \
  --RR "$RR" \
  --Type TXT \
  --Value "$VALIDATION" | jq -r '.RecordId')"

if [[ -z "$RECORD_ID" || "$RECORD_ID" == "null" ]]; then
  echo "Failed to create ACME TXT record" >&2
  exit 1
fi

FQDN="$RR.$ZONE"
for _ in {1..30}; do
  if dig +short TXT "$FQDN" @dns13.hichina.com | tr -d '"' | grep -Fxq "$VALIDATION"; then
    echo "$RECORD_ID"
    exit 0
  fi
  sleep 2
done

echo "ACME TXT record did not propagate: $FQDN" >&2
exit 1
