import dotenv from 'dotenv';
import path from 'path';

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  
  // UrbaneBolt
  URBANEBOLT_USERNAME: process.env.URBANEBOLT_USERNAME || '',
  URBANEBOLT_PASSWORD: process.env.URBANEBOLT_PASSWORD || '',
  URBANEBOLT_BASE_URL: process.env.URBANEBOLT_BASE_URL || 'https://uat.urbanebolt.in',

  // Background Worker
  QUEUE_POLL_INTERVAL_MS: parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '2000', 10),
  CONCURRENCY_LIMIT: parseInt(process.env.CONCURRENCY_LIMIT || '5', 10),

  // HTTP Retry Config
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
  HTTP_TIMEOUT_MS: parseInt(process.env.HTTP_TIMEOUT_MS || '10000', 10),
};

// Validate required configurations
const required = ['DATABASE_URL', 'URBANEBOLT_USERNAME', 'URBANEBOLT_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) {
    console.warn(`WARNING: Missing environment variable ${key}`);
  }
}
