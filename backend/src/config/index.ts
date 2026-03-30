import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    webhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL || '',
  },

  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
