import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../types';

interface JWTPayload {
  userId: string;
  email: string;
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

  // Support both Bearer token (JWT) and API key (prefix: "sk-")
  if (authHeader.startsWith('Bearer sk-')) {
    await handleApiKey(req, res, next, authHeader.slice(7));
    return;
  }

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
    req.user = { id: payload.userId, email: payload.email };
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
    const apiKey = await prisma.apiKey.findUnique({
      where: { key },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!apiKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsed: new Date() },
    });

    req.user = { id: apiKey.user.id, email: apiKey.user.email };
    next();
  } catch {
    res.status(500).json({ error: 'Authentication error' });
  }
}
