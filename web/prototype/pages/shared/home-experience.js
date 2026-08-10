export const RECOMMENDATION_THINKING_MESSAGES = [
  '包工球正在认真研究你的小屋 🏠',
  '包工球正在观察房间里的蛛丝马迹 🔍',
  '包工球的小脑壳正在火速转动 💥',
  '正在家具库里努力扒拉好东西 🪑',
];

const textIncludesAny = (text, values) => values.some((value) => text.includes(value));

export function buildRecommendationRequest({ project, selectedAssetId = null, favorites = [], displayedIds = [], input = '' }) {
  const placements = Array.isArray(project?.placements) ? project.placements : [];
  const room = (project?.rooms || []).find((item) => item.id === project?.selectedRoomId) || project?.rooms?.[0] || null;
  return {
    roomType: room?.type || room?.name || (project?.realScene ? '真实房间' : '全屋'),
    placedFurniture: placements.map((placement) => ({
      id: placement.assetId,
      category: placement.asset?.category || null,
      styles: placement.asset?.styles || [],
      colors: placement.asset?.colors || [],
      materials: placement.asset?.materials || [],
    })),
    selectedAssetId,
    favorites: [...favorites],
    displayedIds: [...displayedIds],
    input: String(input || '').trim(),
  };
}

export function recommendFromCatalog(request, catalog) {
  const input = request.input.trim();
  if (!input) return { state: 'idle', products: [] };
  const targetUnclear = textIncludesAny(input, ['更暖一点', '换个暖一点', '再暖一点']) && !request.selectedAssetId;
  if (targetUnclear) return { state: 'clarifying', question: '你想把哪一件家具换得更暖一些？请先点选家具，或告诉我是椅子、桌子还是柜子。', products: [] };

  const wantsChair = textIncludesAny(input, ['椅', '座椅']);
  const wantsWhite = textIncludesAny(input, ['白色', '白的', '米白']);
  const wantsModern = textIncludesAny(input, ['现代', '简约', '极简']);
  const ranked = catalog
    .filter((asset) => asset?.kind === 'furniture' && !request.displayedIds.includes(asset.id))
    .map((asset) => {
      const haystack = [asset.name, asset.category, asset.subcategory, ...(asset.styles || []), ...(asset.colors || []), ...(asset.materials || [])].join('');
      let score = 0;
      if (wantsChair && (asset.category === '单椅' || haystack.includes('椅'))) score += 8;
      if (wantsWhite && (asset.colors || []).some((color) => color.includes('白'))) score += 5;
      if (wantsModern && (asset.styles || []).includes('现代')) score += 4;
      if (input.includes('书房') && haystack.includes('办公')) score += 5;
      for (const token of input.split(/[\s，。！？、]+/).filter((token) => token.length >= 2)) if (haystack.includes(token)) score += 1;
      return { asset, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name, 'zh'));
  if (!ranked.length) return { state: 'empty', products: [] };
  return { state: 'success', products: ranked.slice(0, 3).map((item) => item.asset) };
}

export function findCollectedHome(homes, currentUserId, sourceHomeId) {
  return (homes || []).find((home) => home?.ownerId === currentUserId && home?.sourceHomeId === sourceHomeId) || null;
}

export function createCollectedHome({ sourceHome, currentUserId, sourceShareId = null, originalOwnerId = null, createId, createdAt }) {
  if (!sourceHome?.id || !currentUserId) throw new Error('收藏小屋缺少来源或当前用户');
  const snapshot = JSON.stringify(sourceHome);
  const copy = JSON.parse(snapshot);
  copy.id = createId('home');
  copy.ownerId = currentUserId;
  copy.sourceHomeId = sourceHome.id;
  copy.sourceShareId = sourceShareId || sourceHome.sourceShareId || null;
  copy.originalOwnerId = originalOwnerId || sourceHome.ownerId || sourceHome.originalOwnerId || null;
  copy.readOnly = true;
  copy.name = `${String(sourceHome.name || '同款小屋').replace(/^同款\s*[·・]?\s*/, '')} · 我的收藏`;
  copy.source = { type: 'collected_home', sourceHomeId: sourceHome.id, sourceShareId: copy.sourceShareId, originalOwnerId: copy.originalOwnerId, originalSource: JSON.parse(JSON.stringify(sourceHome.source || null)) };
  copy.placements = (copy.placements || []).map((placement) => ({ ...placement, id: createId('placement'), homeId: copy.id }));
  copy.createdAt = createdAt;
  copy.updatedAt = createdAt;
  delete copy.revision;
  if (JSON.stringify(sourceHome) !== snapshot) throw new Error('好友原空间被意外修改');
  return copy;
}
