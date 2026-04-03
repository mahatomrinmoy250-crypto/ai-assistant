import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { setupCallWebSocket } from './websocket/call-ws';
import { startWebhookWorker } from './lib/queue';
import { startCampaignWorker } from './lib/campaignWorker';
import { getActiveSessionCount } from './services/call-session';
import authRoutes from './routes/auth';
import assistantsRoutes from './routes/assistants';
import callsRoutes from './routes/calls';
import phoneNumbersRoutes from './routes/phoneNumbers';
import knowledgeBasesRoutes from './routes/knowledgeBases';
import campaignsRoutes from './routes/campaigns';
import contactListsRoutes from './routes/contactLists';
import bookingsRoutes from './routes/bookings';

const app = express();
const httpServer = createServer(app);

// WebSocket server (shares HTTP server)
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
});

setupCallWebSocket(wss);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: [config.frontendUrl, 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    serverId: config.serverId,
    activeCalls: getActiveSessionCount(),
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assistants', assistantsRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/phone-numbers', phoneNumbersRoutes);
app.use('/api/knowledge-bases', knowledgeBasesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/contact-lists', contactListsRoutes);
app.use('/api/bookings', bookingsRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start BullMQ workers
const webhookWorker = startWebhookWorker();
const campaignWorker = startCampaignWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  await webhookWorker.close();
  await campaignWorker.close();
  httpServer.close(() => process.exit(0));
});

// Start server
httpServer.listen(config.port, () => {
  console.log(`[Server] Voice AI Platform running on http://localhost:${config.port}`);
  console.log(`[Server] Server ID: ${config.serverId}`);
  console.log(`[Server] WebSocket server ready at ws://localhost:${config.port}/ws`);
  console.log(`[Server] Environment: ${config.nodeEnv}`);
});

export default app;
