import { describe, expect, it } from "vitest";
import { findAvailableModel, isSameModel } from "./modelSelection.ts";

const models = [
  { provider: "first", id: "shared", marker: 1 },
  { provider: "second", id: "shared", marker: 2 },
  { provider: "second", id: "unique", marker: 3 },
];

describe("findAvailableModel", () => {
  it("uses the provider when a qualified model id is supplied", () => {
    expect(findAvailableModel(models, "second/shared")?.marker).toBe(2);
  });

  it("continues to support bare model ids", () => {
    expect(findAvailableModel(models, "unique")?.marker).toBe(3);
  });
});

describe("isSameModel", () => {
  it("distinguishes equal model ids from different providers", () => {
    expect(isSameModel(models[0], models[1])).toBe(false);
  });

  it("matches both provider and id", () => {
    expect(isSameModel(models[1], { provider: "second", id: "shared" })).toBe(true);
  });
});
