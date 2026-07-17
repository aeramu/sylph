import express, { type RequestHandler } from "express";
import path from "path";
import { createRouter } from "./routes/index.ts";

export interface CreateAppOptions {
  dashboardMiddleware?: RequestHandler;
  distDir?: string;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  // Dashboard proxy commands need the untouched request stream, so this must
  // remain ahead of the JSON parser when the production entry point supplies it.
  if (options.dashboardMiddleware) app.use(options.dashboardMiddleware);
  app.use(express.json({ limit: "25mb" }));
  app.use(createRouter());

  if (options.distDir) {
    app.use(express.static(options.distDir));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(options.distDir!, "index.html")));
  }

  return app;
}
