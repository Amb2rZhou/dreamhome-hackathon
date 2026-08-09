# DreamHouse Alibaba Cloud delivery

Production entry points:

- `https://dreamhouse.top/`
- `https://www.dreamhouse.top/`

Both domains currently resolve directly to the Hong Kong ECS instance. Nginx
serves the static build from `/srv/dreamhouse-web`; the API remains isolated on
`api.dreamhouse.top` on the same instance.

The Alibaba Cloud overseas CDN and private Hong Kong OSS origin are retained as
a warm rollback path, but they are not the active DNS target. On 2026-08-09 the
overseas-only CDN route timed out for both a mainland mobile connection and the
project owner's US VPN, while the ECS origin remained reachable. Do not point
the apex or `www` records back to the CDN CNAME without testing those user
routes first.

## Cache policy

- HTML: `no-cache` so a release is visible without a stale shell.
- Versioned JS, CSS, media, fonts, ONNX, WASM, and GLB: one year.
- MP4 and GLB requests support HTTP Range responses from Nginx.
- HTTP redirects to HTTPS; HTTPS uses HTTP/2 and TLS 1.2 or newer.

The checked-in virtual host baseline is `nginx-dreamhouse-web.conf`. Certbot
adds the managed TLS blocks on the server after the file is installed.

## Certificate renewal

The active ECS certificate is managed by the server's Certbot timer and covers
both `dreamhouse.top` and `www.dreamhouse.top`. Certificate state and private
keys stay on the server under `/etc/letsencrypt`.

The DNS-01 scripts below are retained only for the CDN rollback path. They
create and remove AliDNS TXT records automatically; their local certificate
state lives outside this repository in `~/.config/dreamhouse-letsencrypt`.

Run:

```bash
./infra/aliyun/renew-certificate.sh
```

The deploy hook uploads the renewed certificate to both CDN domains. Alibaba
Cloud CLI authentication and AliDNS/CDN permissions must already be available
in the local profile.
