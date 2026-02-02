import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/api", async (req, res) => {
  const url = "https://telematics.oasa.gr/api/?" + req.query.q;
  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
