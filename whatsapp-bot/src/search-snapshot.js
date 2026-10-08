import { validateOfferFilters } from '../dashboard/filters.js';
export function snapshotOfferFilters(filters) {
 const snapshot = validateOfferFilters(filters);
 Object.freeze(snapshot.categories);
 return Object.freeze(snapshot);
}
