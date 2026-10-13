import sharp from 'sharp';
import fs from 'node:fs/promises';
import imageTools from '../../src/images.js';

const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const money = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export async function promotionalImage(offer, format, image = null, kind = 'promotional') {
 const height = format === 'story' ? 1920 : 1080;
 const bytes = image || (offer.imageFile ? await fs.readFile(offer.imageFile) : await imageTools.downloadImage(offer.imageUrl));
 if (kind === 'product') return sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize(1080, height, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
 const product = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize(880, height - 500, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
 const previous = Number(offer.previousPrice);
 const discount = previous > offer.price ? Math.round((1 - offer.price / previous) * 100) : Number(offer.discountRate) || 0;
 const lines = String(offer.title).match(/.{1,40}(?:\s|$)|.{1,40}/g)?.slice(0, 2) || [];
 const overlay = `<svg width="1080" height="${height}"><rect width="1080" height="${height}" fill="#11151e"/><rect x="60" y="50" width="960" height="${height - 430}" rx="25" fill="white"/>
 ${lines.map((s, i) => `<text x="60" y="${height - 330 + i * 48}" font-family="Arial" font-size="38" fill="white">${xml(s.trim())}</text>`).join('')}
 ${previous > offer.price ? `<text x="60" y="${height - 198}" font-family="Arial" font-size="30" fill="#adb5c5">De ${xml(money(previous))}</text>` : ''}
 <text x="60" y="${height - 115}" font-family="Arial" font-weight="bold" font-size="76" fill="#c3c6ff">${xml(money(offer.price))}</text>
 ${discount > 0 ? `<text x="780" y="${height - 125}" font-family="Arial" font-size="42" fill="#7ce3ad">-${Math.min(99, discount)}%</text>` : ''}
 <text x="60" y="${height - 45}" font-family="Arial" font-size="23" fill="#adb5c5">Oferta de afiliado • Preço e disponibilidade podem mudar</text></svg>`;
 return sharp(Buffer.from(overlay)).composite([{ input: product, left: 100, top: 70 }]).jpeg({ quality: 90 }).toBuffer();
}
