import mongoose from 'mongoose';

const { Schema } = mongoose;

const RATE_CACHE_TTL_SECONDS = 60 * 60 * 24;

const rateCacheSchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    date: { type: String, required: true },
    rate: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { strict: 'throw', timestamps: true },
);

rateCacheSchema.index({ from: 1, to: 1, date: 1 }, { unique: true });
rateCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: RATE_CACHE_TTL_SECONDS });

export const RateCacheModel = mongoose.model('RateCache', rateCacheSchema);
