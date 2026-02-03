import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET"],
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
  if (!q) return res.status(400).json({ error: "Missing q" });

  console.log("📡 API:", q);

  /* ---------- LINES ---------- */
  if (q === "act=webGetLines") {

    // Serve cache if fresh
    if (cachedLines && Date.now() - cacheTimestamp < CACHE_DURATION) {
      console.log("🧠 Lines from cache");
      return res.json(cachedLines);
    }

    try {
      console.log("🌐 Fetching lines from OASA…");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(
        "https://telematics.oasa.gr/api/?act=webGetLines",
        {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" }
        }
      );

      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        cachedLines = data;
        cacheTimestamp = Date.now();
        console.log(`✅ Lines fetched: ${data.length}`);
        return res.json(data);
      }

      throw new Error("Empty lines");

    } catch (err) {
      console.error("❌ Lines failed:", err.message);

      // Serve stale cache if exists
      if (cachedLines) {
        console.warn("⚠️ Serving stale cache");
        return res.json(cachedLines);
      }

      // IMPORTANT: return empty array (frontend will unlock)
      return res.json([]);
    }
  }

  /* ---------- STOPS ---------- */
  if (q.includes("act=getStopsForRoute")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match?.[1];

    const endpoints = [
      `https://telematics.oasa.gr/api/?act=webGetStops&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStopsForRoute&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStops&p1=${routeCode}`,
    ];

    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const r = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" }
        });

        clearTimeout(timeout);
        if (!r.ok) continue;

        const data = await r.json();
        if (Array.isArray(data) && data.length) {
          return res.json(data);
        }
      } catch {}
    }

    return res.json([]);
  }

  /* ---------- GENERIC PROXY ---------- */
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(
      "https://telematics.oasa.gr/api/?" + q,
      {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      }
    );

    clearTimeout(timeout);

    if (!response.ok) throw new Error("Upstream error");
    const data = await response.json();
    return res.json(data);

  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    return res.json([]);
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Proxy running on port ${PORT}`);
});
