import { DEFAULT_OFFER_FILTERS, validateOfferFilters, filterActivity, CATEGORY_CHOICES, categoryChoice } from './filters.js';
const $ = id => document.getElementById(id);
let report = null, offset = 0, fetching = false, saving = false, stoppingRequested = false, controlFingerprint = null, offerFingerprint = null, controlRevision = 0;
const number = value => new Intl.NumberFormat('pt-BR').format(value || 0);
const money = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value) : '—';
const labels = { stopping: 'Encerrando o bot', paused: 'Envios pausados', control_error: 'Controle precisa de atenção', searching: 'Buscando ofertas', waiting: 'Aguardando intervalo', idle: 'Aguardando próxima busca', no_offers: 'Nenhuma oferta disponível', sending: 'Enviando oferta', blocked: 'Busca indisponível', error: 'Falha no último ciclo', stopped: 'Bot parado', starting: 'Iniciando', disconnected: 'WhatsApp desconectado', not_started: 'Aguardando o bot' };
function set(id, value) { $(id).textContent = value; }
function date(value, timeOnly = false) {
 if (!value) return '—';
 return new Intl.DateTimeFormat('pt-BR', { timeZone: report?.settings?.timezone || 'America/Sao_Paulo', ...(timeOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }).format(value);
}
function countdown() {
 const available = report?.startedAt && !report.stale && report.connection === 'online' && report.botRunning !== false && report.status !== 'stopped' && report.status !== 'stopping' && !report.botStopping && !stoppingRequested && !report.control?.paused;
 const deadline = report?.nextSendAt;
 $('countdown').classList.remove('ready');
 if (!available || !deadline) { set('countdown', '— : —'); set('nextSendText', 'Sem previsão de envio ativo'); return; }
 const remaining = Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
 if (!remaining) { set('countdown', 'Janela aberta'); $('countdown').classList.add('ready'); set('nextSendText', 'Envio permitido quando uma oferta estiver disponível'); }
 else { set('countdown', String(Math.floor(remaining / 60)).padStart(2, '0') + ' : ' + String(remaining % 60).padStart(2, '0')); set('nextSendText', 'Tempo mínimo restante para a próxima tentativa'); }
}
function activity() {
 const query = $('searchInput').value.trim().toLocaleLowerCase('pt-BR');
 const filter = $('statusFilter').value;
 const filters = { query, status: filter, period: $('periodFilter').value, group: $('groupFilter').value, minPrice: nullableNumber('historyMinPrice'), maxPrice: nullableNumber('historyMaxPrice'), from: $('historyFrom').value ? new Date($('historyFrom').value).getTime() : null, until: $('historyUntil').value ? new Date($('historyUntil').value).getTime() : null, sort: $('sortFilter').value };
 const invalid = (filters.minPrice !== null && filters.maxPrice !== null && filters.minPrice > filters.maxPrice) || (filters.from !== null && filters.until !== null && filters.from > filters.until);
 set('historyFilterFeedback', invalid ? 'Confira os limites: o mínimo/início não pode ser maior que o máximo/fim.' : '');
 const entries = invalid ? [] : filterActivity(report?.activity, filters, { now: Date.now() + offset, timezone: report?.settings?.timezone || 'America/Sao_Paulo' });
 const activeFilters = [query, filter !== 'all', filters.period !== 'all', filters.group !== 'all', filters.minPrice !== null, filters.maxPrice !== null, filters.from !== null, filters.until !== null].filter(Boolean).length;
 set('historyFilterSummary', activeFilters ? activeFilters + ' filtro(s) ativo(s)' : 'Nenhum filtro ativo');
 $('activityBody').replaceChildren();
 for (const entry of entries) {
  const row = document.createElement('tr');
  const product = document.createElement('td');
  const title = document.createElement('div'); title.className = 'product-title'; title.textContent = entry.title;
  const id = document.createElement('div'); id.className = 'product-id'; id.textContent = entry.dealId;
  product.append(title, id); row.append(product);
  const result = entry.type === 'sent' ? 'Confirmado' : entry.type === 'preparation_failed' ? 'Falha na preparação' : entry.reason === 'SEND_TIMEOUT' ? 'Sem confirmação' : 'Falha no envio';
  for (const [value, className] of [[money(entry.price), ''], [result, 'result-label' + (entry.type !== 'sent' ? ' error' : '')], [entry.group ? 'Grupo ' + entry.group : '—', ''], [date(entry.at), '']]) {
   const cell = document.createElement('td'); if (className) { const label = document.createElement('span'); label.textContent = value; label.className = className; cell.append(label); } else cell.textContent = value; row.append(cell);
  }
  $('activityBody').append(row);
 }
 $('emptyState').hidden = entries.length > 0;
 $('emptyState').textContent = report?.activity?.length ? 'Nenhum registro corresponde aos filtros.' : 'Os envios aparecerão aqui quando o bot começar a trabalhar.';
 set('activityCount', number(entries.length) + ' de ' + number(report?.activity?.length) + ' registros');
}
function render() {
 const active = Boolean(report.startedAt), totals = report.totals || {}, last = report.lastCycle, settings = report.settings || {};
 const discard = ['noDiscount', 'lowSales', 'invalid', 'filtered', 'duplicate'].reduce((sum, key) => sum + (totals[key] || 0), 0);
 set('sentCount', active ? number(totals.sent) : '—'); set('consultedCount', active ? number(totals.consulted) : '—');
 set('discardedCount', active ? number(discard) : '—'); set('failureCount', active ? number((totals.sendFailures || 0) + (totals.preparationFailures || 0) + (totals.apiErrors || 0)) : '—');
 const state = report.botStopping ? 'Encerrando o bot' : report.control?.paused && report.status !== 'stopped' && !report.stale ? 'Envios pausados' : report.stale ? 'Sem atualização do bot' : labels[report.status === 'paused' && !report.control?.paused ? 'waiting' : report.status] || 'Aguardando atualização';
 set('sendState', state); set('botState', state);
 set('botDetail', report.stale ? 'O último registro tem mais de 30 segundos. Verifique se o bot continua aberto.' : 'Os registros são atualizados automaticamente.');
 const pill = $('connectionPill'); pill.replaceChildren(); const dot = document.createElement('i');
 pill.append(dot, document.createTextNode(report.stale ? 'Sem atualização' : report.connection === 'online' ? 'WhatsApp conectado' : report.connection === 'connecting' ? 'Conectando WhatsApp' : 'WhatsApp desconectado'));
 pill.classList.toggle('online', !report.stale && report.connection === 'online');
 set('syncStatus', 'Atualizado às ' + date(report.serverTime, true));
 set('sendInterval', (settings.sendMinMinutes ?? 10) + ' a ' + (settings.sendMaxMinutes ?? 15) + ' minutos');
 set('nextSendTime', date(report.nextSendAt, true)); set('lastSearch', date(last?.finishedAt));
 set('groupCount', active ? number(settings.groupCount) : '—'); set('categories', settings.allCategories !== false ? 'Todas as categorias' : 'Categorias selecionadas');
 set('dedupHours', (settings.dedupHours ?? 24) + ' horas');
 set('searchDuration', last ? ((last.finishedAt - last.startedAt) / 1000).toFixed(1).replace('.', ',') + ' s' : '—');
 for (const [id, key] of [['lastConsulted', 'consulted'], ['lastEvaluated', 'evaluated'], ['lastValid', 'valid'], ['lastAlreadySent', 'alreadySent']]) set(id, last ? number(last[key]) : '—');
 set('reasonNoDiscount', last ? number(last.noDiscount) : '—'); set('reasonCooldown', last ? number(last.cooldown) : '—');
 set('reasonOther', last ? number((last.lowSales || 0) + (last.invalid || 0) + (last.filtered || 0) + (last.duplicate || 0)) : '—');
 set('searchNote', last ? 'Recebidos da API: ' + number(last.consulted) + '. Avaliados até atingir o limite do ciclo: ' + number(last.evaluated) + '.' : 'A primeira busca aparecerá aqui automaticamente.');
 $('notice').hidden = active && !report.stale;
 set('notice', report.stale ? 'O painel exibe os últimos registros disponíveis. O bot está sem atualização recente.' : 'O painel está pronto. Inicie o bot com npm.cmd start para registrar as buscas.');
 set('nextSearch', !report.stale && report.status !== 'stopped' ? date(report.nextSearchAt, true) : '—');
 const controls = report.control || { paused: false, minMinutes: settings.sendMinMinutes || 10, maxMinutes: settings.sendMaxMinutes || 15 };
 if (report.botRunning === false && !report.botStopping) stoppingRequested = false;
 $('stopButton').disabled = saving || stoppingRequested || report.botStopping || !report.stopEnabled || !report.botRunning;
 set('stopButton', report.botStopping || stoppingRequested ? 'PARANDO…' : 'PARAR BOT');
 $('pauseButton').disabled = saving || report.botStopping || !report.controlsEnabled;
 $('saveInterval').disabled = saving || report.botStopping || !report.controlsEnabled;
 set('pauseButton', controls.paused ? 'Retomar envios' : 'Pausar envios');
 set('controlDescription', controls.paused ? 'Novos envios pausados. As buscas continuam.' : 'Buscas continuam durante a pausa.');
 const fingerprint = JSON.stringify(controls);
 if (fingerprint !== controlFingerprint && !$('intervalForm').contains(document.activeElement)) { $('minMinutes').value = controls.minMinutes; $('maxMinutes').value = controls.maxMinutes; controlFingerprint = fingerprint; }
 $('latestOffers').replaceChildren();
 for (const offer of report.latestOffers || []) { const row = document.createElement('div'); row.className = 'latest-offer'; const title = document.createElement('span'); title.textContent = offer.title; const price = document.createElement('strong'); price.textContent = money(offer.price); row.append(title, price); $('latestOffers').append(row); }
 if (!report.latestOffers?.length) $('latestOffers').textContent = 'Nenhuma oferta elegível na última busca registrada.';
 if (['SHOPEE_AUTH','SHOPEE_CREDENTIALS'].includes(report.lastError)) { $('notice').hidden = false; set('notice', 'A Shopee recusou as credenciais ou permissões da API. Confira a configuração; essa falha não é repetida automaticamente dentro do ciclo.'); }
 else if (['SHOPEE_TIMEOUT','SHOPEE_UNAVAILABLE'].includes(report.lastError)) { $('notice').hidden = false; set('notice', 'A Shopee não respondeu após as tentativas limitadas. O bot tentará novamente na próxima busca.'); }
 const offers = controls.offerFilters || DEFAULT_OFFER_FILTERS;
 const choice = categoryChoice(offers.categories);
 if (!$('categoryChoice').contains(document.activeElement)) {
  $('categoryChoice').replaceChildren();
  for(const item of choice.key==='custom' ? [...CATEGORY_CHOICES,choice] : CATEGORY_CHOICES){const option=document.createElement('option');option.value=item.key;option.textContent=item.label;$('categoryChoice').append(option);}
  $('categoryChoice').value=choice.key;
 }
 $('categoryChoice').disabled=saving || report.botStopping || !report.controlsEnabled;
 set('categoryHelp', choice.key==='all' ? 'Itens aleatórios entre os resultados da API. Trocas valem na próxima busca; o ciclo atual pode concluir.' : 'A próxima busca usará '+choice.label+'. Uma busca já iniciada pode concluir com a categoria anterior.');
 const offerKey = JSON.stringify(offers);
 if (offerFingerprint !== offerKey && !$('offerFilterForm').contains(document.activeElement)) { fillOfferFilters(offers); offerFingerprint = offerKey; }
 $('saveOfferFilters').disabled = saving || report.botStopping || !report.controlsEnabled;
 $('clearOfferFilters').disabled = saving || report.botStopping || !report.controlsEnabled;
 const restrictions = [offers.minPrice !== null, offers.maxPrice !== null, offers.minDiscount > 0, offers.minSales > 0, offers.categories.length > 0, offers.includeKeywords, offers.excludeKeywords].filter(Boolean).length;
 set('offerFilterSummary', restrictions ? restrictions + ' restrição(ões) ativa(s)' : 'Sem restrições adicionais');
 const groupSelection = $('groupFilter').value;
 const groups = [...new Set([...(report.activity || []).map(entry => entry.group).filter(Number.isSafeInteger), ...Array.from({length: settings.groupCount || 0}, (_,index) => index+1)])].sort((a,b)=>a-b);
 $('groupFilter').replaceChildren();
 for(const [value,text] of [['all','Todos os grupos'],...groups.map(group=>[String(group),'Grupo '+group]),['none','Sem grupo']]) { const option=document.createElement('option'); option.value=value; option.textContent=text; $('groupFilter').append(option); }
 $('groupFilter').value = [...$('groupFilter').options].some(option=>option.value===groupSelection) ? groupSelection : 'all';
 countdown(); activity();
}
async function refresh() {
 if (fetching) return;
 fetching = true; $('refreshButton').disabled = true;
 try {
  const revision = controlRevision;
  const response = await fetch('/api/report', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error('report unavailable');
  const incoming = await response.json();
  if (revision !== controlRevision && report) incoming.control = report.control;
  report = incoming; offset = report.serverTime - Date.now(); render();
 } catch {
  if (report) { report.stale = true; render(); }
  set('syncStatus', 'Painel sem conexão'); $('notice').hidden = false;
  set('notice', 'Não foi possível atualizar os registros. Uma nova tentativa será feita automaticamente.');
 } finally { fetching = false; $('refreshButton').disabled = false; }
}
$('refreshButton').addEventListener('click', refresh);
$('searchInput').addEventListener('input', activity); $('statusFilter').addEventListener('change', activity);
setInterval(refresh, 5000); setInterval(countdown, 1000); refresh();

async function updateControl(patch) {
 if (saving || !report?.controlsEnabled) return;
 saving = true; render();
 try {
  const response = await fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Control-Token': report.controlToken }, body: JSON.stringify(patch), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error();
  const saved = await response.json(); report.control = { ...report.control, ...saved }; controlRevision++;
  set('controlFeedback', report.stale || !report.startedAt || report.status === 'stopped' ? 'Configuração salva para a próxima inicialização do bot.' : patch.offerFilters ? 'Filtros salvos para a próxima busca. A busca em andamento pode concluir.' : 'Configuração salva. O bot aplica em até um segundo; envios em andamento podem concluir.');
  controlFingerprint = null; offerFingerprint = null;
 } catch { set('controlFeedback', 'Não foi possível salvar. Confira os valores e tente novamente.'); }
 finally { saving = false; render(); await refresh(); }
}
$('pauseButton').addEventListener('click', () => updateControl({ paused: !report.control?.paused }));
$('intervalForm').addEventListener('submit', event => { event.preventDefault(); const minMinutes = Number($('minMinutes').value), maxMinutes = Number($('maxMinutes').value); if (!Number.isSafeInteger(minMinutes) || !Number.isSafeInteger(maxMinutes) || minMinutes < 1 || maxMinutes < minMinutes || maxMinutes > 1440) { set('controlFeedback', 'Use minutos inteiros entre 1 e 1440; o máximo deve ser maior ou igual ao mínimo.'); return; } updateControl({ minMinutes, maxMinutes }); });

async function stopBot() {
 if (saving || stoppingRequested || !report?.botRunning || !report.stopEnabled) return;
 saving = true; $('stopButton').disabled = true;
 try {
  const response = await fetch('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Control-Token': report.controlToken }, body: '{}', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error();
  const result = await response.json(); stoppingRequested = result.status === 'stopping';
  set('controlFeedback', stoppingRequested ? 'Parada solicitada. Novos envios serão bloqueados; uma tentativa em andamento pode concluir.' : 'O bot já está parado.');
  if (stoppingRequested) { report.botStopping = true; set('stopButton', 'PARANDO…'); countdown(); }
 } catch { set('controlFeedback', 'Não foi possível solicitar a parada. Atualize o painel e tente novamente.'); }
 finally { saving = false; await refresh(); }
}
$('stopButton').addEventListener('click', stopBot);

function nullableNumber(id) { return $(id).value.trim() === '' ? null : Number($(id).value); }
function fillOfferFilters(filters) {
 $('offerMinPrice').value = filters.minPrice ?? ''; $('offerMaxPrice').value = filters.maxPrice ?? '';
 $('offerMinDiscount').value = filters.minDiscount; $('offerMinSales').value = filters.minSales;
 $('offerInclude').value = filters.includeKeywords; $('offerExclude').value = filters.excludeKeywords;

}
$('offerFilterForm').addEventListener('submit',event=>{
 event.preventDefault();
 try { const offerFilters=validateOfferFilters({ minPrice:nullableNumber('offerMinPrice'),maxPrice:nullableNumber('offerMaxPrice'),minDiscount:Number($('offerMinDiscount').value),minSales:Number($('offerMinSales').value),categories:[...(report?.control?.offerFilters?.categories || [])],includeKeywords:$('offerInclude').value,excludeKeywords:$('offerExclude').value }); updateControl({offerFilters}); }
 catch(error){set('controlFeedback',error.message);}
});
$('clearOfferFilters').addEventListener('click',()=>{fillOfferFilters(DEFAULT_OFFER_FILTERS);updateControl({offerFilters:{...DEFAULT_OFFER_FILTERS,categories:[]}});});
for(const id of ['periodFilter','groupFilter','historyMinPrice','historyMaxPrice','historyFrom','historyUntil','sortFilter']) $(id).addEventListener('input',activity);
$('clearHistoryFilters').addEventListener('click',()=>{
 for(const id of ['searchInput','historyMinPrice','historyMaxPrice','historyFrom','historyUntil']) $(id).value='';
 for(const id of ['statusFilter','periodFilter','groupFilter']) $(id).value='all'; $('sortFilter').value='newest';activity();
});

$('categoryChoice').addEventListener('change',()=>{
 const selected=CATEGORY_CHOICES.find(choice=>choice.key===$('categoryChoice').value);
 if(selected) updateControl({offerFilters:{...(report?.control?.offerFilters || DEFAULT_OFFER_FILTERS),categories:[...selected.ids]}});
});
