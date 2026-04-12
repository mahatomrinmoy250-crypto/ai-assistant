import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  serverId: process.env.SERVER_ID || `srv-${process.pid}`,

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Supabase PostgreSQL
  database: {
    url: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL || '',
  },

  // Redis (Upstash recommended for India scale)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // Vobiz Telephony
  vobiz: {
    authId: process.env.VOBIZ_AUTH_ID || '',
    authToken: process.env.VOBIZ_AUTH_TOKEN || '',
    apiBaseUrl: process.env.VOBIZ_API_BASE_URL || 'https://api.vobiz.ai',
    webhookBaseUrl: process.env.VOBIZ_WEBHOOK_BASE_URL || '',
    defaultFromNumber: process.env.VOBIZ_FROM_NUMBER || '',
  },

  // Gemini Live API
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
