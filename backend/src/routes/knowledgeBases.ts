import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import {
  createKnowledgeBase,
  listKnowledgeBases,
  getKnowledgeBase,
  deleteKnowledgeBase,
  addDocument,
  deleteDocument,
  assignKbToAgent,
  removeKbFromAgent,
} from '../services/knowledge-base';

const router = Router();
router.use(authMiddleware);

// ─── Knowledge Bases ──────────────────────────────────────────────────────────

// GET /api/knowledge-bases
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const kbs = await listKnowledgeBases(req.user!.workspaceId);
    res.json(kbs);
  } catch {
    res.status(500).json({ error: 'Failed to list knowledge bases' });
  }
});

// POST /api/knowledge-bases
const createKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
});

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createKbSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const kb = await createKnowledgeBase(
      req.user!.workspaceId,
      parsed.data.name,
      parsed.data.description,
    );
    res.status(201).json(kb);
  } catch {
    res.status(500).json({ error: 'Failed to create knowledge base' });
  }
});

// GET /api/knowledge-bases/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const kb = await getKnowledgeBase(req.params.id as string, req.user!.workspaceId);
    if (!kb) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }
    res.json(kb);
  } catch {
    res.status(500).json({ error: 'Failed to get knowledge base' });
  }
});

// DELETE /api/knowledge-bases/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await deleteKnowledgeBase(req.params.id as string, req.user!.workspaceId);
    if (!result) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete knowledge base' });
  }
});

// ─── Documents ────────────────────────────────────────────────────────────────

// POST /api/knowledge-bases/:id/documents
// Body: { filename: string, content: string }
const addDocSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().min(1).max(500_000),
});

router.post('/:id/documents', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = addDocSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await addDocument(
      req.params.id as string,
      req.user!.workspaceId,
      parsed.data.filename,
      parsed.data.content,
    );
    res.status(201).json(result);
  } catch (err: any) {
    if (err.message === 'Knowledge base not found') {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error('[KB] addDocument error:', err);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

// DELETE /api/knowledge-bases/:id/documents/:docId
router.delete('/:id/documents/:docId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await deleteDocument(req.params.docId as string, req.user!.workspaceId);
    if (!result) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ─── Agent Assignment ─────────────────────────────────────────────────────────

// POST /api/knowledge-bases/:id/assign  { agentId }
router.post('/:id/assign', async (req: AuthenticatedRequest, res: Response) => {
  const { agentId } = req.body;
  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ error: 'agentId is required' });
    return;
  }

  try {
    const link = await assignKbToAgent(agentId, req.params.id as string, req.user!.workspaceId);
    res.status(201).json(link);
  } catch (err: any) {
    if (err.message === 'Agent or Knowledge Base not found') {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to assign knowledge base' });
  }
});

// DELETE /api/knowledge-bases/:id/assign/:agentId
router.delete('/:id/assign/:agentId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await removeKbFromAgent(
      req.params.agentId as string,
      req.params.id as string,
      req.user!.workspaceId,
    );
    if (!result) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    res.json({ removed: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove assignment' });
  }
});

export default router;
