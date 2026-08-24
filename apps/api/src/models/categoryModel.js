import mongoose from 'mongoose';
import { CATEGORY_COLORS, MAX_CATEGORY_NAME_LENGTH } from '@filler/shared';

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true, maxlength: MAX_CATEGORY_NAME_LENGTH },
    color: { type: String, required: true, enum: CATEGORY_COLORS },
  },
  { strict: 'throw', timestamps: true },
);

// A `strength: 1` a kisbetűt ÉS az ékezetet is egybemossa: „Étel" és „etel"
// ütközik. Ez szándékosan szigorúbb, mint a személyek `strength: 2`-je — két
// ember tényleg hívható Andrásnak és Andrasnak, két rovat nem.
categorySchema.index(
  { eventId: 1, name: 1 },
  { unique: true, collation: { locale: 'hu', strength: 1 } },
);

// Külön, collation nélküli index: a listázás megadja a collationt, tehát a
// fenti indexet használja, de a collation nélküli lekérdezések (az esemény
// törlésekor futó deleteMany) nem tudják — a MongoDB egy collationnel
// létrehozott indexet csak azonos collationt megadó művelethez használ.
categorySchema.index({ eventId: 1 });

export const CategoryModel = mongoose.model('Category', categorySchema);
