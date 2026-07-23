import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "./jsonFileStore.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-json-store-test-"));
const filePath = path.join(root, "nested", "store.json");
const store = new JsonFileStore<number[]>({
  filePath,
  defaultValue: () => [],
  normalize: (value) => Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number") : [],
});

afterEach(() => fs.rmSync(path.join(root, "nested"), { recursive: true, force: true }));

describe("JsonFileStore", () => {
  it("does not create a file while reading a missing store", () => {
    expect(store.read()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("normalizes and atomically replaces persisted JSON", () => {
    store.write([1, 2]);
    store.write([3]);
    expect(store.read()).toEqual([3]);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["store.json"]);
    if (process.platform !== "win32") expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
