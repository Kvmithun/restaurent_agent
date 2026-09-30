import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (attempt) => attempt > 3 ? null : Math.min(attempt * 250, 1000),
});
redis.on('error', (error) => console.error(JSON.stringify({ event: 'redis.connection_error', message: error.message })));

export async function connectInfrastructure(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  await redis.connect();
}
