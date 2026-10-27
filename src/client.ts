import {
  ResolvrAbortError,
  ResolvrProtocolError,
  ResolvrTaskFailedError,
  ResolvrTimeoutError,
  ResolvrValidationError,
  withTaskHandle,
} from "./errors.js";
import { getTaskDefinition, isSupportedTaskType } from "./task-registry.js";
import type { TaskDefinition } from "./task-registry.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  HttpTransport,
} from "./transport.js";
import type { JsonResponse } from "./transport.js";
import type {
  AccountBalance,
  CompletedTaskResult,
  FailedTaskResult,
  RawCompletedTaskResult,
  RawFailedTaskResult,
  RawTaskHandle,
  RawTaskReference,
  RawTaskResult,
  RequestOptions,
  ResolvrClientOptions,
  ResolvrEvent,
  SolveOptions,
  SupportedTask,
  SupportedTaskType,
  TaskHandle,
  TaskReference,
  TaskResult,
} from "./types.js";
import {
  assertNoTerminalFields,
  deepFreeze,
  isRecord,
  parseTiming,
  requireResponseRecord,
  requireResponseString,
  requireString,
  serializeJsonBody,
  validateProxy,
  validateTargetUrl,
} from "./validation.js";

export const DEFAULT_SOLVE_TIMEOUT_MS = 120_000;

export class ResolvrClient {
  readonly #transport: HttpTransport;
  readonly #requestTimeoutMs: number;
  readonly #solveTimeoutMs: number;
  readonly #onEvent?: (event: ResolvrEvent) => void;
  readonly #apiKey: string;

