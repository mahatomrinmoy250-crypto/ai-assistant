import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../types';

interface JWTPayload {
  sub: string;      // Supabase Auth user UUID
  email: string;
  workspaceId?: string;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  // API key: "Bearer sk-..."
  if (authHeader.startsWith('Bearer sk-')) {
    await handleApiKey(req, res, next, authHeader.slice(7));
    return;
  }

  // JWT: "Bearer <token>"
  if (authHeader.startsWith('Bearer ')) {
    await handleJWT(req, res, next, authHeader.slice(7));
    return;
  }

  res.status(401).json({ error: 'Invalid authorization format' });
}

async function handleJWT(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  token: string
): Promise<void> {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JWTPayload;
    const userId = payload.sub;

    // Lookup workspace for this user
    let workspaceId = payload.workspaceId;
    if (!workspaceId) {
      const workspace = await prisma.workspace.findFirst({
        where: { ownerId: userId },
        select: { id: true },
      });
      workspaceId = workspace?.id;
    }

    if (!workspaceId) {
      res.status(403).json({ error: 'No workspace found for this user' });
      return;
    }

    req.user = { id: userId, email: payload.email, workspaceId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function handleApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  key: string
): Promise<void> {
  try {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { workspace: { select: { id: true, ownerId: true } } },
    });

    if (!apiKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Update last used timestamp (fire and forget)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    req.user = {
      id: apiKey.workspace.ownerId,
      email: '',
      workspaceId: apiKey.workspace.id,
    };
    next();
  } catch {
    res.status(500).json({ error: 'Authentication error' });
  }
}
