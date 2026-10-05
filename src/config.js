const path = require('node:path');

function load() {
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  return {
    appId: (process.env.SHOPEE_APP_ID || '').trim(),
    secret: (process.env.SHOPEE_SECRET || '').trim(),
    endpoint: process.env.SHOPEE_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql',
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
    panelPassword: process.env.PANEL_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    dataDir,
    imagesDir: path.join(dataDir, 'images'),
    dbFile: path.join(dataDir, 'ofertas.db'),
    get demoMode() { return !(this.appId && this.secret); },
  };
}

module.exports = { load };
