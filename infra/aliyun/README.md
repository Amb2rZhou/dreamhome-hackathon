# DreamHouse Alibaba Cloud delivery

Production entry points:

- `https://dreamhouse.top/`
- `https://www.dreamhouse.top/`

Both domains use Alibaba Cloud CDN with a private Hong Kong OSS origin. CDN is
granted read-only OSS access through `AliyunCDNAccessingPrivateOSSRole`; the
bucket itself must remain private.

## Cache policy

- HTML and JSON: one-second CDN TTL while preserving origin no-cache headers.
- Versioned JS, CSS, media, fonts, ONNX, WASM, and GLB: one year.
- MP4 and GLB requests support HTTP Range origin fetch.
- HTTP redirects to HTTPS; HTTPS uses HTTP/2 and TLS 1.2 or newer.

## Certificate renewal

The certificate is issued with Certbot DNS-01 hooks that create and remove
AliDNS TXT records automatically. Certificate state and private keys live
outside this repository in `~/.config/dreamhouse-letsencrypt`.

Run:

```bash
./infra/aliyun/renew-certificate.sh
```

The deploy hook uploads the renewed certificate to both CDN domains. Alibaba
Cloud CLI authentication and AliDNS/CDN permissions must already be available
in the local profile.
