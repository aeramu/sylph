import { describe, expect, it } from "vitest";
import { ApplicationError, badRequest, conflict, notFound } from "./errors.ts";

describe("application errors", () => {
  it.each([
    [badRequest, 400],
    [notFound, 404],
    [conflict, 409],
  ] as const)("maps errors to HTTP status %s", (factory, status) => {
    expect(() => factory("problem", { code: "example" })).toThrowError(ApplicationError);
    try {
      factory("problem", { code: "example" });
    } catch (error) {
      expect(error).toMatchObject({ message: "problem", status, details: { code: "example" } });
    }
  });
});
