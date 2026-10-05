const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const caption = require('../src/message').buildCaption(require('../src/db').DEFAULT_TEMPLATE, { name: 'Produto real', priceMin: 80, priceMax: 80, previousPrice: 100, sameVariant: true, coupon: 'CASA10', link: 'https://s.shopee.com.br/abc?sub_id=A%2fb&x=1&x=2' });
const offer = { id: 1, name: 'Produto real', source: 'manual', status: 'preparada', imageUrl: '/imagens/photo.jpg', updatedAt: '2026-10-04', fetchedAt: '2026-10-04', caption };

async function panel({ canShare = () => true, share, imageResponse, failSave = false } = {}) {
  const nodes = new Map();
  const downloads = [];
  const makeNode = () => ({ value: '', hidden: false, disabled: false, textContent: '', listeners: {}, files: [],
    addEventListener(event, fn) { this.listeners[event] = fn; },
    append() {}, remove() {}, select() {}, reset() {}, replaceChildren() {},
    click() { downloads.push({ href: this.href, name: this.download }); },
    showModal() { this.open = true; }, close() { this.open = false; },
  });
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], makeNode());
  const requests = [], shares = [], checks = [], copies = [];
  const photo = new Blob(['original-photo-bytes'], { type: 'image/jpeg' });
  const navigator = {
    canShare(data) { checks.push(data); return canShare(data); },
    share(data) { shares.push(data); return share ? share(data) : Promise.resolve(); },
    clipboard: { async writeText(text) { copies.push(text); } },
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url === '/api/session') return { ok: true, status: 200, json: async () => ({ needsLogin: true, logged: false }) };
    if (url.startsWith('/imagens/')) return imageResponse ? imageResponse(url) : { ok: true, blob: async () => photo };
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      return { ok: !failSave, status: failSave ? 400 : 200, json: async () => failSave ? { error: 'Falha de persistência' } : { ...offer, ...body } };
    }
    throw new Error('Requisição inesperada: ' + url);
  };
  const context = vm.createContext({ navigator, fetch, File, Blob, URL, URLSearchParams, Intl, setTimeout, clearTimeout,
    document: { getElementById(id) { assert.ok(nodes.has(id), 'Elemento ausente: ' + id); return nodes.get(id); }, querySelectorAll: () => [], createElement: makeNode, body: { append() {} } },
  });
  vm.runInContext(source, context, { filename: 'public/app.js' });
  await tick();
  const show = (o = offer) => { context.testOffer = o; vm.runInContext('preencher(testOffer)', context); };
  const click = id => nodes.get(id).listeners.click();
  return { context, nodes, navigator, requests, shares, checks, copies, downloads, photo, show, click };
}

test('compartilha uma única foto e legenda completa, sem segundo envio nem publicação automática', async () => {
  const p = await panel(); p.show(); await tick();
  assert.equal(p.nodes.get('bCompartilhar').disabled, false);
  const before = p.requests.length;
  const sharing = p.click('bCompartilhar');
  // share deve ser chamado ainda na pilha do clique, antes de qualquer await de rede.
  assert.equal(p.shares.length, 1); assert.equal(p.requests.length, before);
  await sharing;
  const data = p.shares[0];
  assert.equal(Object.keys(data).sort().join(','), 'files,text');
  assert.equal(data.files.length, 1); assert.equal(data.text, caption);
  assert.equal(data.files[0].type, 'image/jpeg');
  assert.equal(await data.files[0].text(), await p.photo.text()); // não escreve texto na imagem
  assert.ok(p.checks.some(check => check.files && check.text === caption));
  assert.equal(p.copies.length, 0); // cópia é uma ação explícita, sem segundo compartilhamento
  const patches = p.requests.filter(r => r.method === 'PATCH');
  assert.equal(patches.length, 1); assert.deepEqual(JSON.parse(patches[0].body), { caption });
  assert.equal(p.nodes.get('dConfirma').hidden, false);
  assert.equal(vm.runInContext('atual.status', p.context), 'preparada');
  await p.click('bSim');
  assert.deepEqual(JSON.parse(p.requests.filter(r => r.method === 'PATCH').at(-1).body), { status: 'publicada' });
});

