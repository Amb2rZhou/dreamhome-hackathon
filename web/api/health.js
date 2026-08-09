module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const gen3dReady = Boolean(process.env.FAL_KEY);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    status: gen3dReady ? "ok" : "degraded",
    consumer_contract: "dreamhome-consumer-v1",
    provider: "fal",
    capabilities: {
      consumer_pipeline_ready: false,
      selection_draft: {
        ready: gen3dReady,
        input: "full_frame+bbox+polygon",
        isolation: "server_polygon",
      },
      gen3d: { provider: "fal", model_family: "trellis", ready: gen3dReady },
      completion: { ready: false },
      single_object_check: { ready: false },
      identity_check: { ready: false },
      material_postprocess: { ready: false },
      identity: { mode: "anonymous_preview", authenticated: false },
    },
  });
};
