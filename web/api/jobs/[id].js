const { falFetch, falRequestUrl, findUrl } = require("../_lib/fal");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) return res.status(400).json({ error: "Invalid job id" });
  try {
    const statusPayload = await falFetch(falRequestUrl(id, "/status"));
    const upstream = String(statusPayload.status || "").toUpperCase();
    res.setHeader("Cache-Control", "no-store");
    if (["FAILED", "ERROR", "CANCELLED"].includes(upstream)) {
      return res.status(200).json({ status: "failed", progress: 0, provider: "fal", error: upstream });
    }
    if (upstream !== "COMPLETED") {
      return res.status(200).json({
        status: upstream === "IN_PROGRESS" ? "running" : "queued",
        progress: upstream === "IN_PROGRESS" ? 55 : 8,
        provider: "fal",
      });
    }
    const result = await falFetch(falRequestUrl(id));
    const modelUrl = findUrl(result, ["model_url", "model_glb", "model_mesh", "model", "glb", "url"]);
    const thumbnailUrl = findUrl(result, ["thumbnail_url", "preview_url", "image_url"]);
    if (!modelUrl) throw new Error("Fal result did not contain a model URL");
    return res.status(200).json({
      status: "succeeded",
      progress: 100,
      provider: "fal",
      model_url: modelUrl,
      thumbnail_url: thumbnailUrl,
    });
  } catch (error) {
    console.error("Fal status failed", error?.message || error);
    return res.status(502).json({ status: "failed", error: "无法读取3D生成状态，请重试" });
  }
};
