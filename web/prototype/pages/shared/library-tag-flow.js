export const MAX_ASSEMBLY_ASSETS = 12;

const clean = (value) => String(value ?? '').trim();

export function styleFacets(assets) {
  const counts = new Map();
  for (const asset of assets || []) {
    if (asset?.kind !== 'furniture') continue;
    for (const style of new Set((asset.styles || []).map(clean).filter(Boolean))) {
      counts.set(style, (counts.get(style) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([value, count]) => ({ value, count }));
}

export function filterFurnitureByTags(assets, filters = {}) {
  const color = clean(filters.color);
  const material = clean(filters.material);
  const style = clean(filters.style);
  return (assets || []).filter((asset) => (
    asset?.kind === 'furniture'
    && (!color || asset.colors?.includes(color))
    && (!material || asset.materials?.includes(material))
    && (!style || asset.styles?.includes(style))
  ));
}

export function encodeAssemblyAssetIds(ids) {
  return [...new Set((ids || []).map(clean).filter(Boolean))].slice(0, MAX_ASSEMBLY_ASSETS).join(',');
}

export function decodeAssemblyAssetIds(value) {
  return encodeAssemblyAssetIds(String(value ?? '').split(',')).split(',').filter(Boolean);
}
