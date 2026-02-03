import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

/* ---------- CORS ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET"],
}));

/* ================= CACHE ================= */

/* ---------- CONFIG ---------- */
const OASA_BASE = "https://telematics.oasa.gr/api/";
const PORT = process.env.PORT || 4000;

/* ---------- CACHE ---------- */
let cachedLines = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 60 * 1000;

async function preloadLines() {
  try {
    console.log("⏳ Preloading OASA lines...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const res = await fetch(
      "https://telematics.oasa.gr/api/?act=webGetLines",
      { signal: controller.signal }
    );
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    cachedLines = await res.json();
    cacheTimestamp = Date.now();
    console.log(`✅ Lines cached: ${cachedLines.length} lines`);
  } catch (e) {
    console.error("❌ Preload failed:", e.message);
    cachedLines = null;
  }
}

preloadLines();
setInterval(preloadLines, CACHE_DURATION);

/* ---------- HEALTH ---------- */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    cachedLines: cachedLines ? cachedLines.length : 0,
    cacheAge: cacheTimestamp ? Math.floor((Date.now() - cacheTimestamp) / 1000) : null
  });
});

/* ================= API ================= */

/* ---------- API ---------- */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter" });
  }
  
  console.log("📡 API Request:", q);
  
  // Serve lines from cache
  if (q === "act=webGetLines") {
    if (cachedLines && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
      return res.json(cachedLines);
    }
    
    await preloadLines();
    
    if (cachedLines) {
      return res.json(cachedLines);
    }
    
    return res.status(503).json({
      error: "Lines not ready yet"
    });
  }
  
  // Handle stops request - try multiple endpoints
  if (q.includes("act=getStopsForRoute")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match ? match[1] : null;
    
    console.log("🔍 Trying multiple stop endpoints for route:", routeCode);
    
    // Try different endpoint variations
    const endpoints = [
      `https://telematics.oasa.gr/api/?act=webGetStops&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStopsForRoute&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=webGetStopsForRoute&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStops&p1=${routeCode}`
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log("🔄 Trying:", endpoint);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!response.ok) {
          console.log("❌ HTTP error:", response.status);
          continue;
        }
        
        const data = await response.json();
        console.log("📦 Response:", JSON.stringify(data).substring(0, 300));
        
        // Check if we got valid data
        if (data.error) {
          console.log("❌ API returned error:", data.error);
          continue;
        }
        
        if (Array.isArray(data) && data.length > 0) {
          console.log("✅ Valid stops data found! Count:", data.length);
          return res.json(data);
        }
      } catch (err) {
        console.log("❌ Endpoint failed:", err.message);
        continue;
      }
    }
    
    console.log("⚠️ All stop endpoints failed");
    return res.status(503).json({ 
      error: "Could not fetch stops. OASA API might be down or the route code is invalid." 
    });
  }
  
  // Proxy all other requests
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const url = "https://telematics.oasa.gr/api/?" + q;
    console.log("🔄 Proxying to:", url);
    
    const response = await fetch(url, { signal: controller.signal });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log("✅ Response received");
    
    res.json(data);
    
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(502).json({
      error: "Upstream OASA API failed",
      details: err.message
    });
  }
});

/* ================= SERVER ================= */

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Proxy server running at http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
});
