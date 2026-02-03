import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

/* ================= CACHE ================= */

let cachedLines = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/* ================= HEALTH ================= */

app.get("/", (req, res) => {
  res.json({
    status: "running",
    cachedLines: cachedLines ? cachedLines.length : 0,
    cacheAge: cacheTimestamp
      ? Math.floor((Date.now() - cacheTimestamp) / 1000)
      : null
  });
});

/* ================= API ================= */

app.get("/api", async (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.status(400).json({ error: "Missing query parameter" });
  }

  console.log("📡 API:", q);

  /* ---------- LINES (lazy load + cache) ---------- */
  if (q === "act=webGetLines") {

    // serve fresh cache
    if (cachedLines && Date.now() - cacheTimestamp < CACHE_DURATION) {
      console.log("🧠 Serving lines from cache");
      return res.json(cachedLines);
    }

    try {
      console.log("🌐 Fetching lines from OASA (live)");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000); // ⬅️ critical

      const response = await fetch(
        "https://telematics.oasa.gr/api/?act=webGetLines",
        {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 OASA-Proxy"
          }
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Empty response");
      }

      cachedLines = data;
      cacheTimestamp = Date.now();

      console.log(`✅ Lines fetched: ${data.length}`);
      return res.json(data);

    } catch (err) {
      console.error("❌ Lines fetch failed:", err.message);

      // fallback to stale cache
      if (cachedLines) {
        console.warn("⚠️ Serving stale cache");
        return res.json(cachedLines);
      }

      return res.status(502).json({
        error: "OASA lines unavailable",
        details: err.message
      });
    }
  }

  /* ---------- STOPS (multi-endpoint fallback) ---------- */
  if (q.includes("act=getStopsForRoute")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match ? match[1] : null;

    console.log("🔍 Fetching stops for route:", routeCode);

    const endpoints = [
      `https://telematics.oasa.gr/api/?act=webGetStops&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStopsForRoute&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=webGetStopsForRoute&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStops&p1=${routeCode}`
    ];

    for (const url of endpoints) {
      try {
        console.log("🔄 Trying:", url);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 OASA-Proxy"
          }
        });

        clearTimeout(timeout);

        if (!response.ok) continue;

        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
          console.log(`✅ Stops OK via ${url}`);
          return res.json(data);
        }

      } catch (err) {
        console.log("❌ Endpoint failed:", err.message);
      }
    }

    return res.status(503).json({
      error: "Could not fetch stops from OASA"
    });
  }

  /* ---------- GENERIC PROXY ---------- */
  try {
    const url = "https://telematics.oasa.gr/api/?" + q;
    console.log("🔄 Proxying:", url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 OASA-Proxy"
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    return res.status(502).json({
      error: "Upstream OASA API failed",
      details: err.message
    });
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Proxy running on port ${PORT}`);
  console.log(`📡 Endpoint: /api?q=...`);
});
