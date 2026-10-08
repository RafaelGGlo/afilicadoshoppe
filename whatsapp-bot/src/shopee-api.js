import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
export class ShopeeError extends Error {
 constructor(code, message, retryable = false) { super(message); this.name = 'ShopeeError'; this.code = code; this.retryable = retryable; }
}
export async function shopeeQuery(query, env = process.env, request = fetch, { sleep = pause, maxAttempts = 3, now = Date.now } = {}) {
 if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) throw new ShopeeError('SHOPEE_CREDENTIALS', 'Shopee API credentials required');
 if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw Error('Invalid retry limit');
 const body = JSON.stringify({ query });
 for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
   const timestamp = Math.floor(now() / 1000);
   const signature = createHash('sha256').update(env.SHOPEE_APP_ID + timestamp + body + env.SHOPEE_SECRET).digest('hex');
   const response = await request('https://open-api.affiliate.shopee.com.br/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}` }, body, signal: AbortSignal.timeout(15000), redirect: 'error' });
   if ([401,403].includes(response.status)) throw new ShopeeError('SHOPEE_AUTH', 'Shopee rejected authentication or API permissions');
   if (response.status === 408 || response.status === 429 || response.status >= 500) throw new ShopeeError('SHOPEE_UNAVAILABLE', 'Shopee temporarily unavailable', true);
   if (!response.ok) throw new ShopeeError('SHOPEE_HTTP', `Shopee HTTP ${response.status}`);
   const result = await response.json();
   if (result.errors?.length) {
    const authentication = result.errors.some(error => /auth|credential|signature|permission|token|appid|secret/i.test(String(error.message || '') + ' ' + String(error.extensions?.code || error.code || '')));
    throw new ShopeeError(authentication ? 'SHOPEE_AUTH' : 'SHOPEE_QUERY', authentication ? 'Shopee rejected authentication or API permissions' : 'Shopee query failed; check API access/schema');
   }
   if (!result.data) throw new ShopeeError('SHOPEE_QUERY', 'Invalid Shopee response');
   return result.data;
  } catch (error) {
   const transient = ['TimeoutError','AbortError'].includes(error.name) || ['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.cause?.code || error.code);
   const classified = error instanceof ShopeeError ? error : new ShopeeError(transient ? 'SHOPEE_TIMEOUT' : 'SHOPEE_RESPONSE', transient ? 'Shopee request timed out or connection interrupted' : 'Invalid Shopee response', transient);
   if (!classified.retryable || attempt === maxAttempts) throw classified;
   await sleep(1000 * 2 ** (attempt - 1));
  }
 }
}