  constructor(options: ResolvrClientOptions) {
    assertServerRuntime();
    if (!isRecord(options)) {
      throw new ResolvrValidationError(
        "ResolvrClient options must be an object",
      );
    }
    this.#apiKey = requireString(options.apiKey, "apiKey");
    this.#requestTimeoutMs = positiveDuration(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.#solveTimeoutMs = positiveDuration(
      options.solveTimeoutMs ?? DEFAULT_SOLVE_TIMEOUT_MS,
      "solveTimeoutMs",
    );
    if (
      options.onEvent !== undefined &&
      typeof options.onEvent !== "function"
    ) {
      throw new ResolvrValidationError("onEvent must be a function");
    }
    this.#onEvent = options.onEvent;
    this.#transport = new HttpTransport(
      this.#apiKey,
      options.baseUrl ?? DEFAULT_BASE_URL,
    );
  }

  get apiBaseUrl(): string {
    return this.#transport.apiBaseUrl;
  }

  async createTask<TTask extends SupportedTask>(
    task: TTask,
    options: RequestOptions = {},
  ): Promise<TaskHandle<TTask["type"]>> {
    if (!isRecord(task) || !isSupportedTaskType(task.type)) {
      throw new ResolvrValidationError(
        "Typed tasks require one of the documented task types",
      );
    }
    const definition = getTaskDefinition(task.type);
    const wire = definition.serialize(task as never);
    const body = serializeJsonBody(wire);
    const context = definition.context(task);
    this.#emit({
      type: "task.create.started",
      taskType: task.type,
      timestamp: Date.now(),
    });
    const response = await this.#transport.requestJson({
      method: "POST",
      path: "/task",
      body,
      signal: options.signal,
      timeoutMs: this.#requestTimeout(options),
      safeToRetry: false,
      secrets: [task.url, task.proxy],
    });
    if (response.status !== 202) {
      const possibleTaskId =
        isRecord(response.data) && typeof response.data.task_id === "string"
          ? response.data.task_id
          : undefined;
      throw new ResolvrProtocolError(
        `Task creation returned HTTP ${response.status}; expected 202`,
        {
          httpStatus: response.status,
          taskMayExist: true,
          ...(possibleTaskId === undefined
            ? {}
            : {
                taskHandle: {
                  taskId: possibleTaskId,
                  type: task.type,
                  ...(context === undefined ? {} : { context }),
                },
              }),
        },
      );
    }
    let raw: Record<string, unknown>;
    let taskId: string;
    try {
      raw = requireResponseRecord(response.data, "response");
      taskId = requireResponseString(raw.task_id, "response.task_id");
    } catch (cause) {
      throw new ResolvrProtocolError(
        "Task creation returned an invalid accepted response",
        {
          httpStatus: response.status,
          taskMayExist: true,
          cause,
        },
      );
    }
    if (raw.status !== "queued") {
      throw new ResolvrProtocolError(
        "Task creation response must have status queued",
        {
          httpStatus: response.status,
          taskMayExist: true,
          taskHandle: {
            taskId,
            type: task.type,
            ...(context === undefined ? {} : { context }),
          },
        },
      );
    }
    const handle = deepFreeze({
      taskId,
      type: task.type,
      status: "queued" as const,
      ...(context === undefined ? {} : { context }),
    }) as TaskHandle<TTask["type"]>;
    this.#emit({
      type: "task.created",
      taskType: task.type,
      taskId,
      status: "queued",
      timestamp: Date.now(),
    });
    return handle;
  }

  async getTask<TType extends SupportedTaskType>(
    reference: TaskReference<TType>,
    options: RequestOptions = {},
  ): Promise<TaskResult<TType>> {
    const normalized = validateTaskReference(reference);
    const definition = getTaskDefinition(normalized.type);
    this.#emit({
      type: "task.retrieve.started",
      taskType: normalized.type,
      taskId: normalized.taskId,
      timestamp: Date.now(),
    });
    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "GET",
        path: `/task/${encodeURIComponent(normalized.taskId)}`,
        signal: options.signal,
        timeoutMs: this.#requestTimeout(options),
        safeToRetry: true,
        onRetry: (retry) =>
          this.#emit({
            type: "request.retry",
            operation: "retrieve",
            taskId: normalized.taskId,
            ...retry,
            timestamp: Date.now(),
          }),
      });
    } catch (error) {
      throw withTaskHandle(error, normalized);
    }
    if (response.status !== 200) {
      throw new ResolvrProtocolError(
        `Task retrieval returned HTTP ${response.status}; expected 200`,
        { httpStatus: response.status, taskHandle: normalized },
      );
    }
    const result = parseTypedTaskResponse(
      response.data,
      normalized,
      definition,
    );
    this.#emitState(result);
    return result;
  }

  async solve<TTask extends SupportedTask>(
    task: TTask,
    options: SolveOptions = {},
  ): Promise<CompletedTaskResult<TTask["type"]>> {
    const deadline = createSolveDeadline(
      options.signal,
      positiveDuration(
        options.solveTimeoutMs ?? this.#solveTimeoutMs,
        "solveTimeoutMs",
      ),
    );
    let handle: TaskHandle<TTask["type"]> | undefined;
    try {
      handle = await this.createTask(task, {
        signal: deadline.signal,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      for (;;) {
        const state = await this.getTask(handle, {
          signal: deadline.signal,
          requestTimeoutMs: options.requestTimeoutMs,
        });
        if (state.status === "completed") return state;
        if (state.status === "failed") {
          throw taskFailedError(state, handle, [
            this.#apiKey,
            task.url,
            task.proxy,
          ]);
        }
      }
    } catch (error) {
      const normalized = deadline.timedOut()
        ? new ResolvrTimeoutError("Solve timed out", {
            taskHandle: handle,
            retryable: handle !== undefined,
            retryKind: handle === undefined ? "never" : "same_request",
            taskMayExist:
              error instanceof ResolvrTimeoutError ||
              error instanceof ResolvrAbortError
                ? error.taskMayExist
                : false,
            cause: error,
          })
        : error;
      throw handle === undefined
        ? normalized
        : withTaskHandle(normalized, handle);
    } finally {
      deadline.cleanup();
    }
  }

  async solveRaw<TResult = unknown>(
    rawTask: Record<string, unknown>,
    options: SolveOptions = {},
  ): Promise<RawCompletedTaskResult<TResult>> {
    const wire = validateRawTask(rawTask);
    const deadline = createSolveDeadline(
      options.signal,
      positiveDuration(
        options.solveTimeoutMs ?? this.#solveTimeoutMs,
        "solveTimeoutMs",
      ),
    );
    let handle: RawTaskHandle | undefined;
    try {
      handle = await this.#createRawTask(wire, {
        signal: deadline.signal,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      for (;;) {
        const result = await this.getRawTask<TResult>(handle, {
          signal: deadline.signal,
          requestTimeoutMs: options.requestTimeoutMs,
        });
        if (result.status === "completed") return result;
        if (result.status === "failed") {
          throw rawTaskFailedError(result, handle, [
            this.#apiKey,
            wire.url as string,
            wire.proxy as string,
          ]);
        }
      }
    } catch (error) {
      const normalized = deadline.timedOut()
        ? new ResolvrTimeoutError("Solve timed out", {
            taskHandle: handle,
            retryable: handle !== undefined,
            retryKind: handle === undefined ? "never" : "same_request",
            taskMayExist:
              error instanceof ResolvrTimeoutError ||
              error instanceof ResolvrAbortError
                ? error.taskMayExist
                : false,
            cause: error,
          })
        : error;
      throw handle === undefined
        ? normalized
        : withTaskHandle(normalized, handle);
    } finally {
      deadline.cleanup();
    }
  }

  async getRawTask<TResult = unknown>(
    reference: RawTaskReference,
    options: RequestOptions = {},
  ): Promise<RawTaskResult<TResult>> {
    const taskId = rawTaskId(reference);
    this.#emit({
      type: "task.retrieve.started",
      taskId,
      timestamp: Date.now(),
    });
    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "GET",
        path: `/task/${encodeURIComponent(taskId)}`,
        signal: options.signal,
        timeoutMs: this.#requestTimeout(options),
        safeToRetry: true,
        onRetry: (retry) =>
          this.#emit({
            type: "request.retry",
            operation: "retrieve",
            taskId,
            ...retry,
            timestamp: Date.now(),
          }),
      });
    } catch (error) {
      throw withTaskHandle(error, { taskId });
    }
    if (response.status !== 200) {
      throw new ResolvrProtocolError(
        `Task retrieval returned HTTP ${response.status}; expected 200`,
        { httpStatus: response.status, taskHandle: { taskId } },
      );
    }
    const result = parseRawTaskResponse<TResult>(response.data, taskId);
    this.#emitRawState(result);
    return result;
  }

  async getBalance(options: RequestOptions = {}): Promise<AccountBalance> {
    this.#emit({ type: "balance.retrieve.started", timestamp: Date.now() });
    const response = await this.#transport.requestJson({
      method: "GET",
      path: "/balance",
      signal: options.signal,
      timeoutMs: this.#requestTimeout(options),
      safeToRetry: true,
      onRetry: (retry) =>
        this.#emit({
          type: "request.retry",
          operation: "balance",
          ...retry,
          timestamp: Date.now(),
        }),
    });
    if (response.status !== 200) {
      throw new ResolvrProtocolError(
        `Balance retrieval returned HTTP ${response.status}; expected 200`,
        { httpStatus: response.status },
      );
    }
    const result = parseBalanceResponse(response.data);
    this.#emit({
      type: "balance.retrieved",
      balance: result.balance,
      currency: result.currency,
      timestamp: Date.now(),
    });
    return result;
  }

  async #createRawTask(
    wire: Record<string, unknown>,
    options: RequestOptions,
  ): Promise<RawTaskHandle> {
    const body = serializeJsonBody(wire);
    const taskType = wire.type as string;
    this.#emit({
      type: "task.create.started",
      taskType,
      timestamp: Date.now(),
    });
    const response = await this.#transport.requestJson({
      method: "POST",
      path: "/task",
      body,
      signal: options.signal,
      timeoutMs: this.#requestTimeout(options),
      safeToRetry: false,
      secrets: [wire.url as string, wire.proxy as string],
    });
    if (response.status !== 202) {
      const possibleTaskId =
        isRecord(response.data) && typeof response.data.task_id === "string"
          ? response.data.task_id
          : undefined;
      throw new ResolvrProtocolError(
        `Task creation returned HTTP ${response.status}; expected 202`,
        {
          httpStatus: response.status,
          taskMayExist: true,
          ...(possibleTaskId === undefined
            ? {}
            : { taskHandle: { taskId: possibleTaskId } }),
        },
      );
    }
    let raw: Record<string, unknown>;
    let taskId: string;
    try {
      raw = requireResponseRecord(response.data, "response");
      taskId = requireResponseString(raw.task_id, "response.task_id");
    } catch (cause) {
      throw new ResolvrProtocolError(
        "Task creation returned an invalid accepted response",
        {
          httpStatus: response.status,
          taskMayExist: true,
          cause,
        },
      );
    }
    if (raw.status !== "queued") {
      throw new ResolvrProtocolError(
        "Task creation response must have status queued",
        {
          httpStatus: response.status,
          taskMayExist: true,
          taskHandle: { taskId },
        },
      );
    }
    this.#emit({
      type: "task.created",
      taskType,
      taskId,
      status: "queued",
      timestamp: Date.now(),
    });
    return deepFreeze({ taskId, status: "queued" as const });
  }

  #requestTimeout(options: RequestOptions): number {
    return positiveDuration(
      options.requestTimeoutMs ?? this.#requestTimeoutMs,
      "requestTimeoutMs",
    );
  }

  #emit(event: ResolvrEvent): void {
    try {
      this.#onEvent?.(deepFreeze(event));
    } catch {
      // Observability callbacks must never alter request behavior.
    }
  }

  #emitState<TType extends SupportedTaskType>(result: TaskResult<TType>): void {
    this.#emit({
      type: "task.state",
      taskType: result.type,
      taskId: result.taskId,
      status: result.status,
      ...("timing" in result ? { timing: result.timing } : {}),
      ...(result.status === "failed" ? { errorCode: result.error } : {}),
      timestamp: Date.now(),
    });
  }

  #emitRawState(result: RawTaskResult): void {
    this.#emit({
      type: "task.state",
      taskId: result.task_id,
      status: result.status,
      ...(result.status === "completed" || result.status === "failed"
        ? { timing: parseTiming(result.timing) }
        : {}),
      ...(result.status === "failed" ? { errorCode: result.error } : {}),
      timestamp: Date.now(),
    });
  }
}

