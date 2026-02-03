import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

app.use(cors({ origin: "*" }));

let cachedLines = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000;

/* ---------- PRELOAD LINES (CRITICAL) ---------- */
async function preloadLines() {
  try {
    console.log("⏳ Preloading OASA lines...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(
      "https://telematics.oasa.gr/api/?act=webGetLines",
      {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      }
    );

    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
      cachedLines = data;
      cacheTimestamp = Date.now();
      console.log(`✅ Cached ${data.length} lines`);
    }

  } catch (err) {
    console.error("❌ Preload failed:", err.message);
  }
}

preloadLines();
setInterval(preloadLines, CACHE_DURATION);

/* ---------- HEALTH ---------- */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    cachedLines: cachedLines ? cachedLines.length : 0,
    cacheAge: cacheTimestamp
      ? Math.floor((Date.now() - cacheTimestamp) / 1000)
      : null
  });
});

/* ---------- API ---------- */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing query" });

  console.log("📡 API:", q);

  // LINES
  if (q === "act=webGetLines") {
    if (cachedLines) {
      return res.json(cachedLines);
    }
    return res.status(503).json({
      error: "Lines not ready yet"
    });
  }

  // GENERIC PROXY
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const url = "https://telematics.oasa.gr/api/?" + q;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(502).json({ error: "OASA API failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Backend live on port ${PORT}`);
});
