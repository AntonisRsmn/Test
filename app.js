import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use(cors({ origin: "*" }));

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= LOAD STATIC LINES ================= */
let staticLines = [];

try {
  const filePath = path.join(__dirname, "lines.json");
  staticLines = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`✅ Loaded ${staticLines.length} lines from lines.json`);
} catch (err) {
  console.error("❌ Failed to load lines.json:", err.message);
}

/* ================= HEALTH ================= */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    linesLoaded: staticLines.length
  });
});

/* ================= API ================= */
app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing query" });

  console.log("📡 API:", q);

  /* ---------- LINES (STATIC) ---------- */
  if (q === "act=webGetLines") {
    return res.json(staticLines);
  }

  /* ---------- STOPS (LIVE) ---------- */
  if (q.includes("act=getStopsForRoute")) {
    const match = q.match(/p1=(\d+)/);
    const routeCode = match?.[1];

    const endpoints = [
      `https://telematics.oasa.gr/api/?act=webGetStops&p1=${routeCode}`,
      `https://telematics.oasa.gr/api/?act=getStopsForRoute&p1=${routeCode}`
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;

        const data = await r.json();
        if (Array.isArray(data) && data.length) {
          return res.json(data);
        }
      } catch {}
    }

    return res.status(503).json({ error: "Stops unavailable" });
  }

  /* ---------- GENERIC PROXY ---------- */
  try {
    const url = "https://telematics.oasa.gr/api/?" + q;
    const r = await fetch(url);
    const data = await r.json();
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: "OASA API failed" });
  }
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Proxy running on ${PORT}`);
});
