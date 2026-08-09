# DreamHome API-only backend plan

## Contest deployment

- `dreamhouse.top`: static Feed and product pages on Hong Kong OSS/CDN.
- `api.dreamhouse.top`: small Hong Kong CPU instance running DreamHome FastAPI.
- FAL TRELLIS: image-to-3D through `backend/app/providers/fal.py` only.
- Model Studio: Wan completion plus Qwen detection, labels and quality gates.
- Local CPU: rembg, GLB material post-processing and job orchestration.
- SQLite and job files: persistent disk for the contest; migrate to Postgres/object storage before horizontal scaling.

The production web bundle calls `https://api.dreamhouse.top` directly. Local
Vite development and preview keep using the same-origin `/dreamhome-api` proxy.
The API host must allow the `dreamhouse.top` origins and serve `/storage/*`
through the same FastAPI process so persisted image-post bindings and their GLBs
remain portable together.

## Hong Kong host layout

- Code: `/opt/dreamhome/backend`
- Python environment: `/opt/dreamhome/.venv`
- Persistent database: `/opt/dreamhome/data/dreamhome.db`
- Persistent media and image-post state: `/opt/dreamhome/data/storage`
- Secrets: `/etc/dreamhome/backend.env` (never copied into Git or OSS)
- Services: `dreamhome-segment.service`, then `dreamhome-api-hk.service`
- Reverse proxy: `backend/deploy/api.dreamhouse.top.nginx.conf`

Before replacing a running deployment, snapshot `/opt/dreamhome/data` and the
existing service files. Copy SQLite together with its WAL/SHM files while the
API service is stopped, then restart both services and verify `/api/health`,
`/openapi.json`, the image-post binding count, and at least one GLB byte-range
request before changing DNS.

The former A10 services (`Grounding DINO`, `CLIP`, `SAM2`, `TRELLIS`) are not
runtime dependencies of `dreamhome-api-hk.service`.  Existing reviewed video
tracks remain precomputed data.  New video tracking is an offline import job,
not an API call during Feed playback.

## Cost controls

1. Never expose provider keys to the browser.  Configure `FAL_KEY` and
   `DASHSCOPE_API_KEY` only in `/etc/dreamhome/backend.env` or a secret manager.
   Configure `IMAGE_POST_IMPORT_TOKEN` there as well; the Hong Kong service
   fails closed for image-post imports when that token is absent.
2. Keep `JOB_MAX_CONCURRENCY=2` and a bounded queue on the contest CPU server.
3. Reuse content-hash caches before paid completion, labels or generation.
4. Generate 3D only after an explicit furniture selection; image-post import
   alone never triggers paid generation.
5. Run at most one strengthened completion retry.  Do not automatically repeat
   a successful FAL submission.
6. Store reviewed tracks and tags so Feed playback makes no model calls.
7. Configure provider-side spend alerts and a daily application quota before
   public launch.

## Image-post contract

`POST /api/image-posts/import` accepts 1-20 ordered JPG/PNG/WebP slides and
stores an immutable-source manifest.  It does not create canonical assets.
Furniture extraction will be added as a separate quality-gated selection
operation; static posts must not be sent through the video pipeline.
