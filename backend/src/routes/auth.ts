import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * Auth model: Supabase Auth handles user identity.
 * After Supabase login, the frontend exchanges the Supabase JWT for our
 * platform JWT which includes workspaceId.
 *
 * POST /api/auth/workspace-token
 * Accepts a Supabase JWT, looks up the workspace, returns our platform JWT.
 *
 * On first login (new user), we auto-create a workspace.
 */

const WorkspaceTokenSchema = z.object({
  supabaseToken: z.string(),
  workspaceName: z.string().optional(),
});

// POST /api/auth/workspace-token
// Exchange Supabase JWT → platform JWT with workspaceId
router.post('/workspace-token', async (req: Request, res: Response) => {
  try {
    const { supabaseToken, workspaceName } = WorkspaceTokenSchema.parse(req.body);

    // Verify the Supabase JWT (uses same JWT_SECRET or SUPABASE_JWT_SECRET)
    const jwtSecret = process.env.SUPABASE_JWT_SECRET || config.jwt.secret;
    let payload: { sub: string; email: string };

    try {
      payload = jwt.verify(supabaseToken, jwtSecret) as { sub: string; email: string };
    } catch {
      res.status(401).json({ error: 'Invalid Supabase token' });
      return;
    }

    const { sub: userId, email } = payload;

    // Find or create workspace
    let workspace = await prisma.workspace.findFirst({
      where: { ownerId: userId },
    });

    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          ownerId: userId,
          name: workspaceName || email.split('@')[0] + "'s Workspace",
        },
      });
    }

    const token = jwt.sign(
      { sub: userId, email, workspaceId: workspace.id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
    );

    res.json({
      token,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        creditsBalance: workspace.creditsBalance,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error('[Auth] workspace-token error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { id: true, name: true, creditsBalance: true, createdAt: true },
    });
    res.json({ userId: req.user!.id, email: req.user!.email, workspace });
  } catch {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// GET /api/auth/api-keys
router.get('/api-keys', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId: req.user!.workspaceId },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(keys);
  } catch {
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

// POST /api/auth/api-keys
router.post('/api-keys', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);

    const rawKey = `sk-${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 10); // "sk-" + 7 chars

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        keyPrefix,
        workspaceId: req.user!.workspaceId,
      },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });

    // Return the raw key ONCE — it won't be retrievable again
    res.status(201).json({ ...apiKey, key: rawKey });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to create API key' });
    }
  }
});

// DELETE /api/auth/api-keys/:id
router.delete('/api-keys/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });

    if (!apiKey) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await prisma.apiKey.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
