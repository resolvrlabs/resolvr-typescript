import { ResolvrProtocolError, ResolvrValidationError } from "./errors.js";
import type { TaskTiming } from "./types.js";

export const MAX_REQUEST_BYTES = 1_000_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ResolvrValidationError(`${path} must be an object`);
  }
  return value;
}

export function requireResponseRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ResolvrProtocolError(`${path} must be an object`);
  }
  return value;
}

export function requireString(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean } = {},
): string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.length === 0)
  ) {
    throw new ResolvrValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

export function requireResponseString(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean } = {},
): string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.length === 0)
  ) {
    throw new ResolvrProtocolError(`${path} must be a non-empty string`);
  }
  return value;
}

export function optionalString(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path, { allowEmpty: true });
}

export function optionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ResolvrValidationError(`${path} must be a boolean`);
  }
  return value;
}

export function validateTargetUrl(value: unknown, path = "task.url"): string {
  const raw = requireString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ResolvrValidationError(`${path} must be a valid HTTP(S) URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname
  ) {
    throw new ResolvrValidationError(
      `${path} must be a valid HTTP(S) URL with a host`,
    );
  }
  return raw;
}

export function validateProxy(value: unknown, path = "task.proxy"): string {
  const raw = requireString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ResolvrValidationError(
      `${path} must use scheme://[user:pass@]host:port`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResolvrValidationError(`${path} must use http or https`);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new ResolvrValidationError(
      `${path} must include a host and explicit port`,
    );
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ResolvrValidationError(
      `${path} cannot include a path, query, or fragment`,
    );
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new ResolvrValidationError(`${path} must use a public host`);
  }
  return raw;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4 !== undefined) {
    const parts = ipv4;
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    const third = parts[2] ?? 0;
    return (
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  if (host.includes(":")) {
    if (host.startsWith("::ffff:")) {
      return isPrivateHost(host.slice("::ffff:".length));
    }
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("ff") ||
      host.startsWith("2001:db8")
    );
  }
  return false;
}

function parseIpv4(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  if (!parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

export function serializeJsonBody(value: unknown): string {
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch (cause) {
    throw new ResolvrValidationError("task must be JSON serializable", {
      cause,
    });
  }
  const size = new TextEncoder().encode(body).byteLength;
  if (size > MAX_REQUEST_BYTES) {
    throw new ResolvrValidationError(
      `task exceeds the ${MAX_REQUEST_BYTES.toLocaleString("en-US")} byte request limit`,
    );
  }
  return body;
}

export function parseTiming(value: unknown): TaskTiming {
  const record = requireResponseRecord(value, "response.timing");
  return {
    queuedMs: requireNonNegativeInteger(
      record.queued_ms,
      "response.timing.queued_ms",
    ),
    proxyVerifyMs: requireNonNegativeInteger(
      record.proxy_verify_ms,
      "response.timing.proxy_verify_ms",
    ),
    executionMs: requireNonNegativeInteger(
      record.execution_ms,
      "response.timing.execution_ms",
    ),
    totalMs: requireNonNegativeInteger(
      record.total_ms,
      "response.timing.total_ms",
    ),
  };
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ResolvrProtocolError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

export function assertNoTerminalFields(record: Record<string, unknown>): void {
  for (const field of ["success", "data", "timing", "error", "message"]) {
    if (field in record) {
      throw new ResolvrProtocolError(
        `running task response must not contain ${field}`,
      );
    }
  }
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value as Readonly<T>;
}
