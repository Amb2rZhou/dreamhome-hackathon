const { FAL_ENDPOINT, falFetch } = require("./_lib/fal");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const started = Date.now();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const imageDataUrl = body.image_data_url;
    if (typeof imageDataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({ error: "A JPEG, PNG or WebP image is required" });
    }
    if (Buffer.byteLength(imageDataUrl, "utf8") > 3_800_000) {
      return res.status(413).json({ error: "图片太大，请压缩后重试" });
    }
    const payload = { image_url: imageDataUrl };
    if (typeof body.prompt === "string" && body.prompt.trim()) payload.prompt = body.prompt.trim().slice(0, 500);
    const submitted = await falFetch(`https://queue.fal.run/${FAL_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!submitted.request_id) throw new Error("Fal did not return a request id");
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({
      job_id: submitted.request_id,
      status: "queued",
      provider: "fal",
      submit_ms: Date.now() - started,
    });
  } catch (error) {
    console.error("Fal submit failed", error?.message || error);
    return res.status(502).json({ error: "3D 服务提交失败，请稍后重试" });
  }
};
