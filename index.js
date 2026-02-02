import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

let cachedLines = null;

// 🔁 preload on startup
async function preloadLines() {
  try {
    console.log("Preloading OASA lines...");
    const res = await fetch(
      "https://telematics.oasa.gr/api/?act=webGetLines",
      { timeout: 30000 }
    );
    cachedLines = await res.json();
    console.log("Lines cached:", cachedLines.length);
  } catch (e) {
    console.error("Preload failed:", e.message);
  }
}

// 🔥 RUN ON START
preloadLines();

// health
app.get("/", (req, res) => {
  res.send("OASA proxy running");
});

// main api
app.get("/api", async (req, res) => {
  const q = req.query.q;

  // ✅ SERVE FROM CACHE ALWAYS
  if (q === "act=webGetLines") {
    if (cachedLines) {
      return res.json(cachedLines);
    }
    return res.status(503).json({
      error: "Lines not ready yet, retry in few seconds"
    });
  }

  try {
    const url = "https://telematics.oasa.gr/api/?" + q;
    const r = await fetch(url, { timeout: 10000 });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: "Upstream OASA API failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Proxy listening on", PORT);
});
