import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- CORS ---------- */
app.use(cors({ origin: "*", methods: ["GET"] }));

/* ---------- CONFIG ---------- */
const OASA_BASE = "https://telematics.oasa.gr/api/";
const PORT = process.env.PORT || 3000;

/* ---------- CACHE (LINES) ---------- */
let cachedLines = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000;

/* ---------- FETCH ---------- */
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

/* ---------- API ---------- */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing q" });

  if (q === "act=webGetLines") {
    if (cachedLines && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return res.json(cachedLines);
    }
    try {
      const data = await safeFetch(`${OASA_BASE}?act=webGetLines`, 30000);
      cachedLines = data;
      cacheTimestamp = Date.now();
      return res.json(data);
    } catch {
      if (cachedLines) return res.json(cachedLines);
      return res.status(503).json({ error: "Lines unavailable" });
    }
  }

  if (q.includes("act=getRouteShape")) {
    const match = q.match(/p1=(\d+)/);
    try {
      const data = await safeFetch(
        `${OASA_BASE}?act=getRouteShape&p1=${match?.[1]}`,
        20000
      );
      return res.json({ ok: true, points: data });
    } catch {
      return res.json({ ok: false, points: [] });
    }
  }

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
        if (Array.isArray(data) && data.length) return res.json(data);
      } catch {}
    }
    return res.status(503).json({ error: "Stops unavailable" });
  }

  try {
    const data = await safeFetch(`${OASA_BASE}?${q}`);
    return res.json(data);
  } catch {
    return res.status(502).json({ error: "OASA API failed" });
  }
});

/* ---------- STATIC ---------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------- SPA ---------- */
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (cachedLines) console.log(`📦 Lines cached: ${cachedLines.length}`);
});