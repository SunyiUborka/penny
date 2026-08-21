import mongoose from 'mongoose';
import { SUPPORTED_CURRENCIES } from '@filler/shared';

const { Schema } = mongoose;

/**
 * Egy számla egy tétele. Nincs saját `_id`-je (`_id: false`): a tételek
 * mindig a kiadással együtt íródnak, önállóan nem hivatkozzuk őket.
 */
const expenseItemSchema = new Schema(
  {
    description: { type: String, required: false, trim: true },
    amountMinor: { type: Number, required: true, min: 1 },
    baseAmountMinor: { type: Number, required: true, min: 0 },
    sharedWithIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
      required: true,
      validate: [
        {
          validator: (ids) => ids.length >= 1,
          message: 'A tételen legalább egy osztozó szükséges.',
        },
      ],
    },
  },
  { _id: false },
);

const expenseSchema = new Schema(
  {
    clientId: { type: String, required: false },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    date: { type: Date, required: true },
    description: { type: String, required: true, trim: true },
    payerId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, enum: SUPPORTED_CURRENCIES },
    exchangeRate: { type: String, required: true },
    rateSource: { type: String, required: true, enum: ['api', 'manual'] },
    rateFetchedAt: { type: Date, required: true },
    baseAmountMinor: { type: Number, required: true, min: 0 },
    sharedWithIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
      required: true,
      validate: [
        {
          validator: (ids) => ids.length >= 1,
          message: 'Legalább egy osztozó szükséges.',
        },
      ],
    },
    /**
     * `default: undefined` — enélkül a Mongoose üres tömböt írna a tétel
     * nélküli kiadásokba, a válaszséma pedig `min(1)`-et követel: a mai,
     * egyszerű kiadások GET-je hasalna el a saját sémáján.
     */
    items: { type: [expenseItemSchema], required: false, default: undefined },
  },
  { strict: 'throw', timestamps: true },
);

expenseSchema.index({ eventId: 1, date: -1 });
// Ritka egyedi index: a clientId nélküli (webes) kiadásokat nem érinti, de
// ugyanazt a clientId-t kétszer nem engedi be.
expenseSchema.index({ clientId: 1 }, { unique: true, sparse: true });

export const ExpenseModel = mongoose.model('Expense', expenseSchema);
