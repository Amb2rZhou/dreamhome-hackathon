import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKEND_ASSETS } from '../web/prototype/pages/shared/library-assets.generated.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED_PATH = resolve(ROOT, 'backend/storage/feed/feed-manifest.v1.json');
const REVIEW_PATH = resolve(ROOT, 'backend/storage/qc/asset-review-results.json');
const OUTPUT_PATH = resolve(ROOT, 'backend/storage/catalog/structured-assets.v1.json');

const STYLE_ALIASES = { '卡通风': '卡通' };
const COLOR_ALIASES = { '米白': '米白色', '浅灰': '浅灰色', '浅蓝': '浅蓝色' };
const MATERIAL_ALIASES = { '木材': '木质' };

const cleanList = (values) => [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
const normalizeList = (values, aliases) => cleanList(values).map((value) => aliases[value] || value);
const countValues = (assets, key) => {
  const counts = new Map();
  for (const asset of assets) for (const value of asset.tags.normalized[key]) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([value, count]) => ({ value, count }));
};

export function buildStructuredAssetCatalog(feed, reviews, detailedAssets = BACKEND_ASSETS) {
  const detailById = new Map(detailedAssets.map((asset) => [asset.asset_id, asset]));
  const reviewById = new Map((reviews.results || []).map((review) => [review.asset_id, review]));
  const appearanceCount = new Map();
  for (const appearance of feed.appearances || []) appearanceCount.set(appearance.asset_id, (appearanceCount.get(appearance.asset_id) || 0) + 1);

  const assets = (feed.canonical_assets || []).filter((asset) => asset.status === 'ready').map((asset) => {
    const labels = asset.labels || {};
    const raw = {
      colors: cleanList(labels.colors),
      materials: cleanList(labels.materials),
      styles: cleanList(labels.styles),
      features: cleanList(labels.features),
    };
    const missing = ['colors', 'materials', 'styles'].filter((key) => raw[key].length === 0);
    const detail = detailById.get(asset.asset_id);
    const review = reviewById.get(asset.asset_id);
    const tagProvenance = asset.tag_provenance || {};
    return {
      asset_id: asset.asset_id,
      name: asset.name,
      status: asset.status,
      classification: {
        category: labels.category || '',
        subcategory: labels.sub || labels.subcategory || '',
      },
      tags: {
        raw,
        normalized: {
          colors: normalizeList(raw.colors, COLOR_ALIASES),
          materials: normalizeList(raw.materials, MATERIAL_ALIASES),
          styles: normalizeList(raw.styles, STYLE_ALIASES),
          features: raw.features,
        },
        completeness: missing.length ? 'needs_review' : 'complete',
        missing_fields: missing,
        provenance: {
          source: tagProvenance.source || 'imported_structured_labels',
          confidence: tagProvenance.confidence ?? null,
          human_review_status: tagProvenance.human_review_status || 'unreviewed',
          reviewed_at: tagProvenance.reviewed_at || null,
          record_source: /dreamhome\.db$/.test(asset.record_source || '') ? 'runtime_database' : asset.record_source || '',
        },
      },
      dimensions: detail ? {
        status: detail.size_status || 'unknown',
        physical_m: detail.physical_size_m || null,
        model_unit: detail.dimensions_model_unit || null,
      } : { status: 'unknown', physical_m: null, model_unit: null },
      media: asset.media || {},
      source: asset.source || {},
      appearance_count: appearanceCount.get(asset.asset_id) || 0,
      asset_quality_review: review ? {
        scope: 'asset_quality_not_tag_accuracy',
        verdict: review.verdict,
        reason: review.reason || '',
        reviewed_at: review.reviewed_at || null,
      } : {
        scope: 'asset_quality_not_tag_accuracy',
        verdict: 'unreviewed',
        reason: '',
        reviewed_at: null,
      },
    };
  });

  const tagReviewQueue = assets.filter((asset) => asset.tags.completeness === 'needs_review').map((asset) => ({
    asset_id: asset.asset_id,
    name: asset.name,
    category: asset.classification.category,
    missing_fields: asset.tags.missing_fields,
    thumbnail: asset.media.thumbnail || '',
    context: asset.media.context || '',
    source_type: asset.source.source_type || '',
  }));

  return {
    schema_version: 1,
    catalog_version: feed.content_version || feed.manifest_version || 'unknown',
    source_manifest_version: feed.manifest_version || '',
    contract: {
      identity: 'asset_id is canonical; appearances reference it and never clone the asset',
      tag_review: 'human_review_status describes tag review only; asset_quality_review is a separate scope',
      confidence: 'null means the historical source did not preserve a calibrated score',
    },
    summary: {
      canonical_assets: assets.length,
      ready_assets: assets.filter((asset) => asset.status === 'ready').length,
      tag_complete_assets: assets.filter((asset) => asset.tags.completeness === 'complete').length,
      tag_review_queue: tagReviewQueue.length,
      tag_human_reviewed: assets.filter((asset) => asset.tags.provenance.human_review_status === 'reviewed').length,
      known_physical_size: assets.filter((asset) => asset.dimensions.status === 'known').length,
    },
    taxonomy: {
      categories: buildCategoryCounts(assets),
      styles: countValues(assets, 'styles'),
      colors: countValues(assets, 'colors'),
      materials: countValues(assets, 'materials'),
      aliases: { styles: STYLE_ALIASES, colors: COLOR_ALIASES, materials: MATERIAL_ALIASES },
    },
    tag_review_queue: tagReviewQueue,
    assets,
  };
}

function buildCategoryCounts(assets) {
  const counts = new Map();
  for (const asset of assets) {
    const value = asset.classification.category;
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([value, count]) => ({ value, count }));
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback; };
  const feedPath = option('--feed', FEED_PATH);
  const reviewPath = option('--reviews', REVIEW_PATH);
  const outputPath = option('--output', OUTPUT_PATH);
  const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
  const reviews = JSON.parse(readFileSync(reviewPath, 'utf8'));
  const catalog = buildStructuredAssetCatalog(feed, reviews);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, summary: catalog.summary }, null, 2));
}
