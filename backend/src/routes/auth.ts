import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router = Router();

// Supabase Admin client (service role — server-side only)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Helper: create a platform JWT with workspaceId
 */
function createPlatformToken(userId: string, email: string, workspaceId: string): string {
  return jwt.sign(
    { sub: userId, email, workspaceId },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
  );
}

// ─── Register ────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
});

/**
 * POST /api/auth/register
 * Creates user in Supabase Auth + workspace in DB, returns platform JWT.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = RegisterSchema.parse(req.body);

    // Create user in Supabase Auth (admin API, no email confirmation)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm for now
      user_metadata: { name: name || email.split('@')[0] },
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes('already') || msg.includes('exists')) {
        res.status(409).json({ error: 'An account with this email already exists' });
      } else {
        console.error('[Auth] Supabase create user error:', authError);
        res.status(400).json({ error: authError.message });
      }
      return;
    }

    const userId = authData.user.id;

    // Create workspace
    const workspace = await prisma.workspace.create({
      data: {
        ownerId: userId,
        name: (name || email.split('@')[0]) + "'s Workspace",
      },
    });

    const token = createPlatformToken(userId, email, workspace.id);

    res.status(201).json({
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
      console.error('[Auth] Register error:', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

// ─── Login ───────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().optional(),
  supabaseToken: z.string().optional(),
});

/**
 * POST /api/auth/workspace-token
 * Two modes:
 *   1. { email, password } → sign in via Supabase, return platform JWT
 *   2. { supabaseToken }   → exchange Supabase JWT for platform JWT
 */
router.post('/workspace-token', async (req: Request, res: Response) => {
  try {
    const body = LoginSchema.parse(req.body);

    let userId: string;
    let email: string;

    if (body.email && body.password) {
      // Mode 1: Email + password login via Supabase
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      if (error || !data.user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      userId = data.user.id;
      email = data.user.email || body.email;
    } else if (body.supabaseToken) {
      // Mode 2: Exchange Supabase JWT
      const jwtSecret = process.env.SUPABASE_JWT_SECRET || config.jwt.secret;
      try {
        const payload = jwt.verify(body.supabaseToken, jwtSecret) as { sub: string; email: string };
        userId = payload.sub;
        email = payload.email;
      } catch {
        res.status(401).json({ error: 'Invalid Supabase token' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Provide email+password or supabaseToken' });
      return;
    }

    // Find or create workspace
    let workspace = await prisma.workspace.findFirst({
      where: { ownerId: userId },
    });

    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          ownerId: userId,
          name: email.split('@')[0] + "'s Workspace",
        },
      });
    }

    const token = createPlatformToken(userId, email, workspace.id);

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
      select: {
        id: true, name: true, creditsBalance: true, createdAt: true,
        vobizAuthId: true, vobizAuthToken: true, vobizBaseUrl: true, vobizFromNumber: true,
      },
    });
    res.json({ userId: req.user!.id, email: req.user!.email, workspace });
  } catch {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PATCH /api/auth/workspace — update workspace settings (name, Vobiz credentials)
router.patch('/workspace', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      vobizAuthId: z.string().optional(),
      vobizAuthToken: z.string().optional(),
      vobizBaseUrl: z.string().url().optional(),
      vobizFromNumber: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const workspace = await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data,
      select: {
        id: true, name: true, creditsBalance: true,
        vobizAuthId: true, vobizAuthToken: true, vobizBaseUrl: true, vobizFromNumber: true,
      },
    });
    res.json(workspace);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to update workspace' });
    }
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
    const keyPrefix = rawKey.slice(0, 10);

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        keyPrefix,
        workspaceId: req.user!.workspaceId,
      },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });

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
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });

    if (!apiKey) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await prisma.apiKey.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