function parseTypedTaskResponse<TType extends SupportedTaskType>(
  value: unknown,
  reference: TaskReference<TType>,
  definition: TaskDefinition<TType>,
): TaskResult<TType> {
  const raw = requireResponseRecord(value, "response");
  const taskId = requireResponseString(raw.task_id, "response.task_id");
  if (taskId !== reference.taskId) {
    throw new ResolvrProtocolError(
      "Task response task_id does not match request",
      {
        taskHandle: reference,
      },
    );
  }
  const status = raw.status;
  if (status === "queued" || status === "processing") {
    assertNoTerminalFields(raw);
    return deepFreeze({
      taskId,
      type: reference.type,
      status,
      raw: deepFreeze(definition.redactRaw(raw)),
    }) as TaskResult<TType>;
  }
  if (status === "completed") {
    if (raw.success !== true || !("data" in raw) || !("timing" in raw)) {
      throw new ResolvrProtocolError(
        "Completed task response must contain success true, data, and timing",
        { taskHandle: reference },
      );
    }
    if ("error" in raw || "message" in raw) {
      throw new ResolvrProtocolError(
        "Completed task response must not contain failure fields",
        { taskHandle: reference },
      );
    }
    return deepFreeze({
      taskId,
      type: reference.type,
      status,
      success: true,
      data: definition.parseData(raw.data, reference.context),
      timing: parseTiming(raw.timing),
      raw: deepFreeze(definition.redactRaw(raw)),
    }) as CompletedTaskResult<TType>;
  }
  if (status === "failed") {
    if (raw.success !== false || "data" in raw || !("timing" in raw)) {
      throw new ResolvrProtocolError(
        "Failed task response must contain success false and timing without data",
        { taskHandle: reference },
      );
    }
    return deepFreeze({
      taskId,
      type: reference.type,
      status,
      success: false,
      error: requireResponseString(raw.error, "response.error"),
      message: requireResponseString(raw.message, "response.message"),
      timing: parseTiming(raw.timing),
      raw: deepFreeze(definition.redactRaw(raw)),
    }) as FailedTaskResult<TType>;
  }
  throw new ResolvrProtocolError("Task response has an unknown status", {
    taskHandle: reference,
  });
}

