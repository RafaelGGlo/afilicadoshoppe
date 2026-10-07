import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
export async function connectWhatsApp(logger, onReady) {
 const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
 let current, ready = false, stopped = false, timer, attempts = 0;
 let writes = Promise.resolve();
 async function open() {
  if (stopped) return;
  try {
   const sock = makeWASocket({ auth: state, logger, markOnlineOnConnect: false });
   current = sock;
   sock.ev.on('creds.update', () => {
     writes = writes.then(saveCreds).catch(() => { logger.fatal('Cannot persist credentials'); stopped = true; ready = false; sock.end(Error('Auth persistence failed')); });
   });
   sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
     if (stopped || current !== sock) return;
     if (qr) qrcode.generate(qr, { small: true });
     if (connection === 'open') { ready = true; attempts = 0; logger.info('WhatsApp connected'); onReady?.(); }
     if (connection === 'close') {
       ready = false;
       const code = lastDisconnect?.error?.output?.statusCode;
       if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code)) {
         stopped = true; logger.error({ code }, 'Connection stopped; inspect session/account before restart'); return;
       }
       schedule();
     }
   });
  } catch { ready = false; logger.error('Connection initialization failed'); schedule(); }
 }
 function schedule() {
   if (stopped || timer) return;
   const wait = Math.min(60000, 2000 * 2 ** Math.min(attempts++, 5));
   timer = setTimeout(() => { timer = undefined; void open(); }, wait);
 }
 await open();
 return { getSocket: () => ready && !stopped ? current : null,
   stop: async () => { stopped = true; ready = false; clearTimeout(timer); current?.end(Error('Shutdown')); await writes; } };
}
