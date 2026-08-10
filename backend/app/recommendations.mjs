import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_CATALOG_PATH = resolve('web/prototype/data/aug11-catalog.json');
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

const ROOM_CATEGORIES = {
  living: ['沙发', '单椅', '茶几', '边几', '电视柜', '灯具', '绿植', '装饰'],
  bedroom: ['床', '床头柜', '衣柜', '灯具', '地毯', '装饰'],
  dining: ['餐桌', '餐椅', '椅', '灯具', '餐边柜', '绿植'],
  study: ['书桌', '办公椅', '单椅', '书柜', '灯具', '收纳'],
  balcony: ['户外', '单椅', '边几', '绿植', '灯具'],
};

const ROOM_ALIASES = {
  living: ['客厅', '横厅', '起居室'], bedroom: ['卧室', '主卧', '次卧'],
  dining: ['餐厅', '饭厅'], study: ['书房', '办公室', '办公区'], balcony: ['阳台', '露台'],
};

const MODE_ALIASES = {
  replacement: ['换搭', '替换', '换一个', '同类', '更合适'],
  space: ['空间', '房间', '整屋', '搭配'],
  proactive: ['热门', '大家都在用', '为我推荐', '随便看看'],
};

const CATEGORY_ALIASES = ['沙发', '单椅', '办公椅', '椅', '桌', '灯具', '吊灯', '柜', '床', '绿植', '装饰', '地毯'];

function normalizedList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function parseIntentWithRules(query = '', requestedMode = '') {
  const text = String(query || '').trim();
  let mode = ['proactive', 'space', 'replacement'].includes(requestedMode) ? requestedMode : '';
  if (!mode && text) {
    mode = Object.entries(MODE_ALIASES).find(([, aliases]) => includesAny(text, aliases))?.[0] || '';
  }
  const room = Object.entries(ROOM_ALIASES).find(([, aliases]) => includesAny(text, aliases))?.[0] || '';
  const targetCategory = CATEGORY_ALIASES.find((category) => text.includes(category)) || '';
  const colors = ['白色', '黑色', '灰色', '米色', '棕色', '绿色', '蓝色', '黄色', '红色'].filter((value) => text.includes(value));
  const styles = ['现代', '北欧', '日式', '中古', '复古', '工业风', '自然风', '侘寂', '奶油风'].filter((value) => text.includes(value));
  return { mode, room, targetCategory, colors, styles, source: 'rules' };
}

async function parseIntentWithDeepSeek(query, fallback) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !query || process.env.RECOMMENDER_LLM_ENABLED !== 'true') return fallback;
  try {
    const baseUrl = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是家具推荐意图解析器。只返回JSON，不得编造商品。mode只能是proactive、space、replacement或null；room使用living、bedroom、dining、study、balcony或null。输出字段必须为mode,room,targetCategory,colors,styles。colors和styles必须是字符串数组。' },
          { role: 'user', content: String(query) },
        ],
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    return {
      mode: parsed.mode || fallback.mode, room: parsed.room || fallback.room,
      targetCategory: parsed.targetCategory || fallback.targetCategory,
      colors: normalizedList(parsed.colors).length ? parsed.colors : fallback.colors,
      styles: normalizedList(parsed.styles).length ? parsed.styles : fallback.styles,
      source: 'deepseek',
    };
  } catch {
    return fallback;
  }
}

function stablePopularity(id) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 1000;
}

function overlap(values, desired) {
  const set = new Set(normalizedList(values));
  return normalizedList(desired).filter((value) => [...set].some((entry) => entry.includes(value) || value.includes(entry))).length;
}

function categoryMatches(asset, category) {
  if (!category) return true;
  const haystack = `${asset.category || ''} ${asset.subCategory || ''} ${asset.name || ''}`;
  return haystack.includes(category) || category.includes(asset.category || '__none__');
}

function buildReason(asset, mode, intent) {
  if (mode === 'replacement') return `与当前家具同属${asset.category || '同类家具'}，并优先匹配你的风格偏好`;
  if (intent.room) return `适合${intent.room}空间，并兼顾风格与色彩协调`;
  return '来自当前目录的高适配热门选择';
}

