export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const read = method === "GET" || method === "HEAD";
  const timeout = read
    ? setTimeout(
        () =>
          controller.abort(
            new Error("The manager did not respond within 15 seconds."),
          ),
        15000,
      )
    : undefined;
  try {
    const response = await fetch("/api" + path, {
      method,
      signal: controller.signal,
      ...(read ? { cache: "no-store" as const } : {}),
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok)
          throw new ApiError(
            "The manager returned an unexpected response.",
            response.status,
          );
      }
    }
    if (!response.ok) {
      const detail =
        data && typeof data === "object"
          ? ((data as { error?: unknown; message?: unknown }).error ??
            (data as { message?: unknown }).message)
          : undefined;
      const fallback = response.headers
        .get("content-type")
        ?.includes("text/plain")
        ? text.trim().slice(0, 300)
        : "";
      throw new ApiError(
        typeof detail === "string"
          ? detail
          : fallback || response.statusText || "Request failed",
        response.status,
      );
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
