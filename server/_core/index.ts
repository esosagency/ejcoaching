import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { registerOAuthRoutes } from './oauth';
import { publicPlatformScript } from './publicConfig';
import { appRouter } from '../routers';
import { contentReadiness } from '../contentDb';
import { createContext } from './context';
import { serveStatic, setupVite } from './vite';

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Uploaded bytes go directly to durable storage; API bodies contain only metadata.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', async (_req, res) => {
    try {
      const state = await contentReadiness();
      const ready = state.database && state.seeded;
      res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'preparation-required', ...state });
    } catch {
      res.status(503).json({ status: 'database-unavailable' });
    }
  });
  app.get('/api/platform/config.js', (_req, res) => {
    res.type('application/javascript').send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  app.use('/api/trpc', createExpressMiddleware({ router: appRouter, createContext }));
  if (process.env.NODE_ENV === 'development') await setupVite(app, server);
  else serveStatic(app);
  const port = Number(process.env.PORT || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  server.on('error', error => { console.error('Server failed:', error.message); process.exit(1); });
  server.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`));
}
startServer().catch(error => { console.error(error); process.exit(1); });
