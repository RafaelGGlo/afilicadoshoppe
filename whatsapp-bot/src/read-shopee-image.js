import fs from 'node:fs/promises';
import { marketplaceUrl } from './affiliates.js';

const productUrl = marketplaceUrl(process.argv[2], 'shopee');
const itemId = new URL(productUrl).pathname.match(/\/(\d+)\/(\d+)\/?$/)?.[2];
if (!itemId) throw Error('Informe o Product Link do CSV da Shopee.');
const portFile = await fs.readFile('.browser-test/profile/DevToolsActivePort', 'utf8');
const port = Number(portFile.split(/\r?\n/)[0]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Porta do navegador inválida.');
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const tab = tabs.find(tab => tab.type === 'page' && new URL(tab.url).hostname === 'shopee.com.br');
if (!tab) throw Error('Abra o produto na janela de teste da Shopee.');
const endpoint = new URL(tab.webSocketDebuggerUrl);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port) throw Error('Endpoint do navegador inválido.');
const socket = new WebSocket(endpoint);
let timer;
try {
 await new Promise((resolve, reject) => {
   timer = setTimeout(() => reject(Error('Navegador não respondeu.')), 10000);
   socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
   socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Falha na conexão local com o navegador.')); }, { once: true });
 });
 const expression = `(() => {
   const url = new URL(location.href);
   if (!url.pathname.includes(${JSON.stringify(itemId)})) return { status: 'Abra o produto depois de fazer login.', imageUrl: null };
   const og = document.querySelector('meta[property="og:image"],meta[name="og:image"]')?.content;
   if (og) return { status: 'Imagem encontrada nos metadados do produto.', imageUrl: og };
   for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
     try {
       const data = JSON.parse(script.textContent);
       const entries = (Array.isArray(data) ? data : [data]).flatMap(item => item['@graph'] || [item]);
       const product = entries.find(item => [].concat(item['@type'] || []).includes('Product'));
       const image = Array.isArray(product?.image) ? product.image[0] : product?.image;
       const imageUrl = typeof image === 'string' ? image : image?.url;
       if (imageUrl) return { status: 'Imagem encontrada nos dados do produto.', imageUrl };
     } catch {}
   }
   return { status: 'Produto sem imagem nos metadados; é necessário analisar a galeria.', imageUrl: null,
     images: Array.from(document.images).filter(img => img.naturalWidth >= 200 && img.naturalHeight >= 200)
       .slice(0, 12).map(img => ({ url: img.currentSrc || img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight })) };
 })()`;
 const result = await new Promise((resolve, reject) => {
   timer = setTimeout(() => reject(Error('Tempo esgotado ao consultar a página.')), 10000);
   socket.addEventListener('message', event => {
     const message = JSON.parse(event.data);
     if (message.id !== 1) return;
     clearTimeout(timer);
     if (message.error || message.result?.exceptionDetails) reject(Error('Não foi possível ler os metadados do produto.'));
     else resolve(message.result.result.value);
   });
   socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
 });
 await fs.writeFile('.browser-test/image-result.json', JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result, null, 2));
 if (!result.imageUrl) process.exitCode = 2;
} finally {
 clearTimeout(timer);
 socket.close();
}
