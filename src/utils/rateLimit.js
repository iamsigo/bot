export async function rateLimit(env, userId, limit = 12, windowSeconds = 60) {
  const key = `rl:${userId}`;
  try {
    const current = Number.parseInt((await env.KV.get(key)) || '0', 10);
    if (current >= limit) return { allowed: false, remaining: 0 };
    await env.KV.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSeconds) });
    return { allowed: true, remaining: Math.max(0, limit - current - 1) };
  } catch {
    // KV is a protective layer. If its quota is temporarily exhausted, don't block normal support traffic.
    return { allowed: true, remaining: limit };
  }
}
