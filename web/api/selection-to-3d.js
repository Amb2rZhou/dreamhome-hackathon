/**
 * Retired draft endpoint.
 *
 * Feed selections must use the DreamHome production orchestrator through
 * `/dreamhome-api/api/videos/:videoId/select` and `/select/confirm`. Keeping a
 * callable raw TRELLIS shortcut here previously allowed completion and quality
 * gates to be bypassed whenever the production backend was unavailable.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    error: "快速圈选草稿接口已停用，请使用 DreamHome 正式补全与质量检查链路",
    production_endpoint: "/dreamhome-api/api/videos/{video_id}/select",
  });
};
