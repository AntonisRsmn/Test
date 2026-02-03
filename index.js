import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

/* ---------- CORS ---------- */
app.use(cors({ origin: "*", methods: ["GET"] }));

/* ---------- CONFIG ---------- */
const OASA_BASE = "https://telematics.oasa.gr/api/";
const PORT = process.env.PORT || 4000;

/* ---------- CACHE (LINES) ---------- */
let cachedLines = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000;

/* ---------- HELPERS ---------- */
async function safeFetch(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 OASA-Proxy" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/* ---------- HEALTH ---------- */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    cachedLines: cachedLines ? cachedLines.length : 0,
    cacheAge: cacheTimestamp
      ? Math.floor((Date.now() - cacheTimestamp) / 1000)
      : null,
  });
});

/* ---------- API ---------- */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing q" });

  // console.log("📡 API:", q);

  /* ---------- LINES ---------- */
  if (q === "act=webGetLines") {
    if (cachedLines && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return res.json(cachedLines);
    }

    try {
      const data = await safeFetch(`${OASA_BASE}?act=webGetLines`, 20000);
      cachedLines = data;
      cacheTimestamp = Date.now();
      console.log(`✅ Lines cached (${data.length})`);
      return res.json(data);
    } catch {
      if (cachedLines) return res.json(cachedLines);
      return res.status(503).json({ error: "Lines unavailable" });
    }
  }

  /* ---------- ROUTE SHAPE (SAFE) ---------- */
  if (q.includes("act=getRouteShape")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match?.[1];

    // console.log("🛣️ Route shape request:", routeCode);

    try {
      const data = await safeFetch(
        `${OASA_BASE}?act=getRouteShape&p1=${routeCode}`,
        20000
      );

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Empty shape");
      }

      return res.json({
        ok: true,
        fallback: false,
        points: data,
      });
    } catch (e) {
      // console.warn("⚠️ Route shape failed → fallback");
      return res.json({
        ok: false,
        fallback: true,
        points: [],
      });
    }
  }

  /* ---------- STOPS ---------- */
  if (q.includes("act=getStopsForRoute")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match?.[1];

    const endpoints = [
      `?act=webGetStops&p1=${routeCode}`,
      `?act=getStopsForRoute&p1=${routeCode}`,
      `?act=webGetStopsForRoute&p1=${routeCode}`,
      `?act=getStops&p1=${routeCode}`,
    ];

    for (const ep of endpoints) {
      try {
        const data = await safeFetch(`${OASA_BASE}${ep}`);
        if (Array.isArray(data) && data.length > 0) {
          return res.json(data);
        }
      } catch {}
    }

    return res.status(503).json({ error: "Stops unavailable" });
  }

  /* ---------- GENERIC PROXY ---------- */
  try {
    const data = await safeFetch(`${OASA_BASE}?${q}`);
    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: "OASA API failed",
      details: err.message,
    });
  }
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
});
