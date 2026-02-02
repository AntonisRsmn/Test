import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

// Health check
app.get("/", (req, res) => {
  res.send("OASA proxy running");
});

app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter q" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const url = "https://telematics.oasa.gr/api/?" + q;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "OASA-Proxy/1.0"
      }
    });

    if (!response.ok) {
      throw new Error("OASA API error: " + response.status);
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Proxy error:", err.message);

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
