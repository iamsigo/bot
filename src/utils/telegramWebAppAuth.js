const enc = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacRaw(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Validate Telegram Mini App initData on the Worker. Never trust initDataUnsafe. */
export async function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    if (!receivedHash) return null;
    params.delete('hash');

    const authDate = Number(params.get('auth_date') || 0);
    if (!Number.isInteger(authDate) || authDate <= 0) return null;
    if (Math.floor(Date.now() / 1000) - authDate > maxAgeSeconds) return null;

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = await hmacRaw(enc.encode('WebAppData'), botToken);
    const calculated = hex(await hmacRaw(secretKey, dataCheckString));
    const got = receivedHash.toLowerCase();
    const expectedBytes = new Uint8Array(calculated.match(/.{2}/g).map((x) => parseInt(x, 16)));
    const gotBytes = new Uint8Array((got.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
    if (!constantTimeEqual(expectedBytes, gotBytes)) return null;

    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    if (!user?.id) return null;
    return { user, authDate, queryId: params.get('query_id') || null };
  } catch {
    return null;
  }
}

export async function requireMiniAppAdmin(c) {
  const auth = c.req.header('Authorization') || '';
  const initData = auth.startsWith('tma ') ? auth.slice(4) : '';
  const validated = await validateInitData(initData, c.env.BOT_TOKEN);
  if (!validated) return null;
  const { getAdmin } = await import('../db/queries.js');
  const admin = await getAdmin(c.env.DB, validated.user.id);
  if (!admin?.is_active) return null;
  return { admin, telegramUser: validated.user };
}
