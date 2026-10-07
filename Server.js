const express = require("express");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { LRUCache } = require("lru-cache");

const app = express();
app.use(express.json());

const USE_CACHE = process.env.USE_CACHE !== "false";
const cache = new LRUCache({ max: 10000, ttl: 5 * 60 * 1000 });
const clickBuffer = new Map(); // code -> pending clicks
let urls;
let hits = 0;
let misses = 0;

const newCode = () => crypto.randomBytes(6).toString("base64url").slice(0, 7);

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/stats", (req, res) => {
  const total = hits + misses;
  res.json({ hits, misses, hitRate: total ? hits / total : 0 });
});

app.post("/shorten", async (req, res) => {
  const { url } = req.body || {};
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "invalid_url" });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "only_http_https_allowed" });
  }
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await urls.insertOne({ _id: code, url: parsed.href, clicks: 0, createdAt: new Date() });
      return res.status(201).json({ code, short: `${req.protocol}://${req.get("host")}/${code}` });
    } catch (e) {
      if (e.code !== 11000) return res.status(500).json({ error: "server_error" });
    }
  }
  res.status(500).json({ error: "could_not_generate_code" });
});

app.get("/:code", async (req, res) => {
  const { code } = req.params;
  let target = USE_CACHE ? cache.get(code) : undefined;
  if (target) {
    hits++;
  } else {
    misses++;
    const doc = await urls.findOne({ _id: code });
    if (!doc) return res.status(404).json({ error: "not_found" });
    target = doc.url;
    if (USE_CACHE) cache.set(code, target);
  }
  clickBuffer.set(code, (clickBuffer.get(code) || 0) + 1);
  res.redirect(302, target);
});

async function flushClicks() {
  if (clickBuffer.size === 0) return;
  const ops = [...clickBuffer].map(([code, n]) => ({
    updateOne: { filter: { _id: code }, update: { $inc: { clicks: n } } },
  }));
  clickBuffer.clear();
  try {
    await urls.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.error("flush failed", e.message);
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  urls = client.db("shortener").collection("urls");
  setInterval(flushClicks, 5000);
  const server = app.listen(process.env.PORT || 3000, () => console.log("listening"));
  process.on("SIGTERM", async () => {
    server.close();
    await flushClicks();
    await client.close();
    process.exit(0);
  });
}
main();
