import { describe, expect, it } from 'vitest';
import { buildStructuredAssetCatalog } from '../tools/build-structured-asset-catalog.mjs';

const feed = {
  manifest_version: 'test',
  content_version: 'test-content',
  appearances: [{ asset_id: 'ast_a' }, { asset_id: 'ast_a' }],
  canonical_assets: [
    { asset_id: 'ast_a', name: '椅子', status: 'ready', labels: { category: '单椅', sub: '办公椅', colors: ['米白'], materials: ['木材'], styles: ['卡通风'] }, media: {}, source: {}, record_source: 'fixture' },
    { asset_id: 'ast_b', name: '沙发', status: 'ready', labels: { category: '沙发', sub: '三人沙发', colors: [], materials: [], styles: [] }, media: {}, source: {}, record_source: 'fixture' },
  ],
};

describe('structured asset catalog', () => {
  it('keeps canonical identity while counting appearances', () => {
    const catalog = buildStructuredAssetCatalog(feed, { results: [] }, []);
    expect(catalog.assets).toHaveLength(2);
    expect(catalog.assets[0].asset_id).toBe('ast_a');
    expect(catalog.assets[0].appearance_count).toBe(2);
  });

  it('preserves raw tags and exposes normalized facets separately', () => {
    const catalog = buildStructuredAssetCatalog(feed, { results: [] }, []);
    expect(catalog.assets[0].tags.raw).toMatchObject({ colors: ['米白'], materials: ['木材'], styles: ['卡通风'] });
    expect(catalog.assets[0].tags.normalized).toMatchObject({ colors: ['米白色'], materials: ['木质'], styles: ['卡通'] });
  });

  it('does not misrepresent asset QA as human tag review', () => {
    const reviews = { results: [{ asset_id: 'ast_a', verdict: 'pass', reviewed_at: '2026-08-09T00:00:00Z' }] };
    const catalog = buildStructuredAssetCatalog(feed, reviews, []);
    expect(catalog.assets[0].asset_quality_review.verdict).toBe('pass');
    expect(catalog.assets[0].tags.provenance.human_review_status).toBe('unreviewed');
    expect(catalog.tag_review_queue.map((item) => item.asset_id)).toEqual(['ast_b']);
  });

  it('carries explicit tag-review provenance independently', () => {
    const reviewedFeed = structuredClone(feed);
    reviewedFeed.canonical_assets[0].tag_provenance = {
      source: 'manual_visual_review', human_review_status: 'reviewed', reviewed_at: '2026-08-09',
    };
    const catalog = buildStructuredAssetCatalog(reviewedFeed, { results: [] }, []);
    expect(catalog.assets[0].tags.provenance).toMatchObject({
      source: 'manual_visual_review', human_review_status: 'reviewed', reviewed_at: '2026-08-09',
    });
  });
});
