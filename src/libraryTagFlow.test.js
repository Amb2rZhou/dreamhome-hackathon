import { describe, expect, it } from 'vitest';
import {
  MAX_ASSEMBLY_ASSETS,
  decodeAssemblyAssetIds,
  encodeAssemblyAssetIds,
  filterFurnitureByTags,
  styleFacets,
} from '../web/prototype/pages/shared/library-tag-flow.js';

const assets = [
  { id: 'a', kind: 'furniture', styles: ['现代', '北欧'], colors: ['米色'], materials: ['木质'] },
  { id: 'b', kind: 'furniture', styles: ['现代'], colors: ['黑色'], materials: ['金属'] },
  { id: 'c', kind: 'floorplan', styles: ['现代'], colors: ['米色'], materials: ['木质'] },
];

describe('inspiration library tag flow', () => {
  it('orders style facets by real furniture count', () => {
    expect(styleFacets(assets)).toEqual([
      { value: '现代', count: 2 },
      { value: '北欧', count: 1 },
    ]);
  });

  it('combines style, color, and material filters without accepting non-furniture', () => {
    expect(filterFurnitureByTags(assets, { style: '现代', color: '米色', material: '木质' }).map((item) => item.id)).toEqual(['a']);
  });

  it('keeps canonical ids unique and bounds the assembly handoff', () => {
    const ids = Array.from({ length: MAX_ASSEMBLY_ASSETS + 3 }, (_, index) => `ast_${index}`);
    const encoded = encodeAssemblyAssetIds([ids[0], ids[0], ...ids]);
    expect(decodeAssemblyAssetIds(encoded)).toEqual(ids.slice(0, MAX_ASSEMBLY_ASSETS));
  });
});