function parseRawTaskResponse<TResult>(
  value: unknown,
  expectedTaskId: string,
): RawTaskResult<TResult> {
  const raw = requireResponseRecord(value, "response");
  const taskId = requireResponseString(raw.task_id, "response.task_id");
  if (taskId !== expectedTaskId) {
    throw new ResolvrProtocolError(
      "Task response task_id does not match request",
      {
        taskHandle: { taskId: expectedTaskId },
      },
    );
  }
  if (raw.status === "queued" || raw.status === "processing") {
    assertNoTerminalFields(raw);
    return deepFreeze(raw) as RawTaskResult<TResult>;
  }
  if (raw.status === "completed") {
    if (raw.success !== true || !("data" in raw) || !("timing" in raw)) {
      throw new ResolvrProtocolError(
        "Completed task response must contain success true, data, and timing",
      );
    }
    parseTiming(raw.timing);
    return deepFreeze(raw) as RawTaskResult<TResult>;
  }
  if (raw.status === "failed") {
    if (raw.success !== false || "data" in raw || !("timing" in raw)) {
      throw new ResolvrProtocolError(
        "Failed task response must contain success false and timing without data",
      );
    }
    requireResponseString(raw.error, "response.error");
    requireResponseString(raw.message, "response.message");
    parseTiming(raw.timing);
    return deepFreeze(raw) as RawTaskResult<TResult>;
  }
  throw new ResolvrProtocolError("Task response has an unknown status");
}

