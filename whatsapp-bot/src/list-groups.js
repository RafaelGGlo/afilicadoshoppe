import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
let socket;
let writes = Promise.resolve();
let stopped = false;
let reconnect;

async function stop() {
  stopped = true;
  clearTimeout(reconnect);
  socket?.end(Error('Finished listing groups'));
  await writes;
}

function connect() {
  if (stopped) return;
  const current = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), markOnlineOnConnect: false });
  socket = current;
  current.ev.on('creds.update', () => {
    writes = writes.then(saveCreds).catch(async () => {
      console.error('Não foi possível salvar a sessão.');
      process.exitCode = 1;
      await stop();
    });
  });
  current.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (stopped || socket !== current) return;
    if (qr) {
      console.log('WhatsApp > Configurações > Aparelhos conectados > Conectar aparelho');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      try {
        const groups = await current.groupFetchAllParticipating();
        console.table(Object.values(groups).map(group => ({ Grupo: group.subject, ID: group.id })));
        console.log('Copie os IDs desejados para GROUP_IDS no arquivo .env, separados por vírgulas.');
      } catch {
        console.error('Não foi possível consultar os grupos. Execute novamente.');
        process.exitCode = 1;
      } finally {
        await stop();
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = Object.entries(DisconnectReason).find(([name, value]) => typeof value === 'number' && value === code)?.[0] || 'unknown';
      console.error(`Conexão encerrada: ${reason} (código ${code ?? 'indisponível'}).`);
      if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code)) {
        if (code === DisconnectReason.connectionReplaced) {
          console.error('Feche outras instâncias deste bot e execute npm.cmd run groups novamente.');
        } else if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
          console.error('A sessão salva precisa ser vinculada novamente. Preserve auth_info como backup antes de criar uma nova sessão.');
        } else {
          console.error('O WhatsApp recusou a conexão. Verifique a conta e a compatibilidade da conexão antes de tentar novamente.');
        }
        process.exitCode = 1;
        await stop();
      } else {
        reconnect = setTimeout(connect, 2000);
      }
    }
  });
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
connect();
