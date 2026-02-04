import express from "express";
import fetch from "node-fetch";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// serve frontend
app.use(express.static("public"));

app.get("/api", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: "Missing q" });
  }

  try {
    const url = `https://telematics.oasa.gr/api/?${q}`;
    const r = await fetch(url, { timeout: 15000 });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("API error:", err.message);
    res.status(500).json({ error: "OASA unavailable" });
  }
});

// SPA fallback
app.get("*", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