function parseBalanceResponse(value: unknown): AccountBalance {
  const raw = requireResponseRecord(value, "response");
  if (typeof raw.balance !== "number" || !Number.isFinite(raw.balance)) {
    throw new ResolvrProtocolError("response.balance must be a finite number");
  }
  return deepFreeze({
    balance: raw.balance,
    currency: requireResponseString(raw.currency, "response.currency"),
    raw: deepFreeze(raw),
  });
}

function validateTaskReference<TType extends SupportedTaskType>(
  value: TaskReference<TType>,
): TaskReference<TType> {
  if (!isRecord(value)) {
    throw new ResolvrValidationError("task reference must be an object");
  }
  const taskId = requireString(value.taskId, "taskReference.taskId");
  if (!isSupportedTaskType(value.type)) {
    throw new ResolvrValidationError("taskReference.type is not supported");
  }
  if (value.context !== undefined) {
    if (value.type !== "cloudflare_blockpage" || !isRecord(value.context)) {
      throw new ResolvrValidationError(
        "taskReference.context is only valid for cloudflare_blockpage",
      );
    }
    if (value.context.mode !== "url") {
      throw new ResolvrValidationError("taskReference.context.mode is invalid");
    }
  }
  return value.context === undefined
    ? ({ taskId, type: value.type } as TaskReference<TType>)
    : ({
        taskId,
        type: value.type,
        context: value.context,
      } as TaskReference<TType>);
}

function validateRawTask(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ResolvrValidationError("rawTask must be an object");
  }
  const type = requireString(value.type, "rawTask.type");
  if (!isSupportedTaskType(type)) {
    throw new ResolvrValidationError(
      "rawTask.type must be one of the documented task types",
    );
  }
  validateTargetUrl(value.url, "rawTask.url");
  validateProxy(value.proxy, "rawTask.proxy");
  // Only cloudflare_blockpage may omit params; it is sent exactly as given.
  if (
    !isRecord(value.params) &&
    !(value.params === undefined && type === "cloudflare_blockpage")
  ) {
    throw new ResolvrValidationError("rawTask.params must be an object");
  }
  serializeJsonBody(value);
  return value;
}

function rawTaskId(value: RawTaskReference): string {
  if (typeof value === "string") return requireString(value, "taskId");
  if (!isRecord(value)) {
    throw new ResolvrValidationError("raw task reference must contain taskId");
  }
  return requireString(value.taskId, "taskReference.taskId");
}

function taskFailedError<TType extends SupportedTaskType>(
  result: FailedTaskResult<TType>,
  handle: TaskReference<TType>,
  secrets: readonly string[],
): ResolvrTaskFailedError {
  const classification = taskFailureClassification(result.error);
  return new ResolvrTaskFailedError(result.message, {
    code: result.error,
    taskHandle: handle,
    secrets,
    ...classification,
  });
}

function rawTaskFailedError(
  result: RawFailedTaskResult,
  handle: RawTaskHandle,
  secrets: readonly string[],
): ResolvrTaskFailedError {
  const classification = taskFailureClassification(result.error);
  return new ResolvrTaskFailedError(result.message, {
    code: result.error,
    taskHandle: handle,
    secrets,
    ...classification,
  });
}

function taskFailureClassification(code: string): {
  retryable: boolean;
  retryKind: "configuration_change" | "different_proxy" | "new_task" | "never";
} {
  if (code === "ERROR_PROXY" || code === "ERROR_IP_BANNED") {
    return { retryable: true, retryKind: "different_proxy" };
  }
  if (code === "ERROR_TASK_EXPIRED" || code === "ERROR_INTERNAL") {
    return { retryable: true, retryKind: "new_task" };
  }
  if (code === "ERROR_INVALID_INPUT") {
    return { retryable: false, retryKind: "configuration_change" };
  }
  return { retryable: false, retryKind: "never" };
}

function positiveDuration(value: unknown, path: string): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    throw new ResolvrValidationError(`${path} must be a positive number`);
  }
  return value as number;
}

function createSolveDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    throw new ResolvrValidationError(
      "@resolvrlabs/sdk is server-side only and cannot run in a browser",
    );
  }
}