test('sem suporte ao conjunto oferece baixar/copiar e não envia só foto ou só texto', async () => {
  const p = await panel({ canShare: data => !(data.files && data.text) });
  p.show(); await tick(); await p.click('bCompartilhar');
  assert.equal(p.shares.length, 0);
  assert.match(p.nodes.get('dMsg').textContent, /não suporta.*Baixar imagem e Copiar legenda/);
  assert.doesNotMatch(p.nodes.get('dMsg').textContent, /sucesso|encaminhadas|concluído|publicada/);
  assert.equal(p.nodes.get('dConfirma').hidden, true);
  assert.equal(p.requests.filter(r => r.method === 'PATCH').length, 0);
  await p.click('bCopiar'); assert.equal(p.copies[0], caption);
  await p.click('bBaixar'); assert.equal(p.downloads.length, 1); assert.equal(p.downloads[0].name, 'oferta-1.jpg');
});

test('ausência da API, rejeição e cancelamento mantêm a oferta e oferecem alternativa', async () => {
  for (const mode of ['missing', 'error', 'abort', 'canShareError', 'textUnsupported']) {
    const p = await panel({
      canShare: data => { if (mode === 'canShareError') throw new Error('Indisponível'); return mode !== 'textUnsupported' || !data.text; },
      share: () => Promise.reject(Object.assign(new Error('Falha'), { name: mode === 'abort' ? 'AbortError' : 'NotAllowedError' })),
    });
    if (mode === 'missing') delete p.navigator.share;
    p.show(); await tick(); await p.click('bCompartilhar');
    assert.equal(p.nodes.get('dMsg').hidden, false, mode);
    assert.doesNotMatch(p.nodes.get('dMsg').textContent, /sucesso|encaminhadas|concluído/, mode);
    assert.equal(p.nodes.get('dConfirma').hidden, true, mode);
    assert.equal(p.nodes.get('bCompartilhar').disabled, false, mode);
    assert.equal(p.requests.filter(r => r.method === 'PATCH').length, 0, mode);
    assert.equal(vm.runInContext('atual.status', p.context), 'preparada');
  }
});

test('carregamento lento impede compartilhamento sem foto; salvar legenda não invalida o download', async () => {
  let ready;
  const p = await panel({ imageResponse: () => new Promise(resolve => { ready = resolve; }) });
  p.show();
  assert.equal(p.nodes.get('bCompartilhar').disabled, true);
  await p.click('bCompartilhar'); assert.equal(p.shares.length, 0);
  await p.click('bSalvar'); // atual passa a ser outro objeto enquanto a foto carrega
  ready({ ok: true, blob: async () => p.photo }); await tick();
  assert.equal(p.nodes.get('bCompartilhar').disabled, false);
  p.nodes.get('dLegenda').value = caption + '\nCondição editada';
  await p.click('bCompartilhar'); assert.equal(p.shares[0].text, caption + '\nCondição editada');
});

test('trocar oferta descarta foto atrasada e não compartilha imagem de outro produto', async () => {
  const pending = [];
  const p = await panel({ imageResponse: () => new Promise(resolve => pending.push(resolve)) });
  p.show();
  p.show({ ...offer, id: 2, imageUrl: '/imagens/other.jpg', caption: 'Outra legenda' });
  pending[0]({ ok: true, blob: async () => p.photo }); await tick();
  assert.equal(p.nodes.get('bCompartilhar').disabled, true);
  pending[1]({ ok: true, blob: async () => new Blob(['second-photo'], { type: 'image/jpeg' }) }); await tick();
  await p.click('bCompartilhar');
  assert.equal(p.shares[0].files[0].name, 'oferta-2.jpg'); assert.equal(await p.shares[0].files[0].text(), 'second-photo');
  assert.equal(p.shares[0].text, 'Outra legenda');
});

test('erro de imagem e legenda vazia não abrem envio parcial', async () => {
  const p = await panel({ imageResponse: async () => ({ ok: false }) });
  p.show(); await tick(); await p.click('bCompartilhar');
  assert.equal(p.shares.length, 0); assert.equal(p.nodes.get('dMsg').hidden, false);
  const valid = await panel(); valid.show(); await tick();
  valid.nodes.get('dLegenda').value = '   '; await valid.click('bCompartilhar');
  assert.equal(valid.shares.length, 0); assert.match(valid.nodes.get('dMsg').textContent, /Preencha a legenda/);
});

