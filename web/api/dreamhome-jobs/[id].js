const DEFAULT_BACKEND = "http://218.244.156.128:8000";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method not allowed" });
  }
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) {
    return res.status(400).json({ detail: "Invalid job id" });
  }

  const base = String(process.env.DREAMHOME_API_BASE_URL || DEFAULT_BACKEND).replace(/\/+$/, "");
  let lastStatus = 502;
  let lastBody = JSON.stringify({ detail: "Unable to read generation status" });

  // Vercel-to-ECS connections can have brief regional routing failures.
  // Retrying this lightweight GET here prevents one upstream 502 from making
  // the browser incorrectly report that a still-running GPU job failed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.status < 500) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
        return res.status(response.status).send(lastBody);
      }
    } catch (error) {
      lastBody = JSON.stringify({
        detail: error?.name === "AbortError"
          ? "Generation status request timed out"
          : "Generation status connection failed",
      });
    } finally {
      clearTimeout(timeout);
    }
    await wait(250 * (attempt + 1));
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", "3");
  res.setHeader("Content-Type", "application/json");
  return res.status(lastStatus >= 500 ? lastStatus : 502).send(lastBody);
};
