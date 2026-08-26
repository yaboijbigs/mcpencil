import type { ApiFailure } from "../shared/game";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: Array<{ path: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "Permissions-Policy": "tools=(self), camera=(), microphone=(), geolocation=()",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function applySecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  applySecurityHeaders(headers);
  return Response.json(value, { ...init, headers });
}

export function failureResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    const body: ApiFailure = {
      error: error.message,
      code: error.code,
      ...(error.issues === undefined ? {} : { issues: error.issues }),
    };
    return jsonResponse(body, { status: error.status });
  }

  console.error(
    JSON.stringify({
      event: "unhandled_error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  return jsonResponse(
    { error: "Something went wrong.", code: "INTERNAL_ERROR" } satisfies ApiFailure,
    { status: 500 },
  );
}

export function withSecurityHeaders(response: Response, noStore = false): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  if (noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readJsonBody(request: Request, maxBytes = 64_000): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader !== undefined) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function zodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Array<{ path: string; message: string }> {
  return issues.slice(0, 12).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
