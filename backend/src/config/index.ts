import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Vobiz Telephony
  vobiz: {
    apiKey: process.env.VOBIZ_API_KEY || '',
    apiBaseUrl: process.env.VOBIZ_API_BASE_URL || 'https://api.vobiz.ai/v1',
    webhookBaseUrl: process.env.VOBIZ_WEBHOOK_BASE_URL || '',
    defaultFromNumber: process.env.VOBIZ_FROM_NUMBER || '',
  },

  // Gemini Live API
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
