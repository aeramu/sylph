import express from "express";
import { sendChat } from "./chatService.ts";
import { handleError } from "../../platform/http/routeError.ts";

export function registerChatRoutes(router: express.Router): void {
  router.post("/api/chat", async (req, res) => {
    try {
      res.json(await sendChat(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });
}
