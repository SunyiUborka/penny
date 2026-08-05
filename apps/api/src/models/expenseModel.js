import mongoose from 'mongoose';
import { SUPPORTED_CURRENCIES } from '@filler/shared';

const { Schema } = mongoose;

const expenseSchema = new Schema(
  {
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
  },
  { strict: 'throw', timestamps: true },
);

expenseSchema.index({ eventId: 1, date: -1 });

export const ExpenseModel = mongoose.model('Expense', expenseSchema);