test('falha ao salvar após share não oculta confirmação nem informa falha de compartilhamento', async () => {
  const p = await panel({ failSave: true }); p.show(); await tick(); await p.click('bCompartilhar');
  assert.equal(p.shares.length, 1); assert.equal(p.nodes.get('dConfirma').hidden, false);
  assert.match(p.nodes.get('dMsg').textContent, /Não consegui salvar a legenda/);
  assert.equal(vm.runInContext('atual.status', p.context), 'preparada');
});

test('confirmação aparece somente depois da resolução do share e nunca no cancelamento', async () => {
  for (const cancelled of [false, true]) {
    let resolveShare, rejectShare;
    const p = await panel({ share: () => new Promise((resolve, reject) => { resolveShare = resolve; rejectShare = reject; }) });
    p.show(); await tick();
    assert.equal(p.nodes.get('dConfirma').hidden, true);
    await p.click('bSim'); // um controle oculto não permite publicação antecipada
    assert.equal(p.requests.filter(r => r.method === 'PATCH').length, 0);
    const pending = p.click('bCompartilhar');
    assert.equal(p.nodes.get('dConfirma').hidden, true);
    await p.click('bCompartilhar'); // ignora clique repetido durante share
    assert.equal(p.shares.length, 1);
    await p.click('bSim');
    assert.equal(p.requests.filter(r => r.method === 'PATCH').length, 0);
    if (cancelled) rejectShare(Object.assign(new Error('Cancelado'), { name: 'AbortError' }));
    else resolveShare();
    await pending;
    assert.equal(p.nodes.get('dConfirma').hidden, cancelled);
    if (cancelled) {
      assert.equal(p.nodes.get('dMsg').textContent, 'Compartilhamento cancelado.');
      await p.click('bSim');
      assert.equal(p.requests.filter(r => r.method === 'PATCH').length, 0);
    } else {
      assert.equal(p.nodes.get('dMsg').hidden, true); // apenas uma confirmação, sem aviso de sucesso duplicado
      await p.click('bNao');
      await p.click('bSim');
      assert.ok(p.requests.filter(r => r.method === 'PATCH').every(r => !('status' in JSON.parse(r.body))));
    }
    assert.equal(vm.runInContext('atual.status', p.context), 'preparada');
  }
});

test('cancelar tentativa seguinte remove confirmação de compartilhamento anterior', async () => {
  let calls = 0;
  const p = await panel({ share: () => ++calls === 1 ? Promise.resolve() : Promise.reject(Object.assign(new Error('Cancelado'), { name: 'AbortError' })) });
  p.show(); await tick(); await p.click('bCompartilhar');
  assert.equal(p.nodes.get('dConfirma').hidden, false);
  await p.click('bCompartilhar');
  assert.equal(p.nodes.get('dConfirma').hidden, true);
  await p.click('bSim');
  assert.ok(p.requests.filter(r => r.method === 'PATCH').every(r => !('status' in JSON.parse(r.body))));
});

test('resultado atrasado não pergunta sobre publicação de outra oferta', async () => {
  let finish;
  const p = await panel({ share: () => new Promise(resolve => { finish = resolve; }) });
  p.show(); await tick(); const pending = p.click('bCompartilhar');
  p.show({ ...offer, id: 2 }); await tick(); finish(); await pending;
  assert.equal(p.nodes.get('dConfirma').hidden, true);
  await p.click('bSim');
  assert.ok(p.requests.filter(r => r.method === 'PATCH').every(r => !('status' in JSON.parse(r.body))));
});

test('prévia tem uma ação principal, alternativas discretas e funções extras recolhidas', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal((html.match(/>Compartilhar foto e legenda<\/button>/g) || []).length, 1);
  assert.match(html, /id="bCopiar" class="link"/);
  assert.match(html, /id="bBaixar" class="link"/);
  assert.match(html, /<details id="dOpcoes"[^>]*>\s*<summary>Mais opções<\/summary>/);
  assert.doesNotMatch(html, /id="bPublicada"|id="dAlternativa"/);
  assert.match(html, /id="dConfirma"[^>]*hidden/);
});
