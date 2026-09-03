const GENERIC_SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  [
    /(\"?(?:token|cf_clearance|api[_-]?key|authorization|cookie|body)\"?\s*[:=]\s*\"?)[^\s\",}]+/gi,
    "$1[REDACTED]",
  ],
];

export function redactText(
  value: string,
  explicitSecrets: readonly string[] = [],
): string {
  let redacted = value;
  for (const secret of explicitSecrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  for (const [pattern, replacement] of GENERIC_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/**
 * Produces a structural response copy that is safer to inspect. Exact solution
 * data remains available through typed `data` or the explicit raw APIs.
 */
export function redactResponseRaw(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return cloneAndRedact(value, []) as Record<string, unknown>;
}

function cloneAndRedact(value: unknown, path: readonly string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneAndRedact(item, path));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        cloneAndRedact(child, [...path, key]),
      ]),
    );
  }
  if (typeof value !== "string") return value;

  const key = path.at(-1) ?? "";
  if (
    path[0] === "data" ||
    key === "message" ||
    /(?:token|secret|authorization|api[_-]?key|proxy|html|body|clearance)$/i.test(
      key,
    )
  ) {
    return "[REDACTED]";
  }
  return redactText(value);
}
