import { randomInt } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
export function createBroadcaster({ store, groups, minMs, maxMs, getSocket, logger, sleep = pause, now = Date.now }) {
 let nextAttempt = 0;
 return async function broadcast(deal, image, caption) {
   for (const group of groups) {
     if (store.isDealSentToGroup(deal.id, group)) continue;
     await sleep(Math.max(0, nextAttempt - now()));
     const sock = getSocket();
     if (!sock) break;
     // Disk reservation BEFORE network send: uncertain failures remain suppressed for TTL.
     // A persistence failure is fatal to this batch, preventing unsafe further sends.
     store.reserve(deal.id, group);
     let sent = false;
     try {
       await sock.sendMessage(group, { image, caption });
       sent = true;
     } catch { logger.warn({ group, dealId: deal.id }, 'Send failed; reservation retained to avoid duplicates'); }
     finally { nextAttempt = now() + randomInt(minMs, maxMs + 1); }
     if (sent) { store.markDealAsSent(deal.id, group); logger.info({ group, dealId: deal.id }, 'Sent'); }
   }
 };
}
