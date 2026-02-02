import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

let cachedLines = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 ώρα

// Health check
app.get("/", (req, res) => {
  res.send("OASA proxy running");
});

app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter q" });
  }

  // ✅ CACHE for webGetLines
  if (
    q === "act=webGetLines" &&
    cachedLines &&
    Date.now() - cachedAt < CACHE_TTL
  ) {
    return res.json(cachedLines);
  }

  const controller = new AbortController();

  // ⏱ μεγαλύτερο timeout ΜΟΝΟ για γραμμές
  const timeoutMs = q === "act=webGetLines" ? 30000 : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = "https://telematics.oasa.gr/api/?" + q;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OASA-Proxy/1.0" }
    });

    if (!response.ok) {
      throw new Error("OASA API error: " + response.status);
    }

    const data = await response.json();

    // 🧠 Αποθήκευση cache
    if (q === "act=webGetLines") {
      cachedLines = data;
      cachedAt = Date.now();
    }

    res.json(data);

  } catch (err) {
    console.error("Proxy error:", err.message);

    // 🟡 Αν έχεις cache, δώσ’ το αντί για error
    if (q === "act=webGetLines" && cachedLines) {
      return res.json(cachedLines);
    }

    res.status(502).json({
      error: "Upstream OASA API failed",
      details: err.message
    });

  } finally {
    clearTimeout(timeout);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Proxy listening on port", PORT);
});
