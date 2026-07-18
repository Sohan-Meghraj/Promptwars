import "server-only";

type Bucket = {
  count: number;
  windowStartedAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function prune(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > 15 * 60_000) buckets.delete(key);
    if (buckets.size <= MAX_BUCKETS) break;
  }
}

/**
 * A small process-local guard for burst control. Production deployments should
 * back this with a shared store when multiple server instances are used.
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now);
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartedAt >= windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartedAt + windowMs - now) / 1000));
  return { allowed: existing.count <= limit, retryAfterSeconds };
}

export function requestAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
