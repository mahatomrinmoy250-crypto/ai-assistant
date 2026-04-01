import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;          // Supabase Auth user UUID (ownerId)
    email: string;
    workspaceId: string;
  };
}
