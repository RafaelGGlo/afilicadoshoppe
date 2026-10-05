const { getSettings, saveSettings, log } = require('./db');

// Roda uma consulta por vez (trava) e só dispara quando passou o intervalo configurado.
// Funciona SOMENTE enquanto o processo do Node estiver aberto.
function createRunner({ db, runSearch }) {
  let running = false;

  async function run(trigger, keyword = null) {
    if (running) return { busy: true };
    running = true;
    try {
      const summary = await runSearch({ keyword, trigger });
      if (trigger === 'auto') saveSettings(db, { lastAutoRunAt: new Date().toISOString() });
      return summary;
    } finally {
      running = false;
    }
  }

  function tick(nowMs = Date.now()) {
    const s = getSettings(db);
    if (!s.autoEnabled || running) return false;
    const every = Math.max(Number(s.autoEveryMinutes) || 0, 15) * 60000; // mínimo 15 min
    const last = s.lastAutoRunAt ? Date.parse(s.lastAutoRunAt) : 0;
    if (nowMs - last < every) return false;
    run('auto').catch(err => log(db, 'erro', `Consulta automática falhou: ${err.message}`));
    return true;
  }

  let timer = null;
  return {
    run,
    tick,
    isRunning: () => running,
    start() { if (!timer) { timer = setInterval(() => tick(), 60000); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { createRunner };
