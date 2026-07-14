// Native `send_image` tool for Sylph.
//
// Tool results in pi can contain ImageContent blocks. Sylph promotes those
// blocks onto the owning assistant message, so the browser chat renders the
// image like any other attachment. This tool gives the model an explicit way
// to publish a local image (for example an agent-browser screenshot) instead
// of merely mentioning its filesystem path.

import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const SendImageParamsSchema = Type.Object({
  path: Type.String({
    description: "Path to a local PNG, JPEG, GIF, WebP, or BMP image (relative to the project or absolute).",
  }),
  caption: Type.Optional(Type.String({
    description: "Short description of the image for the user.",
  })),
});

export type SendImageParams = Static<typeof SendImageParamsSchema>;

function detectImageMimeType(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  const header = data.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (data.length >= 2 && header.startsWith("BM")) {
    return "image/bmp";
  }
  return undefined;
}

export const sendImageExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "send_image",
    label: "Send image",
    description: `Send a local image to the user as an image in the chat. Use this when the user asks to see an image or screenshot. For a browser screenshot, first run agent-browser screenshot with an explicit output path, then call this tool with that path. Supported formats: PNG, JPEG, GIF, WebP, and BMP. Maximum size: ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    parameters: SendImageParamsSchema,
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      if (signal?.aborted) throw new Error("Operation aborted");

      const input = params as SendImageParams;
      const absolutePath = path.resolve(ctx.cwd, input.path);
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) throw new Error(`Not a file: ${input.path}`);
      if (fileStat.size > MAX_IMAGE_BYTES) {
        throw new Error(`Image is too large (${Math.ceil(fileStat.size / 1024 / 1024)} MB; maximum is ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
      }

      const data = await readFile(absolutePath);
      if (signal?.aborted) throw new Error("Operation aborted");
      const mimeType = detectImageMimeType(data);
      if (!mimeType) {
        throw new Error("Unsupported image. Use PNG, JPEG, GIF, WebP, or BMP.");
      }

      const label = input.caption?.trim() || path.basename(absolutePath);
      const content: (TextContent | ImageContent)[] = [
        { type: "text", text: `Sent image: ${label}` },
        { type: "image", data: data.toString("base64"), mimeType },
      ];
      return {
        content,
        details: { path: absolutePath, mimeType, size: data.byteLength, caption: input.caption?.trim() || undefined },
      };
    },
  });
};

export default sendImageExtension;
