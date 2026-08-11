import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildFrontendAssetRecords } from '../tools/sync-frontend-asset-catalog.mjs';
import { BACKEND_ASSETS } from '../web/prototype/pages/shared/library-assets.generated.js';

const feed = JSON.parse(readFileSync(resolve(process.cwd(), 'backend/storage/feed/feed-manifest.v1.json')));
const catalog = JSON.parse(readFileSync(resolve(process.cwd(), 'backend/storage/catalog/structured-assets.v1.json')));

describe('frontend asset catalog', () => {
  const records = buildFrontendAssetRecords(feed, catalog);

  it('contains every canonical asset exactly once', () => {
    expect(records).toHaveLength(233);
    expect(new Set(records.map((asset) => asset.asset_id)).size).toBe(233);
  });

  it('ships the union of published and production-ready assets to the browser', () => {
    expect(BACKEND_ASSETS).toHaveLength(233);
    expect(new Set(BACKEND_ASSETS.map((asset) => asset.asset_id)).size).toBe(233);
  });

  it('keeps filter tags complete without inventing physical dimensions', () => {
    expect(records.every((asset) => asset.labels.styles.length && asset.labels.materials.length && asset.labels.colors.length)).toBe(true);
    expect(records.filter((asset) => asset.size_status === 'known')).toHaveLength(7);
    expect(records.filter((asset) => asset.size_status !== 'known').every((asset) => !asset.physical_size_m?.width)).toBe(true);
  });
});
