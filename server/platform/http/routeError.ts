import type express from "express";
import { ApplicationError } from "./errors.ts";

export function handleError(res: express.Response, error: unknown) {
  if (error instanceof ApplicationError) {
    return res.status(error.status).json({ error: error.message, ...error.details });
  }
  console.error(error);
  const message = error instanceof Error ? error.message : "Internal error";
  return res.status(500).json({ error: message });
}

/** Adapt a promise-returning controller to Express's error response shape. */
export function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (req, res) => { void handler(req, res).catch((error) => handleError(res, error)); };
}
