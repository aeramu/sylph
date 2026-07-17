export class ApplicationError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApplicationError";
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: Record<string, unknown>): never {
  throw new ApplicationError(message, 400, details);
}

export function notFound(message: string, details?: Record<string, unknown>): never {
  throw new ApplicationError(message, 404, details);
}

export function conflict(message: string, details?: Record<string, unknown>): never {
  throw new ApplicationError(message, 409, details);
}
