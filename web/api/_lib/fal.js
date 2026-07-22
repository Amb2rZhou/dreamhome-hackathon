const FAL_ENDPOINT = process.env.FAL_TRELLIS_ENDPOINT || "fal-ai/trellis";

function authHeaders() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured");
  return { Authorization: `Key ${key}` };
}

function falRequestUrl(requestId, suffix = "") {
  const safeId = encodeURIComponent(requestId);
  return `https://queue.fal.run/${FAL_ENDPOINT}/requests/${safeId}${suffix}`;
}

async function falFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const message = payload?.detail || payload?.message || `Fal request failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return payload;
}

function findUrl(value, preferredKeys) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrl(item, preferredKeys);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of preferredKeys) {
    const nested = value[key];
    if (typeof nested === "string" && /^https?:\/\//.test(nested)) return nested;
    if (nested && typeof nested.url === "string") return nested.url;
  }
  for (const nested of Object.values(value)) {
    const found = findUrl(nested, preferredKeys);
    if (found) return found;
  }
  return null;
}

module.exports = { FAL_ENDPOINT, falFetch, falRequestUrl, findUrl };
