#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecommendationHandler } from './backend/app/recommendations.mjs';

try { process.loadEnvFile?.('.env'); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }

const port = Number(process.argv[2] || 5182);
const root = resolve(process.argv[3] || 'web');
const host = '127.0.0.1';
const handleRecommendation = await createRecommendationHandler();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

function send(res, status, body = '') {
  res.writeHead(status, {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', `http://${host}`).pathname);
    if (await handleRecommendation(req, res, pathname)) return;
    let filePath = resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return send(res, 403, 'Forbidden');

    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
      info = await stat(filePath);
    }
    if (!info.isFile()) return send(res, 404, 'Not found');

    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Expires: '0',
      Pragma: 'no-cache',
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    };
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
        res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...commonHeaders,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
      });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(filePath, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...commonHeaders, 'Content-Length': info.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, error?.code === 'ENOENT' ? 404 : 500, error?.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log(`Serving '${root}/' at http://${host}:${port}/ (no-cache)`);
});
