import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

/* ---------- CORS ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET"],
}));

/* ---------- CONFIG ---------- */
const OASA_BASE = "https://telematics.oasa.gr/api/";
const PORT = process.env.PORT || 4000;

/* ---------- CACHE ---------- */
let cachedLines = null;
let linesCachedAt = 0;
const LINES_TTL = 60 * 60 * 1000; // 1 hour

/* ---------- FETCH HELPER ---------- */
async function safeFetch(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OASA-Proxy/1.0" }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- PRELOAD LINES ---------- */
async function preloadLines() {
  try {
    console.log("⏳ Preloading OASA lines...");
    const data = await safeFetch(`${OASA_BASE}?act=webGetLines`, 30000);

    cachedLines = Array.isArray(data) ? data : data?.data || [];
    linesCachedAt = Date.now();

    console.log(`✅ Lines cached: ${cachedLines.length}`);
  } catch (err) {
    console.error("❌ Lines preload failed:", err.message);
    cachedLines = null;
  }
}

preloadLines();
setInterval(preloadLines, LINES_TTL);

/* ---------- HEALTH ---------- */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    cachedLines: cachedLines ? cachedLines.length : 0,
    cacheAgeSeconds: linesCachedAt
      ? Math.floor((Date.now() - linesCachedAt) / 1000)
      : null
  });
});

/* ---------- API ---------- */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter q" });
  }

  console.log("📡 API:", q);

  /* ---- webGetLines (CACHE) ---- */
  if (q === "act=webGetLines") {
    if (cachedLines && Date.now() - linesCachedAt < LINES_TTL) {
      return res.json(cachedLines);
    }

    await preloadLines();
    if (cachedLines) return res.json(cachedLines);

    return res.status(503).json({ error: "Lines unavailable" });
  }

  /* ---- getStopsForRoute (MULTI-ENDPOINT FALLBACK) ---- */
  if (q.startsWith("act=getStopsForRoute")) {
    const routeCode = q.match(/p1=(\d+)/)?.[1];

    const endpoints = [
      `act=getStopsForRoute&p1=${routeCode}`,
      `act=webGetStops&p1=${routeCode}`,
      `act=webGetStopsForRoute&p1=${routeCode}`,
      `act=getStops&p1=${routeCode}`,
    ];

    for (const e of endpoints) {
      try {
        const data = await safeFetch(`${OASA_BASE}?${e}`, 12000);
        const stops = Array.isArray(data) ? data : data?.data;

        if (Array.isArray(stops) && stops.length > 0) {
          console.log(`✅ Stops OK via ${e}`);
          return res.json(stops);
        }
      } catch (err) {
        console.log(`⚠️ Stops endpoint failed: ${e}`);
      }
    }

    return res.status(503).json({
      error: "Could not fetch stops"
    });
  }

  /* ---- DEFAULT PROXY ---- */
  try {
    const data = await safeFetch(`${OASA_BASE}?${q}`);
    return res.json(data);
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    return res.status(502).json({
      error: "Upstream OASA API failed",
      details: err.message
    });
  }
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Proxy running on http://localhost:${PORT}`);
  console.log(`📡 Endpoint: /api?q=act=webGetLines`);
});
