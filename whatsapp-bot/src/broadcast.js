import { randomInt } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
export function createBroadcaster({ store, groups, minMs, maxMs, getSocket, logger, pacing, onResult = () => {},
 sleep = pause, now = Date.now, sendTimeoutMs = 45000, setTimer = setTimeout, clearTimer = clearTimeout }) {
 let nextAttempt = 0;
 return async function broadcast(deal, image, caption) {
   for (const group of groups) {
     if (store.isDealSentToGroup(deal.id, group)) continue;
     if (pacing && !pacing.canSend()) break;
     await sleep(Math.max(0, nextAttempt - now()));
     const sock = getSocket();
     if (!sock) break;
     // Reserve before sending. A timeout cannot cancel a message already
     // accepted by WhatsApp, so uncertain sends must remain reserved.
     if (pacing && !pacing.claim()) break;
     store.reserve(deal.id, group);
     let sent = false, timer;
     try {
       await Promise.race([
         Promise.resolve().then(() => sock.sendMessage(group, { image, caption })),
         new Promise((_, reject) => {
           timer = setTimer(() => {
             const error = Error('WhatsApp send timed out');
             error.code = 'SEND_TIMEOUT';
             reject(error);
           }, sendTimeoutMs);
         }),
       ]);
       sent = true;
     } catch (error) {
       logger.warn({ group, dealId: deal.id, reason: error.code || error.name }, 'Send failed; reservation retained to avoid duplicates');
       onResult({ type: 'send_failed', title: deal.title, price: deal.price, dealId: deal.id, group: groups.indexOf(group) + 1, reason: error.code });
     } finally {
       clearTimer(timer);
       nextAttempt = now() + randomInt(minMs, maxMs + 1);
     }
     if (sent) { store.markDealAsSent(deal.id, group); logger.info({ group, dealId: deal.id }, 'Sent');
       onResult({ type: 'sent', title: deal.title, price: deal.price, dealId: deal.id, group: groups.indexOf(group) + 1 });
     }
   }
 };
}
