import mongoose from 'mongoose';
import { SETTLEMENT_CURRENCY, SUPPORTED_CURRENCIES } from '@filler/shared';

const { Schema } = mongoose;

function hasUniqueElements(ids) {
  return new Set(ids.map(String)).size === ids.length;
}

const eventSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Csak a kiadás-modal alapértelmezett pénznem-kijelöléséhez — az
    // elszámolás mindig SETTLEMENT_CURRENCY-ben történik, ettől függetlenül.
    defaultCurrency: {
      type: String,
      required: true,
      default: SETTLEMENT_CURRENCY,
      enum: SUPPORTED_CURRENCIES,
    },
    participantIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
      required: true,
      validate: [
        {
          validator: (ids) => ids.length >= 2,
          message: 'Legalább 2 résztvevő szükséges.',
        },
        {
          validator: hasUniqueElements,
          message: 'A résztvevők nem szerepelhetnek duplikáltan.',
        },
      ],
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    archived: { type: Boolean, default: false },
  },
  { strict: 'throw', timestamps: true },
);

eventSchema.index({ participantIds: 1 });

export const EventModel = mongoose.model('Event', eventSchema);
