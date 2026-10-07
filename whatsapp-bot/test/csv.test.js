import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readShopeeCsv } from '../src/csv-offers.js';

async function file(t, body) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopee-csv-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const filename = path.join(dir, 'offers.csv');
 await fs.writeFile(filename, body);
 return filename;
}
const header = '\uFEFFItem Id,Item Name,Price,Product Link,Offer Link\r\n';
test('Shopee CSV preserves affiliate link, accents, quoted commas and Brazilian prices', async t => {
 const filename = await file(t, header + '123,"Fone, edição especial","1.249,90",https://shopee.com.br/product/99/123,https://s.shopee.com.br/abc\r\n');
 const [deal] = await readShopeeCsv(filename);
 assert.equal(deal.title, 'Fone, edição especial');
 assert.equal(deal.price, 1249.9);
 assert.equal(deal.id, 'shopee:99:123');
 assert.equal(deal.affiliateUrl, 'https://s.shopee.com.br/abc');
});
test('invalid or mismatched CSV rows fail before any sending', async t => {
 for (const row of [
   '123,Fone,NaN,https://shopee.com.br/product/99/123,https://s.shopee.com.br/abc',
   '123,Fone,10,https://shopee.com.br/product/99/456,https://s.shopee.com.br/abc',
   '123,Fone,10,https://shopee.com.br/product/99/123,https://example.com/abc',
 ]) await assert.rejects(readShopeeCsv(await file(t, header + row)));
});
