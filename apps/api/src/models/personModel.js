import mongoose from 'mongoose';

const { Schema } = mongoose;

const personSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { strict: 'throw', timestamps: true },
);

personSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const PersonModel = mongoose.model('Person', personSchema);
