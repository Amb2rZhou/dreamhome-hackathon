#!/usr/bin/env bash
set -euo pipefail

LINEAGE="${RENEWED_LINEAGE:?RENEWED_LINEAGE is required}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
CERT_PUB="$(<"$LINEAGE/fullchain.pem")"
CERT_KEY="$(<"$LINEAGE/privkey.pem")"

for DOMAIN in www.dreamhouse.top dreamhouse.top; do
  SAFE_DOMAIN="${DOMAIN//./-}"
  aliyun cdn SetCdnDomainSSLCertificate \
    --DomainName "$DOMAIN" \
    --SSLProtocol on \
    --CertType upload \
    --CertName "$SAFE_DOMAIN-letsencrypt-$STAMP" \
    --SSLPub "$CERT_PUB" \
    --SSLPri "$CERT_KEY" >/dev/null
done

unset CERT_PUB CERT_KEY
