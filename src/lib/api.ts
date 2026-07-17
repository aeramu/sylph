export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
  if (!response.ok) {
    const details = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    throw new ApiError(data?.error || `Request failed (${response.status})`, response.status, details);
  }
  return data as T;
}
