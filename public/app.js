'use strict';

const $ = id => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TXT = { preparada: 'Preparada', revisao: 'Precisa de revisão', publicada: 'Publicada', descartada: 'Descartada' };
let atual = null; // oferta aberta no diálogo
let imagemCompartilhar = null;
let estadoImagemCompartilhar = 'none';
let versaoImagemCompartilhar = 0;
let compartilhamentoConcluido = null;
let compartilhando = false;
let editandoManual = null;

async function api(url, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'painel' } };
  if (raw) { opts.body = raw; }
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (res.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error('Sessão expirada. Entre de novo.'); }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function precoTxt(o) {
  const { priceMin: a, priceMax: b } = o;
  if (a == null && b == null) return 'Preço no link';
  const lo = a ?? b, hi = b ?? a;
  return lo === hi ? brl.format(lo) : `a partir de ${brl.format(Math.min(lo, hi))}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent: nunca interpreta HTML vindo da API
  return e;
}

/* ---------- login / sessão ---------- */
function mostrarLogin() {
  $('telaPainel').hidden = true; $('telaLogin').hidden = false; $('btnSair').hidden = true;
}

async function iniciar() {
  const s = await api('/api/session');
  if (s.needsLogin && !s.logged) return mostrarLogin();
  $('telaLogin').hidden = true; $('telaPainel').hidden = false; $('btnSair').hidden = !s.needsLogin;
  const st = await api('/api/status');
  $('avisoDemo').hidden = !st.demoMode;
  const b = $('badgeModo');
  b.hidden = false; b.textContent = st.demoMode ? 'Manual • API demo' : 'Manual • API real';
  b.className = 'badge' + (st.demoMode ? ' demo' : '');
  await Promise.all([carregarConfig(), carregarOfertas()]);
}

$('formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: $('senha').value } });
    $('senha').value = ''; $('erroLogin').hidden = true;
    iniciar();
  } catch (err) { $('erroLogin').textContent = err.message; $('erroLogin').hidden = false; }
});
$('btnSair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); mostrarLogin(); });

/* ---------- abas ---------- */
document.querySelectorAll('.abas button').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.abas button').forEach(b => b.classList.toggle('ativa', b === btn));
  ['ofertas', 'manual', 'buscar', 'config', 'historico'].forEach(n => { $('aba-' + n).hidden = n !== btn.dataset.aba; });
  if (btn.dataset.aba === 'historico') carregarHistorico();
  if (btn.dataset.aba === 'ofertas') carregarOfertas();
}));

/* ---------- lista de ofertas ---------- */
async function carregarOfertas() {
  const q = new URLSearchParams();
  if ($('filtroStatus').value) q.set('status', $('filtroStatus').value);
  if ($('filtroTexto').value.trim()) q.set('q', $('filtroTexto').value.trim());
  const { offers } = await api('/api/offers?' + q);
  const box = $('listaOfertas');
  box.replaceChildren();
  $('vazioOfertas').hidden = offers.length > 0;
  for (const o of offers) {
    const card = el('button', 'oferta');
    card.type = 'button';
    const foto = el('div', 'foto');
    if (o.imageUrl) { const img = el('img'); img.src = o.imageUrl; img.alt = ''; img.loading = 'lazy'; foto.append(img); }
    else foto.textContent = 'Sem imagem';
    const info = el('div', 'info');
    const tag = el('span', 'tag ' + o.status, STATUS_TXT[o.status] || o.status);
    if (o.source === 'demo') tag.append(el('span', 'tag demo', 'DEMO'));
    else tag.append(el('span', 'tag', o.source === 'manual' ? 'Manual' : 'API'));
    info.append(tag, el('div', 'nome', o.name), el('div', 'preco', precoTxt(o)), el('div', 'link', o.affiliateLink || 'sem link'));
    card.append(foto, info);
    card.addEventListener('click', () => abrir(o.id));
    box.append(card);
  }
}
$('filtroStatus').addEventListener('change', carregarOfertas);
let tFiltro; $('filtroTexto').addEventListener('input', () => { clearTimeout(tFiltro); tFiltro = setTimeout(carregarOfertas, 300); });

/* ---------- busca ---------- */
$('formBusca').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('btnBuscar'), res = $('resBusca');
  btn.disabled = true; res.hidden = false; res.textContent = 'Consultando…';
  try {
    const r = await api('/api/search', { method: 'POST', body: { keyword: $('buscaKeyword').value } });
    let t = `${r.created} oferta(s) nova(s); ${r.skippedDuplicate} repetida(s) ignorada(s); ${r.skippedPrice} fora da faixa de preço.`;
    if (r.mode === 'demo') t += ' (DEMONSTRAÇÃO — dados simulados)';
    if (r.errors.length) t += ' Erros: ' + r.errors.join(' | ');
    res.textContent = t;
  } catch (err) { res.textContent = err.message; }
  btn.disabled = false;
});

/* ---------- configurações ---------- */
async function carregarConfig() {
  const s = await api('/api/settings');
  $('cKeywords').value = s.keywords.join('\n');
  $('cCategorias').value = s.categoryIds.join(', ');
  $('cPrecoMin').value = s.priceMin; $('cPrecoMax').value = s.priceMax;
  $('cSort').value = s.sortType; $('cMax').value = s.maxPerRun;
  $('cPaginas').value = s.pagesPerQuery; $('cDedupe').value = s.dedupeDays;
  $('cSubIds').value = s.subIds.join(', ');
  $('cAuto').checked = s.autoEnabled; $('cAutoMin').value = s.autoEveryMinutes;
  $('cTemplate').value = s.template;
}
$('formConfig').addEventListener('submit', async e => {
  e.preventDefault();
  const res = $('resConfig'); res.hidden = false;
  try {
    await api('/api/settings', { method: 'PUT', body: {
      keywords: $('cKeywords').value, categoryIds: $('cCategorias').value,
      priceMin: $('cPrecoMin').value, priceMax: $('cPrecoMax').value,
      sortType: $('cSort').value, maxPerRun: $('cMax').value,
      pagesPerQuery: $('cPaginas').value, dedupeDays: $('cDedupe').value,
      subIds: $('cSubIds').value, autoEnabled: $('cAuto').checked,
      autoEveryMinutes: $('cAutoMin').value, template: $('cTemplate').value,
    } });
    res.textContent = 'Configurações salvas.';
    await carregarConfig();
  } catch (err) { res.textContent = err.message; }
});

/* ---------- histórico ---------- */
async function carregarHistorico() {
  const { history } = await api('/api/history?limit=150');
  const ul = $('listaHistorico'); ul.replaceChildren();
  if (!history.length) ul.append(el('li', 'mudo', 'Nada registrado ainda.'));
  for (const h of history) {
    const li = el('li', h.kind === 'erro' ? 'erro-item' : '',
      `${new Date(h.at).toLocaleString('pt-BR')} — [${h.kind}${h.mode ? '/' + h.mode : ''}] ${h.message}`);
    ul.append(li);
  }
}

/* ---------- diálogo de prévia ---------- */
const msg = t => { $('dMsg').textContent = t || ''; $('dMsg').hidden = !t; };

function preencher(o) {
  atual = o;
  compartilhamentoConcluido = null;
  $('dOpcoes').open = false;
  $('dMudarStatus').value = '';
  msg('');
  imagemCompartilhar = null;
  const versao = ++versaoImagemCompartilhar;
  estadoImagemCompartilhar = o.imageUrl ? 'loading' : 'none';
  $('bCompartilhar').disabled = !!o.imageUrl;
  $('bCompartilhar').textContent = o.imageUrl ? 'Preparando imagem…' : 'Compartilhar foto e legenda';
  if (o.imageUrl) fetch(o.imageUrl + '?v=' + encodeURIComponent(o.updatedAt))
    .then(r => { if (!r.ok) throw new Error('Imagem indisponível.'); return r.blob(); })
    .then(blob => {
      if (versao !== versaoImagemCompartilhar) return;
      if (!blob.size || blob.type !== 'image/jpeg') throw new Error('Imagem indisponível.');
      imagemCompartilhar = new File([blob], `oferta-${o.id}.jpg`, { type: 'image/jpeg' });
      estadoImagemCompartilhar = 'ready';
    })
    .catch(() => { if (versao === versaoImagemCompartilhar) estadoImagemCompartilhar = 'error'; })
    .finally(() => {
      if (versao !== versaoImagemCompartilhar) return;
      $('bCompartilhar').disabled = false;
      $('bCompartilhar').textContent = 'Compartilhar foto e legenda';
    });
  $('dNome').textContent = o.name;
  $('dStatus').textContent = `Status: ${STATUS_TXT[o.status]} • ${o.source === 'manual' ? 'Manual' : o.source === 'demo' ? 'DEMONSTRAÇÃO' : 'API'}${o.category ? ' • ' + o.category : ''}`;
  $('bEditar').hidden = o.source !== 'manual';
  $('bAtualizar').hidden = o.source === 'manual';
  $('dRevisao').hidden = !(o.reviewReason && (o.status === 'revisao'));
  $('dRevisao').textContent = o.reviewReason || '';
  $('dImg').hidden = !o.imageUrl;
  if (o.imageUrl) $('dImg').src = o.imageUrl + '?v=' + encodeURIComponent(o.updatedAt);
  $('dSemImg').hidden = !!o.imageUrl;
  $('dImgNota').textContent = o.imageNote || '';
  $('dLegenda').value = o.caption || '';
  $('dFonte').textContent = `Dados ${o.source === 'manual' ? 'cadastrados' : 'consultados'} em ${new Date(o.fetchedAt).toLocaleString('pt-BR')}. Preço e disponibilidade podem mudar.`;
  $('dConfirma').hidden = true;
}

async function abrir(id) {
  atual = null;
  compartilhamentoConcluido = null;
  imagemCompartilhar = null;
  ++versaoImagemCompartilhar;
  $('bCompartilhar').disabled = true;
  $('dConfirma').hidden = true;
  msg('Atualizando dados antes de preparar a publicação…');
  if (!$('dlg').open) $('dlg').showModal();
  try {
    // Atualiza os dados na Shopee antes da publicação final.
    const r = await api(`/api/offers/${id}/finalize`, { method: 'POST' });
    preencher(r.offer);
    msg('');
  } catch (err) {
    try { preencher(await api(`/api/offers/${id}`)); } catch { /* ignora */ }
    msg('Não consegui atualizar os dados agora: ' + err.message);
  }
}
$('dFechar').addEventListener('click', () => $('dlg').close());
$('dlg').addEventListener('close', () => {
  atual = null;
  imagemCompartilhar = null;
  ++versaoImagemCompartilhar;
  compartilhamentoConcluido = null;
  $('dConfirma').hidden = true;
  carregarOfertas();
});

async function salvarLegenda() {
  atual = await api(`/api/offers/${atual.id}`, { method: 'PATCH', body: { caption: $('dLegenda').value } });
}
$('bSalvar').addEventListener('click', async () => { try { await salvarLegenda(); msg('Legenda salva.'); } catch (e) { msg(e.message); } });
$('bModelo').addEventListener('click', async () => {
  try { preencher(await api(`/api/offers/${atual.id}/caption/reset`, { method: 'POST' })); msg('Legenda refeita pelo modelo.'); } catch (e) { msg(e.message); }
});
$('bAtualizar').addEventListener('click', async () => {
  try { const r = await api(`/api/offers/${atual.id}/finalize`, { method: 'POST' }); preencher(r.offer); msg(r.note); } catch (e) { msg(e.message); }
});

async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    const ta = el('textarea'); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* sem suporte */ }
    ta.remove(); return ok;
  }
}
$('bCopiar').addEventListener('click', async () => msg((await copiarTexto($('dLegenda').value)) ? 'Legenda copiada.' : 'Não consegui copiar. Selecione o texto e copie manualmente.'));

async function pegarImagem() {
  if (!atual.imageUrl) throw new Error('Esta oferta não tem imagem. Envie uma manualmente.');
  const r = await fetch(atual.imageUrl);
  if (!r.ok) throw new Error('Não consegui carregar a imagem.');
  return r.blob();
}

$('bBaixar').addEventListener('click', async () => {
  try {
    const blob = await pegarImagem();
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `oferta-${atual.id}.jpg`;
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    msg('Imagem baixada.');
  } catch (e) { msg(e.message); }
});

function alternativaCompartilhar(motivo) {
  msg(motivo + ' Use Baixar imagem e Copiar legenda; no WhatsApp, anexe a foto e cole em Adicionar legenda antes de enviar.');
}

$('bCompartilhar').addEventListener('click', async () => {
  if (!atual || compartilhando) return;
  const oferta = atual;
  const versao = versaoImagemCompartilhar;
  const texto = $('dLegenda').value;
  const mesmaPrevia = () => atual?.id === oferta.id && versaoImagemCompartilhar === versao;
  $('dConfirma').hidden = true;
  compartilhamentoConcluido = null;
  msg('');
  if (!texto.trim()) return msg('Preencha a legenda antes de compartilhar a foto.');
  if (!imagemCompartilhar) {
    return alternativaCompartilhar(estadoImagemCompartilhar === 'loading'
      ? 'A imagem ainda está carregando. Aguarde e clique novamente.'
      : 'Não foi possível preparar a foto para compartilhar. Substitua a imagem ou use as opções abaixo.');
  }
  // Um único arquivo e a legenda completa, com o link dentro do texto.
  // Não adiciona url/title nem abre um envio separado de texto.
  const dados = { files: [imagemCompartilhar], text: texto };
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' ||
        !navigator.canShare({ files: dados.files }) || !navigator.canShare({ text: dados.text }) || !navigator.canShare(dados)) {
      return alternativaCompartilhar('Este navegador não suporta compartilhar foto e legenda juntas.');
    }
    $('bCompartilhar').disabled = true;
    compartilhando = true;
    // Sem await de rede/clipboard antes desta chamada: preserva o gesto do clique.
    await navigator.share(dados);
  } catch (e) {
    if (mesmaPrevia()) {
      if (e.name === 'AbortError') msg('Compartilhamento cancelado.');
      else alternativaCompartilhar('Não foi possível compartilhar foto e legenda juntas.');
    }
    return;
  } finally {
    compartilhando = false;
    if (mesmaPrevia()) $('bCompartilhar').disabled = false;
  }
  if (mesmaPrevia()) {
    compartilhamentoConcluido = { id: oferta.id, versao };
    $('dConfirma').hidden = false; // A API não confirma envio nem publicação.
    msg('');
  }
  // Salva a legenda compartilhada, sem alterar o estado nem depender da prévia atual.
  try {
    const salva = await api(`/api/offers/${oferta.id}`, { method: 'PATCH', body: { caption: texto } });
    if (mesmaPrevia() && $('dLegenda').value === texto) atual = { ...atual, caption: salva.caption };
  } catch (e) {
    if (mesmaPrevia()) msg('Não consegui salvar a legenda: ' + e.message);
  }
});

$('bSim').addEventListener('click', () => {
  if (compartilhamentoConcluido?.id !== atual?.id || compartilhamentoConcluido?.versao !== versaoImagemCompartilhar) return;
  compartilhamentoConcluido = null;
  $('dConfirma').hidden = true;
  return mudarStatus('publicada');
});
$('bNao').addEventListener('click', () => { $('dConfirma').hidden = true; compartilhamentoConcluido = null; });
$('dMudarStatus').addEventListener('change', e => {
  if (e.target.value) mudarStatus(e.target.value);
  e.target.value = '';
});

async function mudarStatus(status) {
  try { preencher(await api(`/api/offers/${atual.id}`, { method: 'PATCH', body: { status } })); msg('Status: ' + STATUS_TXT[status]); }
  catch (e) { msg(e.message); }
}

$('dArquivo').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { msg('Enviando imagem…'); preencher(await api(`/api/offers/${atual.id}/image`, { method: 'POST', raw: f })); msg('Imagem enviada.'); }
  catch (err) { msg(err.message); }
});

function novoManual() {
  editandoManual = null;
  $('formManual').reset();
  $('mTitulo').textContent = 'Cadastrar oferta manual';
  $('mMsg').textContent = '';
  $('mImagemNota').textContent = 'Escolha upload ou URL. Imagens pequenas não são ampliadas e ficam para revisão.';
}
$('mLimpar').addEventListener('click', novoManual);
$('bEditar').addEventListener('click', () => {
  const o = atual;
  novoManual(); editandoManual = o.id;
  $('mMesmaVariante').checked = o.sameVariant === true;
  for (const [field, key] of Object.entries({ mNome: 'name', mLink: 'affiliateLink', mMin: 'priceMin', mMax: 'priceMax', mAnterior: 'previousPrice', mCupom: 'coupon', mCondicoes: 'couponConditions', mObs: 'observations', mCategoria: 'category' })) $('' + field).value = o[key] ?? '';
  $('mTitulo').textContent = 'Editar oferta manual #' + o.id;
  $('mImagemNota').textContent = 'A imagem atual será mantida se você não escolher outra. Salvar refaz a legenda e exige nova confirmação de publicação.';
  $('dlg').close();
  document.querySelector('[data-aba="manual"]').click();
});
$('bDuplicar').addEventListener('click', async () => {
  try { const o = await api(`/api/offers/${atual.id}/duplicate`, { method: 'POST' }); preencher(o); msg('Oferta duplicada. Revise antes de publicar.'); }
  catch (e) { msg(e.message); }
});
$('formManual').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('mPreparar'); btn.disabled = true; $('mMsg').textContent = 'Preparando imagem e legenda…';
  try {
    const body = {};
    body.sameVariant = $('mMesmaVariante').checked;
    for (const [field, key] of Object.entries({ mNome: 'name', mLink: 'affiliateLink', mMin: 'priceMin', mMax: 'priceMax', mAnterior: 'previousPrice', mCupom: 'coupon', mCondicoes: 'couponConditions', mObs: 'observations', mCategoria: 'category', mImagemUrl: 'imageUrl' })) body[key] = $(field).value;
    const file = $('mArquivo').files[0];
    if (file && body.imageUrl) throw new Error('Escolha upload ou URL, não os dois.');
    if (file) {
      if (file.size > 6 * 1024 * 1024) throw new Error('Imagem grande demais (máx. 6 MB).');
      body.imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Não consegui ler o arquivo.')); reader.readAsDataURL(file);
      });
    }
    const o = await api('/api/manual' + (editandoManual ? '/' + editandoManual : ''), { method: editandoManual ? 'PUT' : 'POST', body });
    novoManual(); $('mMsg').textContent = 'Oferta salva. Confira a prévia.';
    await carregarOfertas();
    preencher(o); $('dlg').showModal();
  } catch (err) { $('mMsg').textContent = err.message; }
  finally { btn.disabled = false; }
});

iniciar().catch(err => { document.body.append(el('p', 'erro', 'Falha ao iniciar: ' + err.message)); });
