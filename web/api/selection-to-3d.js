const sharp = require("sharp");
const { FAL_ENDPOINT, falFetch } = require("./_lib/fal");

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value)));

function parseDataUrl(value) {
  if (typeof value !== "string") throw new Error("完整原帧缺失");
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/i);
  if (!match) throw new Error("完整原帧必须是 JPEG、PNG 或 WebP");
  if (Buffer.byteLength(value, "utf8") > 3_800_000) throw new Error("完整原帧过大，请降低截图尺寸");
  return Buffer.from(match[2], "base64");
}

function normalizedPolygon(value) {
  if (!Array.isArray(value) || value.length < 3) throw new Error("至少需要 3 个 polygon 点");
  const points = value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error("polygon 格式无效");
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("polygon 坐标无效");
    return [clamp01(x), clamp01(y)];
  });
  if (new Set(points.map((point) => point.join(","))).size < 3) throw new Error("polygon 面积不足");
  return points;
}

function normalizedBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("bbox 格式无效");
  const [x, y, width, height] = value.map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("bbox 尺寸无效");
  }
  if (x < 0 || y < 0 || x + width > 1.0001 || y + height > 1.0001) {
    throw new Error("bbox 超出完整原帧");
  }
  return [clamp01(x), clamp01(y), Math.min(1 - x, width), Math.min(1 - y, height)];
}

async function isolateSelection(frameDataUrl, bboxValue, polygonValue) {
  const frame = parseDataUrl(frameDataUrl);
  const bbox = normalizedBbox(bboxValue);
  const polygon = normalizedPolygon(polygonValue);
  const metadata = await sharp(frame).metadata();
  const frameWidth = metadata.width;
  const frameHeight = metadata.height;
  if (!frameWidth || !frameHeight) throw new Error("无法读取完整原帧尺寸");

  const left = Math.max(0, Math.min(frameWidth - 1, Math.round(bbox[0] * frameWidth)));
  const top = Math.max(0, Math.min(frameHeight - 1, Math.round(bbox[1] * frameHeight)));
  const right = Math.max(left + 1, Math.min(frameWidth, Math.round((bbox[0] + bbox[2]) * frameWidth)));
  const bottom = Math.max(top + 1, Math.min(frameHeight, Math.round((bbox[1] + bbox[3]) * frameHeight)));
  const width = right - left;
  const height = bottom - top;
  const crop = await sharp(frame).extract({ left, top, width, height }).removeAlpha().toBuffer();
  const points = polygon
    .map(([x, y]) => `${(x * frameWidth - left).toFixed(2)},${(y * frameHeight - top).toFixed(2)}`)
    .join(" ");
  const maskSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="black"/>` +
    `<polygon points="${points}" fill="white"/></svg>`,
  );
  const alpha = await sharp(maskSvg).greyscale().blur(1).png().toBuffer();
  const subject = await sharp(crop).joinChannel(alpha).png().toBuffer();
  const isolated = await sharp({
    create: { width, height, channels: 3, background: { r: 245, g: 245, b: 242 } },
  })
    .composite([{ input: subject }])
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${isolated.toString("base64")}`;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const started = Date.now();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const imageUrl = await isolateSelection(body.frame_data_url, body.bbox, body.polygon);
    const prompt = typeof body.prompt === "string" && body.prompt.trim()
      ? `single isolated furniture object, ${body.prompt.trim().slice(0, 420)}`
      : "single isolated furniture object";
    const submitted = await falFetch(`https://queue.fal.run/${FAL_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, prompt }),
    });
    if (!submitted.request_id) throw new Error("Fal did not return a request id");
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({
      job_id: submitted.request_id,
      status: "queued",
      provider: "fal",
      quality_mode: "draft",
      isolation_mode: "polygon",
      library_attached: false,
      submit_ms: Date.now() - started,
    });
  } catch (error) {
    console.error("Selection submit failed", error?.message || error);
    const message = String(error?.message || "");
    const isInputError = /原帧|polygon|bbox|尺寸|格式|过大/.test(message);
    return res.status(isInputError ? 422 : 502).json({
      error: isInputError ? message : "3D 服务提交失败，请稍后重试",
    });
  }
}

module.exports = handler;
module.exports.isolateSelection = isolateSelection;
