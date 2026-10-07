import { createHash } from 'node:crypto';

export async function shopeeQuery(query, env = process.env, request = fetch) {
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) throw Error('Shopee API credentials required');
  const body = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha256').update(env.SHOPEE_APP_ID + timestamp + body + env.SHOPEE_SECRET).digest('hex');
  const response = await request('https://open-api.affiliate.shopee.com.br/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}` },
    body, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw Error(`Shopee HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data) throw Error('Shopee query failed; check API access/schema');
  return result.data;
}
