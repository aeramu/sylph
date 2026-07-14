import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { sendImageExtension } from "./sendImage.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureTool(): any {
  let tool: any;
  sendImageExtension({ registerTool: (definition: any) => { tool = definition; } } as any);
  return tool;
}

describe("send_image", () => {
  it("returns a local PNG as ImageContent", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "sylph-send-image-"));
    tempDirs.push(cwd);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await writeFile(path.join(cwd, "page.png"), png);

    const result = await captureTool().execute(
      "call-1",
      { path: "page.png", caption: "Browser result" },
      undefined,
      undefined,
      { cwd },
    );

    expect(result.content).toEqual([
      { type: "text", text: "Sent image: Browser result" },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    expect(result.details).toMatchObject({
      path: path.join(cwd, "page.png"),
      mimeType: "image/png",
      size: png.byteLength,
      caption: "Browser result",
    });
  });

  it("rejects files that are not supported images", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "sylph-send-image-"));
    tempDirs.push(cwd);
    await writeFile(path.join(cwd, "notes.txt"), "not an image");

    await expect(captureTool().execute(
      "call-2",
      { path: "notes.txt" },
      undefined,
      undefined,
      { cwd },
    )).rejects.toThrow("Unsupported image");
  });
});