export function recommendFromCatalog(assets, request, intent) {
  const mode = intent.mode || request.mode || 'proactive';
  const selected = assets.find((asset) => asset.id === request.selectedItemId);
  const targetCategory = intent.targetCategory || request.targetCategory || selected?.category || '';
  const desiredStyles = normalizedList(request.styles).concat(normalizedList(intent.styles), normalizedList(selected?.styles));
  const desiredColors = normalizedList(request.colors).concat(normalizedList(intent.colors), normalizedList(selected?.colors));
  const seen = new Set(normalizedList(request.seenItemIds).concat(request.selectedItemId ? [String(request.selectedItemId)] : []));
  const roomCategories = ROOM_CATEGORIES[intent.room || request.room] || [];
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(request.limit) || DEFAULT_LIMIT));

  const ranked = assets
    .filter((asset) => asset.status === 'ready' && !seen.has(asset.id))
    .filter((asset) => mode !== 'replacement' || categoryMatches(asset, targetCategory))
    .map((asset) => {
      const roomScore = roomCategories.some((category) => categoryMatches(asset, category)) ? 35 : 0;
      const categoryScore = targetCategory && categoryMatches(asset, targetCategory) ? 45 : 0;
      const styleScore = Math.min(20, overlap(asset.styles, desiredStyles) * 10);
      const colorScore = Math.min(12, overlap(asset.colors, desiredColors) * 6);
      const popularityScore = stablePopularity(asset.id) / 100;
      return { asset, score: categoryScore + roomScore + styleScore + colorScore + popularityScore };
    })
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));

  return ranked.slice(0, limit).map(({ asset, score }) => ({
    id: asset.id, name: asset.name, category: asset.category, subCategory: asset.subCategory,
    colors: normalizedList(asset.colors), materials: normalizedList(asset.materials), styles: normalizedList(asset.styles),
    thumbnail: asset.thumbnail || '', modelUrl: asset.modelUrl || '', contextImage: asset.contextImage || '',
    trialAvailable: Boolean(asset.modelUrl), reason: buildReason(asset, mode, intent), score: Number(score.toFixed(2)),
  }));
}

function clarificationFor(request, intent) {
  const mode = intent.mode || request.mode;
  if (!mode) return '你想让我推荐整个空间，还是替换某一件家具？';
  if (mode === 'replacement' && !request.selectedItemId && !request.targetCategory && !intent.targetCategory) {
    return '你想替换哪一件家具？可以点选家具，或告诉我品类。';
  }
  return '';
}

export async function createRecommendationEngine({ catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  let catalogPromise;
  const loadCatalog = () => catalogPromise ||= readFile(catalogPath, 'utf8').then((text) => JSON.parse(text).assets || []);
  return async function recommend(request = {}) {
    const ruleIntent = parseIntentWithRules(request.query, request.mode);
    const intent = await parseIntentWithDeepSeek(request.query, ruleIntent);
    const clarificationQuestion = clarificationFor(request, intent);
    if (clarificationQuestion) {
      return { clarificationRequired: true, clarificationQuestion, intent, items: [] };
    }
    const assets = await loadCatalog();
    const items = recommendFromCatalog(assets, request, intent);
    return {
      clarificationRequired: false, clarificationQuestion: null, intent,
      recommendationSetId: `rec_${Date.now().toString(36)}`,
      items, nextSeenItemIds: normalizedList(request.seenItemIds).concat(items.map((item) => item.id)),
      strategyVersion: 'rules-v1', catalogSize: assets.length,
    };
  };
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export async function createRecommendationHandler(options = {}) {
  const recommend = await createRecommendationEngine(options);
  return async function handleRecommendation(req, res, pathname) {
    if (pathname !== '/api/recommendations') return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
      res.end();
      return true;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try { sendJson(res, 200, await recommend(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Recommendation service error' }); }
    return true;
  };
}
