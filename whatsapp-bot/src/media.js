// Trusted operator-provided sources only. No redirects; bounded download.
export async function downloadImage(raw, request = fetch) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('Image must use HTTPS');
  const res = await request(u, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!res.ok || !/^image\/(jpeg|png|webp)(;|$)/i.test(res.headers.get('content-type') || '')) throw Error('Image unavailable or unsupported');
  const limit = 5 * 1024 * 1024;
  if (Number(res.headers.get('content-length')) > limit) { await res.body.cancel(); throw Error('Image too large'); }
  const chunks = []; let size = 0;
  for await (const chunk of res.body) { size += chunk.length; if (size > limit) throw Error('Image too large'); chunks.push(chunk); }
  const image = Buffer.concat(chunks);
  const jpeg = image[0] === 255 && image[1] === 216 && image[2] === 255;
  const png = image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = image.subarray(0,4).toString() === 'RIFF' && image.subarray(8,12).toString() === 'WEBP';
  if (!jpeg && !png && !webp) throw Error('Invalid image bytes');
  return image;
}
