const activity = document.getElementById('activity');
const section = document.createElement('section'); section.id = 'instagram'; section.className = 'card';
section.innerHTML = `<div class="section-top"><h2>Instagram</h2><span id="ig-mode" class="badge">Carregando</span></div>
<p class="ig-muted">Calendário de ofertas · Horários de Brasília (America/Sao_Paulo). Clique em um dia para agendar.</p>
<div class="ig-actions"><p class="ig-muted">Solicitação manual: 15/10/2026 às 12:00 (Brasília).</p><button class="button" id="ig-request">Preparar este agendamento</button></div>
<div class="ig-toolbar"><div class="ig-actions"><button class="button" id="ig-prev" aria-label="Período anterior">←</button><strong id="ig-period"></strong><button class="button" id="ig-next" aria-label="Próximo período">→</button><button class="button" id="ig-today">Hoje</button></div><div class="ig-actions"><select id="ig-view" aria-label="Visualização"><option value="month">Mensal</option><option value="week">Semanal</option></select><button class="button" id="ig-new">Agendar post</button><button class="button" id="ig-refresh">Atualizar</button></div></div>
<details class="ig-settings"><summary>Modos e agendamento automático</summary><form id="ig-settings-form">
<div><label><input type="checkbox" id="ig-manualEnabled">Agendamento manual</label><label><input type="checkbox" id="ig-autoEnabled">Agendamento automático</label></div>
<div><label><input type="checkbox" id="ig-manualPublish">Publicação manual habilitada</label><label><input type="checkbox" id="ig-autoPublish">Publicação automática habilitada</label></div>
<div><label>Hora <input type="number" id="ig-autoHour" min="0" max="23" required></label><label>Minuto <input type="number" id="ig-autoMinute" min="0" max="59" required></label><label>Dias <input type="number" id="ig-autoDays" min="1" max="30" required></label><label>Formato <select id="ig-autoFormat"><option value="feed">Feed</option><option value="story">Stories (Business)</option></select></label></div>
<p class="ig-muted">O automático usa ofertas com link de afiliado existente, uma por dia, sem repetir produtos. A publicação requer aprovação inicial e o servidor em execução. Fechar a aba não interrompe o agendador.</p>
<div class="ig-actions"><button class="button" type="submit">Salvar modos</button><button class="button" type="button" id="ig-auto">Preencher calendário</button></div></form></details>
<p class="ig-message" id="ig-message" role="status"></p><div class="ig-calendar" id="ig-calendar" aria-label="Calendário de publicações"></div>
<dialog class="ig-editor" id="ig-dialog"><div class="section-top"><h2 id="ig-editor-title">Agendar post</h2><button class="button" id="ig-close" type="button">Fechar</button></div><div class="ig-editor-layout"><form id="ig-post-form">
<p class="ig-muted" id="ig-editor-mode">Modo: manual</p>
<label>Data e horário (Brasília)<input type="datetime-local" id="ig-at" required></label><label>Produto<select id="ig-offer" required></select></label>
<label>Formato<select id="ig-format"><option value="feed">Feed · 1080 × 1080</option><option value="story">Story · 1080 × 1920 (Business)</option></select></label>
<label>Imagem<select id="ig-image"><option value="promotional">Arte promocional com preço e desconto</option><option value="product">Imagem do produto</option></select></label>
<label>Legenda<textarea id="ig-caption" maxlength="2200" required></textarea></label><p class="ig-muted">O preço anterior aparece apenas quando informado para a mesma variante. O desconto pode vir da API. Links na legenda do feed não são clicáveis.</p>
<div class="ig-actions"><button class="button" id="ig-save" type="submit">Salvar e gerar prévia</button><button class="button" id="ig-test" type="button">Testar sem publicar</button><button class="button stop-button" id="ig-cancel" type="button">Cancelar post</button></div><p id="ig-editor-message" class="ig-message" role="status"></p>
</form><aside><img id="ig-preview" class="ig-preview" alt="Prévia da publicação" hidden><p id="ig-summary" class="ig-summary">Salve o agendamento para gerar a prévia.</p></aside></div></dialog>`;
activity.append(section);
const nav = document.querySelector('nav'); const link = document.createElement('a'); link.href = '#instagram'; link.className = 'nav-item'; link.textContent = 'Instagram'; nav.append(link);
const $ = id => document.getElementById('ig-' + id);
const labels = { scheduled: 'Agendado', published: 'Publicado', failed: 'Falhou', cancelled: 'Cancelado' };
let state, selected = null, cursor = new Date(), view = 'month';
const dateKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
const inputTime = at => new Intl.DateTimeFormat('sv-SE', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(at)).replace(' ', 'T');
async function api(route = '', method = 'GET', body) {
 const response = await fetch('/api/instagram' + route, { method, headers: { 'Content-Type':'application/json', 'X-Control-Token': state?.controlToken || '' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
 const result = await response.json(); if (!response.ok) throw Error(result.error || 'Não foi possível concluir.'); return result;
}
async function refresh() {
 try {
  state = await api(); $('mode').textContent = state.testMode ? 'TESTE · sem publicação' : 'PUBLICAÇÃO AUTORIZADA';
  for (const [key,value] of Object.entries(state.settings)) if ($(key)) { if (typeof value === 'boolean') $(key).checked = value; else $(key).value = value; }
  $('autoFormat').querySelector('[value=story]').disabled = !state.storiesSupported && !state.testMode;
  $('message').textContent = `${state.posts.length} posts · ${state.offers.length} ofertas disponíveis. ${state.credentialsConfigured ? 'Credenciais configuradas.' : 'Credenciais Meta pendentes; prévias disponíveis.'}`;
  render();
 } catch (error) { $('message').textContent = error.message; }
}
function render() {
 const grid = $('calendar'); grid.replaceChildren();
 const base = new Date(dateKey(cursor) + 'T12:00:00-03:00');
 if (view === 'month') base.setUTCDate(1);
 const start = new Date(base); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
 const count = view === 'month' ? 42 : 7;
 $('period').textContent = view === 'month' ? base.toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}) : `Semana de ${start.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
 for (const day of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']) { const el = document.createElement('div'); el.className = 'ig-calendar-heading'; el.textContent = day; grid.append(el); }
 for (let i = 0; i < count; i++) {
  const date = new Date(start); date.setUTCDate(start.getUTCDate()+i); const key = dateKey(date);
  const cell = document.createElement('div'); cell.className = 'ig-day' + (key === dateKey(new Date()) ? ' ig-today' : '');
  const add = document.createElement('button'); add.type = 'button'; add.textContent = `${date.getUTCDate()}/${date.getUTCMonth()+1} +`; add.setAttribute('aria-label','Agendar em '+key); add.onclick = () => edit(null, key); cell.append(add);
  for (const post of state.posts.filter(p => dateKey(new Date(p.at)) === key)) {
   const event = document.createElement('button'); event.type = 'button'; event.className = 'ig-event'; event.dataset.status = post.status;
   event.textContent = `${inputTime(post.at).slice(11)} · ${post.format === 'story' ? 'Story' : 'Feed'} · ${post.snapshot.title}\n${labels[post.status]} · ${post.mode === 'auto' ? 'Auto' : 'Manual'}`;
   event.onclick = () => edit(post); cell.append(event);
  }
  grid.append(cell);
 }
}
function caption() {
 const offer = state.offers.find(o=>o.id === $('offer').value); if (!offer) return;
 $('caption').value = `${offer.title}\n${offer.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\n${offer.affiliateUrl || ''}\n#ofertas #afiliado`;
}
function edit(post, day = dateKey(new Date())) {
 if (!state) return; selected = post?.id || null;
 $('editor-title').textContent = post ? 'Editar / visualizar post' : 'Agendar post';
 $('editor-mode').textContent = post?.mode === 'auto' ? 'Modo: automático' : 'Modo: manual';
 $('offer').replaceChildren();
 for (const o of state.offers) { const option = document.createElement('option'); option.value = o.id; option.textContent = `${o.title} · R$ ${o.price.toFixed(2)}`; $('offer').append(option); }
 if (post && !state.offers.some(o=>o.id===post.offer_id)) { const option = document.createElement('option'); option.value=post.offer_id; option.textContent=post.snapshot.title+' (oferta indisponível)'; $('offer').append(option); }
 $('at').value = post ? inputTime(post.at) : day + 'T12:00'; $('offer').value = post?.offer_id || state.offers[0]?.id || '';
 $('format').value = post?.format || 'feed'; $('image').value = post?.snapshot.imageKind || 'promotional';
 if (post) $('caption').value = post.caption; else caption();
 const locked = post && (post.status !== 'scheduled' || post.attempted);
 for (const id of ['at','offer','format','image','caption','save']) $(id).disabled = Boolean(locked);
 $('test').disabled = !post; $('cancel').disabled = !post || !['scheduled','failed'].includes(post.status) || Boolean(post.attempted);
 $('preview').hidden = !post; if (post) $('preview').src = post.previewUrl + '?v=' + Date.now();
 $('summary').textContent = post ? `${labels[post.status]} · ${post.mode === 'auto' ? 'Automático' : 'Manual'}\n${post.error || ''}\n${post.published_id ? 'ID Meta: '+post.published_id : ''}` : 'Salve para gerar a prévia. Nenhuma publicação será feita por este formulário.';
 $('editor-message').textContent = ''; if (!$('dialog').open) $('dialog').showModal();
}
$('offer').onchange = caption;
$('close').onclick = () => $('dialog').close();
$('new').onclick = () => edit(null);
$('request').onclick = () => { cursor = new Date('2026-10-15T12:00:00-03:00'); render(); edit(null, '2026-10-15'); };
$('refresh').onclick = refresh;
$('today').onclick = () => { cursor = new Date(); render(); };
$('view').onchange = () => { view = $('view').value; render(); };
for (const [name,dir] of [['prev',-1],['next',1]]) $(name).onclick = () => { if (view==='month') { cursor.setUTCDate(1); cursor.setUTCMonth(cursor.getUTCMonth()+dir); } else cursor.setUTCDate(cursor.getUTCDate()+dir*7); render(); };
$('post-form').onsubmit = async event => {
 event.preventDefault(); $('save').disabled = true;
 try { const post = await api(selected ? '/posts/'+selected : '/posts', selected ? 'PUT' : 'POST', { offerId:$('offer').value, at:$('at').value+':00-03:00', format:$('format').value, imageKind:$('image').value, caption:$('caption').value }); await refresh(); edit(post); $('editor-message').textContent='Agendamento salvo. Prévia pronta; nenhum envio realizado.'; }
 catch(error) { $('editor-message').textContent=error.message; } finally { $('save').disabled=false; }
};
$('test').onclick = async () => { try { const result=await api('/posts/'+selected+'/test','POST',{}); $('editor-message').textContent=result.message; } catch(error) { $('editor-message').textContent=error.message; } };
$('cancel').onclick = async () => { try { await api('/posts/'+selected+'/cancel','POST',{}); $('dialog').close(); await refresh(); } catch(error) { $('editor-message').textContent=error.message; } };
$('settings-form').onsubmit = async event => { event.preventDefault(); try { const patch={}; for(const key of ['manualEnabled','autoEnabled','manualPublish','autoPublish']) patch[key]=$(key).checked; for(const key of ['autoHour','autoMinute','autoDays']) patch[key]=Number($(key).value); patch.autoFormat=$('autoFormat').value; await api('/settings','POST',patch); await refresh(); } catch(error) { $('message').textContent=error.message; } };
$('auto').onclick = async () => { $('auto').disabled=true; try { const result=await api('/auto','POST',{}); await refresh(); $('message').textContent=`${result.created.length} posts agendados. Nenhuma publicação solicitada.`; } catch(error) { $('message').textContent=error.message; } finally { $('auto').disabled=false; } };
await refresh();
setInterval(() => { if (!$('dialog').open && !document.querySelector('.ig-settings[open]') && !document.activeElement?.closest('.ig-settings')) void refresh(); }, 30000);
