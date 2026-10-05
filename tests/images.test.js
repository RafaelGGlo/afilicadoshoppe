const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { isPrivateIp, checkUrl, processBuffer, safeLookup, fetchApiImage } = require('../src/images');

const img = (w, h, format = 'png') => sharp({ create: { width: w, height: h, channels: 3, background: '#ff0000' } })[format]().toBuffer();

test('IPs internos são bloqueados', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.1', '192.168.0.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1'])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});
test('URLs perigosas são recusadas', () => {
  for (const u of ['http://cf.shopee.com.br/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://10.1.1.1/a.jpg', 'https://user:pw@x.com/a.jpg', 'https://x.com:8443/a.jpg', 'file:///etc/passwd', 'ftp://x.com/a', 'https://meu.local/a.jpg', 'nao-e-url'])
    assert.throws(() => checkUrl(u), undefined, u);
  assert.doesNotThrow(() => checkUrl('https://down-br.img.susercontent.com/file/abc'));
});
test('lookup seguro recusa nomes que resolvem para a rede interna', async () => {
  await assert.rejects(() => new Promise((res, rej) => safeLookup('localhost', {}, (e, a) => (e ? rej(e) : res(a)))), /não permitido/);
});
test('processBuffer aceita JPG/PNG/WebP e converte para JPEG', async () => {
  for (const f of ['png', 'jpeg', 'webp']) {
    const r = await processBuffer(await img(800, 800, f));
    assert.equal((await sharp(r.buffer).metadata()).format, 'jpeg');
    assert.equal(r.lowRes, false);
  }
});
test('imagem pequena é marcada como baixa resolução', async () => assert.equal((await processBuffer(await img(200, 200))).lowRes, true));
test('imagem enorme é reduzida sem cortar (proporção mantida)', async () => {
  const m = await sharp((await processBuffer(await img(3200, 1600))).buffer).metadata();
  assert.equal(m.width, 1600); assert.equal(m.height, 800);
});
test('arquivo que não é imagem, GIF e SVG são recusados', async () => {
  await assert.rejects(() => processBuffer(Buffer.from('<?php echo 1; ?>')), /não é uma imagem/);
  await assert.rejects(() => processBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')), /não é uma imagem|Formato/);
  const gif = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#000' } }).gif().toBuffer();
  await assert.rejects(() => processBuffer(gif), /Formato não permitido/);
  await assert.rejects(() => processBuffer(Buffer.alloc(0)), /vazio/);
  await assert.rejects(() => processBuffer(Buffer.alloc(7 * 1024 * 1024)), /grande demais/);
});
test('fetchApiImage: sem URL, URL interna e URL inválida não derrubam o sistema', async () => {
  assert.equal((await fetchApiImage(null, '/tmp/x')).status, 'none');
  const r = await fetchApiImage('https://127.0.0.1/a.jpg', '/tmp/x');
  assert.equal(r.status, 'falhou'); assert.match(r.note, /não permitido/);
  assert.equal((await fetchApiImage('http://x.com/a.jpg', '/tmp/x')).status, 'falhou');
});
