import mongoose from 'mongoose';
import { SUPPORTED_CURRENCIES } from '@filler/shared';

const { Schema } = mongoose;

/**
 * Egy kiegyenlítés: `fromId` átadott `toId`-nak pénzt a tartozása rendezésére.
 *
 * Szándékosan SAJÁT kollekció, nem a kiadások egy „típusa": a kiadás
 * összköltségbe számít és osztozói vannak, ez viszont két személy közti
 * pénzmozgás. Egy közös kollekcióban minden kiadás-lekérdezésre (összköltség,
 * lista, integritási ellenőrzések) egy szűrőt kellene ráakasztani, és egy
 * elfelejtett szűrő azonnal hamis végösszeget adna.
 *
 * Nincs `note` hossz-validáció a sémán: azt a kérés Zod sémája adja (120
 * karakter), ahogy a kiadás leírásánál is.
 */
const settlementPaymentSchema = new Schema(
  {
    clientId: { type: String, required: false },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    date: { type: Date, required: true },
    fromId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    toId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, enum: SUPPORTED_CURRENCIES },
    exchangeRate: { type: String, required: true },
    rateSource: { type: String, required: true, enum: ['api', 'manual'] },
    rateFetchedAt: { type: Date, required: true },
    baseAmountMinor: { type: Number, required: true, min: 0 },
    note: { type: String, required: false, trim: true },
  },
  { strict: 'throw', timestamps: true },
);

settlementPaymentSchema.index({ eventId: 1, date: -1 });
// Ritka egyedi index: a mai (webes) felvitel nem küld clientId-t, de ugyanazt
// a clientId-t kétszer nem engedi be — ez készíti elő a későbbi offline
// sorbanállítást migráció nélkül.
settlementPaymentSchema.index({ clientId: 1 }, { unique: true, sparse: true });

export const SettlementPaymentModel = mongoose.model('SettlementPayment', settlementPaymentSchema);
