import ExcelJS from 'exceljs';
import { marketplaceUrl } from './affiliates.js';

export async function readShopeeCsv(file) {
 const workbook = new ExcelJS.Workbook();
 const sheet = await workbook.csv.readFile(file, { map: value => value });
 const headers = sheet.getRow(1).values.slice(1).map(value => String(value).replace(/^\uFEFF/, '').trim());
 const required = ['Item Id', 'Item Name', 'Price', 'Product Link', 'Offer Link'];
 for (const name of required) if (!headers.includes(name)) throw Error(`Coluna ausente: ${name}`);
 const deals = [];
 const ids = new Set();
 sheet.eachRow((row, number) => {
   if (number === 1) return;
   const get = name => String(row.getCell(headers.indexOf(name) + 1).value ?? '').trim();
   const itemId = get('Item Id');
   const title = get('Item Name');
   const rawPrice = get('Price').replace(/^R\$\s*/, '').replace(/\s/g, '');
   const price = Number(rawPrice.includes(',') ? rawPrice.replace(/\./g, '').replace(',', '.') : rawPrice);
   if (!/^\d+$/.test(itemId) || !title || !Number.isFinite(price) || price <= 0) throw Error(`Dados inválidos na linha ${number}`);
   const productUrl = marketplaceUrl(get('Product Link'), 'shopee');
   const affiliateUrl = marketplaceUrl(get('Offer Link'), 'shopee');
   const match = new URL(productUrl).pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/);
   if (!match || match[2] !== itemId) throw Error(`Link e Item Id não correspondem na linha ${number}`);
   const id = `shopee:${match[1]}:${itemId}`;
   if (ids.has(id)) throw Error(`Produto repetido na linha ${number}`);
   ids.add(id);
   deals.push({ id, platform: 'shopee', title, price, productUrl, affiliateUrl });
 });
 if (!deals.length) throw Error('O CSV não contém ofertas.');
 return deals;
}
