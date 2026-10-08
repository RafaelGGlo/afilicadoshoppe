import { SentStore } from './store.js';
import { affiliateLink } from './affiliates.js';
import { downloadImage } from './media.js';
import { formatDeal } from './format.js';

export class OfferCooldown {
  constructor(file, ttlMs, now = Date.now) {
    this.history = new SentStore(file, ttlMs, now);
  }
  isDeferred(id) { return this.history.isDealSentToGroup(id, 'preparation'); }
  defer(id) { this.history.record(id, 'preparation', 'cooldown'); }
  prune() { this.history.prune(); }
}

// Only failures before sending are deferred. Uncertain sends retain
// their existing per-group reservations in sent_deals.json.
export async function prepareOffer(deal, {
  cooldown, headline = deal.headline,
  createLink = affiliateLink, createCaption = formatDeal, fetchImage = downloadImage,
}) {
  try {
    const link = await createLink(deal);
    const caption = createCaption({ ...deal, headline }, link);
    const image = await fetchImage(deal.imageUrl);
    return { image, caption };
  } catch (error) {
    if (!['EACCES', 'ENOSPC', 'EROFS', 'EIO'].includes(error.code)) cooldown.defer(deal.id);
    throw error;
  }
}
