import {
  ResolvrAbortError,
  ResolvrApiError,
  ResolvrProtocolError,
  ResolvrTimeoutError,
  ResolvrTransportError,
  ResolvrValidationError,
} from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.resolvr.com/";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIEVAL_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 10_000;

export interface JsonResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

interface RetryEvent {
  attempt: number;
  delayMs: number;
  reason: "transport" | "timeout" | "rate_limit" | "server";
  httpStatus?: number;
}

interface JsonRequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  safeToRetry: boolean;
  secrets?: readonly string[];
  onRetry?: (event: RetryEvent) => void;
}

export class HttpTransport {
  readonly apiBaseUrl: string;
  readonly #apiKey: string;

  constructor(apiKey: string, baseUrl: string) {
    this.#apiKey = apiKey;
    this.apiBaseUrl = normalizeApiBaseUrl(baseUrl);
  }

  async requestJson(options: JsonRequestOptions): Promise<JsonResponse> {
    let retries = 0;
    for (;;) {
      try {
        return await this.#requestOnce(options);
      } catch (error) {
        if (
          !options.safeToRetry ||
          retries >= MAX_RETRIEVAL_RETRIES ||
          !isSafeRetrievalRetry(error)
        ) {
          throw error;
        }
        retries += 1;
        const delayMs = retryDelay(error, retries);
        options.onRetry?.({
          attempt: retries,
          delayMs,
          reason: retryReason(error),
          ...(error instanceof ResolvrApiError && error.httpStatus !== undefined
            ? { httpStatus: error.httpStatus }
            : {}),
        });
        await abortableDelay(delayMs, options.signal);
      }
    }
  }

  async #requestOnce(options: JsonRequestOptions): Promise<JsonResponse> {
    if (options.signal?.aborted) {
      throw new ResolvrAbortError("Request aborted", {
        retryable: options.safeToRetry,
        retryKind: options.safeToRetry ? "same_request" : "never",
      });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const abortFromCaller = (): void =>
      controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });

    let requestStarted = false;
    let response: Response;
    let responseText: string;
    try {
      requestStarted = true;
      response = await fetch(`${this.apiBaseUrl}${options.path}`, {
        method: options.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (cause) {
      const taskMayExist = options.method === "POST" && requestStarted;
      if (timedOut) {
        throw new ResolvrTimeoutError(
          `Request timed out after ${options.timeoutMs}ms`,
          {
            retryable: options.safeToRetry,
            retryKind: options.safeToRetry ? "same_request" : "never",
            taskMayExist,
            cause,
          },
        );
      }
      if (options.signal?.aborted) {
        throw new ResolvrAbortError("Request aborted", {
          retryable: options.safeToRetry,
          retryKind: options.safeToRetry ? "same_request" : "never",
          taskMayExist: options.method === "POST" && requestStarted,
          cause,
        });
      }
      throw new ResolvrTransportError("Could not reach the Resolvr API", {
        retryable: options.safeToRetry,
        retryKind: options.safeToRetry ? "same_request" : "never",
        taskMayExist: options.method === "POST" && requestStarted,
        cause,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }

    let data: unknown;
    try {
      data = JSON.parse(responseText) as unknown;
    } catch (cause) {
      throw new ResolvrProtocolError(
        `Resolvr API returned a non-JSON response with HTTP ${response.status}`,
        {
          httpStatus: response.status,
          taskMayExist: options.method === "POST" && response.ok,
          cause,
        },
      );
    }

    if (!response.ok) {
      throwApiError(response.status, response.headers, data, options.method, [
        this.#apiKey,
        ...(options.secrets ?? []),
      ]);
    }
    return { status: response.status, headers: response.headers, data };
  }
}

export function normalizeApiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResolvrValidationError("baseUrl must be a valid HTTP(S) origin");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResolvrValidationError("baseUrl must use http or https");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new ResolvrValidationError(
      "baseUrl must be an origin without credentials, path, query, or fragment",
    );
  }
  return `${parsed.origin}/v1`;
}

function throwApiError(
  status: number,
  headers: Headers,
  value: unknown,
  method: "GET" | "POST",
  secrets: readonly string[],
): never {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResolvrProtocolError(
      `Resolvr API returned an invalid error response with HTTP ${status}`,
      { httpStatus: status },
    );
  }
  const record = value as Record<string, unknown>;
  const codeValue = record.error ?? record.code;
  if (typeof codeValue !== "string" || typeof record.message !== "string") {
    throw new ResolvrProtocolError(
      `Resolvr API returned an invalid error response with HTTP ${status}`,
      { httpStatus: status },
    );
  }
  const classification = classifyApiError(status, codeValue, method);
  throw new ResolvrApiError(record.message, {
    code: codeValue,
    httpStatus: status,
    ...classification,
    retryAfterMs: parseRetryAfter(headers.get("retry-after")),
    secrets,
  });
}

function classifyApiError(
  status: number,
  code: string,
  method: "GET" | "POST",
): {
  retryable: boolean;
  retryKind:
    | "same_request"
    | "new_task"
    | "configuration_change"
    | "different_proxy"
    | "never";
} {
  if (code === "ERROR_PROXY" || code === "ERROR_IP_BANNED") {
    return { retryable: true, retryKind: "different_proxy" };
  }
  if (code === "ERROR_TASK_EXPIRED") {
    return { retryable: true, retryKind: "new_task" };
  }
  if (status === 429 || status >= 500) {
    return {
      retryable: true,
      retryKind: method === "GET" ? "same_request" : "new_task",
    };
  }
  if (
    code === "ERROR_INVALID_INPUT" ||
    code === "ERROR_UNSUPPORTED_TYPE" ||
    code === "ERROR_TYPE_NOT_ALLOWED" ||
    code === "ERROR_IP_NOT_ALLOWED"
  ) {
    return { retryable: false, retryKind: "configuration_change" };
  }
  return { retryable: false, retryKind: "never" };
}

function isSafeRetrievalRetry(error: unknown): boolean {
  if (
    error instanceof ResolvrTransportError ||
    error instanceof ResolvrTimeoutError
  ) {
    return true;
  }
  return (
    error instanceof ResolvrApiError &&
    error.httpStatus !== undefined &&
    (error.httpStatus === 429 || error.httpStatus >= 500)
  );
}

function retryReason(error: unknown): RetryEvent["reason"] {
  if (error instanceof ResolvrTimeoutError) return "timeout";
  if (error instanceof ResolvrTransportError) return "transport";
  if (error instanceof ResolvrApiError && error.httpStatus === 429) {
    return "rate_limit";
  }
  return "server";
}

function retryDelay(error: unknown, retry: number): number {
  if (error instanceof ResolvrApiError && error.retryAfterMs !== undefined) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, error.retryAfterMs));
  }
  const base = Math.min(2_000, 100 * 2 ** (retry - 1));
  const jittered = base * (0.5 + Math.random());
  return Math.round(Math.min(MAX_RETRY_DELAY_MS, jittered));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new ResolvrAbortError("Request aborted", {
      retryable: true,
      retryKind: "same_request",
    });
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      cleanup();
      reject(
        new ResolvrAbortError("Request aborted", {
          retryable: true,
          retryKind: "same_request",
        }),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
