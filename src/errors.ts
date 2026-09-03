import type { RetryKind, TaskReference } from "./types.js";
import { redactText } from "./redaction.js";

export interface ResolvrErrorOptions {
  code?: string;
  httpStatus?: number;
  taskHandle?: TaskReference | { taskId: string };
  retryable?: boolean;
  retryKind?: RetryKind;
  taskMayExist?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
  secrets?: readonly string[];
}

export class ResolvrError extends Error {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly taskHandle?: TaskReference | { taskId: string };
  readonly retryable: boolean;
  readonly retryKind: RetryKind;
  readonly taskMayExist: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ResolvrErrorOptions = {}) {
    super(redactText(message, options.secrets), { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.taskHandle = options.taskHandle;
    this.retryable = options.retryable ?? false;
    this.retryKind = options.retryKind ?? "never";
    this.taskMayExist = options.taskMayExist ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      ...(this.code === undefined ? {} : { code: this.code }),
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.taskHandle === undefined ? {} : { taskHandle: this.taskHandle }),
      retryable: this.retryable,
      retryKind: this.retryKind,
      taskMayExist: this.taskMayExist,
      ...(this.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: this.retryAfterMs }),
    };
  }
}

export class ResolvrValidationError extends ResolvrError {}
export class ResolvrTransportError extends ResolvrError {}
export class ResolvrProtocolError extends ResolvrError {}
export class ResolvrApiError extends ResolvrError {}
export class ResolvrTaskFailedError extends ResolvrError {}
export class ResolvrTimeoutError extends ResolvrError {}
export class ResolvrAbortError extends ResolvrError {}

export function withTaskHandle(
  error: unknown,
  taskHandle: TaskReference | { taskId: string },
): unknown {
  if (!(error instanceof ResolvrError) || error.taskHandle !== undefined) {
    return error;
  }

  const Constructor = error.constructor as new (
    message: string,
    options?: ResolvrErrorOptions,
  ) => ResolvrError;

  return new Constructor(error.message, {
    code: error.code,
    httpStatus: error.httpStatus,
    taskHandle,
    retryable: error.retryable,
    retryKind: error.retryKind,
    taskMayExist: error.taskMayExist,
    retryAfterMs: error.retryAfterMs,
    cause: error.cause,
  });
}
