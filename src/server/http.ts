import { z } from "zod";

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const maxBodyBytes = 200000;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
const bodies = new WeakMap<Request, Uint8Array>();

/** Content-Length is only a fast rejection; streamed bytes are authoritative. */
export async function boundedBody(request: Request) {
  const cached = bodies.get(request);
  if (cached) return cached;
  if (Number(request.headers.get("Content-Length")) > maxBodyBytes)
    throw new HttpError(413, "Request too large", "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          void reader.cancel().catch(() => {});
          throw new HttpError(413, "Request too large", "BODY_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  bodies.set(request, body);
  return body;
}
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const media = request.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!media || !/^application\/(?:json|[\w.+-]+\+json)$/.test(media))
    throw new HttpError(
      415,
      "Content-Type must be application/json",
      "UNSUPPORTED_MEDIA_TYPE",
    );
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBody(request),
      ),
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Body must contain valid JSON", "INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "JSON body must be an object", "INVALID_BODY");
  return value as Record<string, unknown>;
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError)
    return json(
      {
        error: "Input validation failed",
        code: "VALIDATION_FAILED",
        details: error.flatten(),
      },
      400,
    );
  if (error instanceof URIError)
    return json({ error: "Invalid URL encoding", code: "INVALID_URL" }, 400);
  console.error(
    "api_request_failed",
    error instanceof Error ? error.message : String(error),
  );
  return json(
    {
      error: "Request failed. Check server configuration.",
      code: "SERVER_ERROR",
    },
    500,
  );
}
export function methodNotAllowed(methods: readonly string[]) {
  const response = json(
    { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
    405,
  );
  response.headers.set("Allow", methods.join(", "));
  return response;
}
