import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { configuredMinSales, configuredCategories, matchesSalesFilter } from '../src/offer-filter.js';
const root=fileURLToPath(new URL('../',import.meta.url)); const example=dotenv.parse(fs.readFileSync(path.join(root,'.env.example')));
test('1. Exemplo e padrão da aplicação usam busca de um minuto', t => {
 assert.equal(example.CRON_INTERVAL,'* * * * *'); assert.ok(cron.validate(example.CRON_INTERVAL));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'config-default-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const env={...process.env,GROUP_IDS:'123@g.us'}; delete env.CRON_INTERVAL;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {config} from ${JSON.stringify(new URL('../src/config.js',import.meta.url).href)}; console.log(config.interval);`],{cwd:dir,env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr); assert.equal(result.stdout.trim(),example.CRON_INTERVAL);
});
test('2. Exemplo admite todas as categorias e nenhum mínimo de vendas',()=>{
 assert.equal(configuredMinSales(example),0); assert.deepEqual(configuredCategories(example),[]); assert.ok(matchesSalesFilter(undefined,configuredMinSales(example))); assert.equal(example.SHOPEE_OFFER_MODE,'discount-only');
});
test('3. Exemplo preserva intervalo de dez a quinze minutos e não contém credenciais reais',()=>{
 assert.equal(example.SEND_INTERVAL_MIN_MINUTES,'10'); assert.equal(example.SEND_INTERVAL_MAX_MINUTES,'15'); assert.equal(example.SHOPEE_APP_ID,''); assert.equal(example.SHOPEE_SECRET,''); assert.equal(example.DASHBOARD_ENABLED,'true');
});
