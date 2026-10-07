import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { marketplaceUrl } from './affiliates.js';

const url = marketplaceUrl(process.argv[2], 'shopee');
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const browser = browsers.find(file => fs.existsSync(file));
if (!browser) throw Error('Chrome ou Edge não encontrado.');
const output = path.resolve('.browser-test');
fs.mkdirSync(output, { recursive: true });
const result = spawnSync(browser, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${path.join(output, 'profile')}`,
  '--virtual-time-budget=15000', '--dump-dom', url,
], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw Error('O navegador não concluiu o teste.');
fs.writeFileSync(path.join(output, 'page.html'), result.stdout, 'utf8');
const html = result.stdout;
const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
const imageMeta = metas.find(meta => /(?:property|name)=["']og:image["']/i.test(meta));
const imageUrl = imageMeta?.match(/content=["']([^"']+)/i)?.[1]?.replaceAll('&amp;', '&');
const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] || '';
const summary = {
  title,
  imageUrl: imageUrl || null,
  captchaVisible: /(?:captcha|verify|verification)[^<>]{0,100}(?:<\/h[1-6]>|<\/button>)/i.test(html),
  loginVisible: /(?:entre na shopee|faça login|log in to shopee)/i.test(html),
};
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (!imageUrl) process.exitCode = 2;
