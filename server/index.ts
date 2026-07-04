import express from "express";
import { HOST, PORT, ALLOWED_HOSTS } from "./config.ts";
import { createRouter } from "./routes.ts";
import { startEvictionTimer } from "./runtimes.ts";

const app = express();
app.use(express.json({ limit: '25mb' }));

// Reject requests whose Host header isn't local (defends against DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

app.use(createRouter());

startEvictionTimer();

app.listen(PORT, HOST, () => {
  console.log(`Backend server listening on http://${HOST}:${PORT}`);
});
