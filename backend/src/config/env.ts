import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const localEnv = resolve(process.cwd(), '.env');
dotenv.config({ path: existsSync(localEnv) ? localEnv : resolve(process.cwd(), '../.env') });

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  GROQ_API_KEY: z.string().optional().default(''),
  ADMIN_REVIEW_TOKEN: z.string().refine((value) => !value || value.length >= 32, 'ADMIN_REVIEW_TOKEN must be empty or at least 32 characters').optional().default(''),
  GROQ_VISION_MODEL: z.string().default('qwen/qwen3.6-27b'),
  UPLOAD_DIRECTORY: z.string().default(`${process.cwd()}/private_uploads`),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  MAX_COOK_RETRIES: z.coerce.number().int().nonnegative().default(2),
  MAX_DELIVERY_RETRIES: z.coerce.number().int().nonnegative().default(2),
  MAX_USER_RETRIES: z.coerce.number().int().nonnegative().default(4),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
}

export const env = parsed.data;
