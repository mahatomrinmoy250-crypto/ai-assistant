import { GoogleGenAI } from '@google/genai';
import { prisma } from '../lib/prisma';
import { config } from '../config';

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

const EMBEDDING_MODEL = 'text-embedding-004';
const CHUNK_SIZE = 500;      // characters per chunk
const CHUNK_OVERLAP = 50;    // overlap between chunks
const TOP_K = 5;             // chunks to return per search

// ─── Embedding ────────────────────────────────────────────────────────────────

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return response.embeddings?.[0]?.values ?? [];
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── KB Management ────────────────────────────────────────────────────────────

export async function createKnowledgeBase(
  workspaceId: string,
  name: string,
  description: string,
) {
  return prisma.knowledgeBase.create({
    data: { workspaceId, name, description },
  });
}

export async function listKnowledgeBases(workspaceId: string) {
  return prisma.knowledgeBase.findMany({
    where: { workspaceId },
    include: { _count: { select: { documents: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getKnowledgeBase(id: string, workspaceId: string) {
  return prisma.knowledgeBase.findFirst({
    where: { id, workspaceId },
    include: {
      documents: { orderBy: { createdAt: 'desc' } },
      agents: { include: { agent: { select: { id: true, name: true } } } },
    },
  });
}

export async function deleteKnowledgeBase(id: string, workspaceId: string) {
  // Delete chunks → documents → kb (cascade via prisma)
  const kb = await prisma.knowledgeBase.findFirst({ where: { id, workspaceId } });
  if (!kb) return null;

  // Delete all chunks for this KB
  await prisma.kbChunk.deleteMany({ where: { kbId: id } });
  // Delete all documents
  await prisma.kbDocument.deleteMany({ where: { kbId: id } });
  // Delete agent links
  await prisma.agentKnowledgeBase.deleteMany({ where: { kbId: id } });
  // Delete KB itself
  return prisma.knowledgeBase.delete({ where: { id } });
}

// ─── Document Processing ──────────────────────────────────────────────────────

export async function addDocument(
  kbId: string,
  workspaceId: string,
  filename: string,
  content: string,
): Promise<{ documentId: string; chunkCount: number }> {
  // Verify KB belongs to workspace
  const kb = await prisma.knowledgeBase.findFirst({ where: { id: kbId, workspaceId } });
  if (!kb) throw new Error('Knowledge base not found');

  // Create document record
  const doc = await prisma.kbDocument.create({
    data: { kbId, filename, content, status: 'processing' },
  });

  try {
    const textChunks = chunkText(content);
    let savedCount = 0;

    // Generate embeddings in batches of 10 to avoid rate limits
    for (let i = 0; i < textChunks.length; i += 10) {
      const batch = textChunks.slice(i, i + 10);

      const embeddings = await Promise.all(
        batch.map((chunk) => generateEmbedding(chunk)),
      );

      await prisma.kbChunk.createMany({
        data: batch.map((chunkContent, idx) => ({
          kbId,
          documentId: doc.id,
          content: chunkContent,
          embedding: embeddings[idx],
        })),
      });

      savedCount += batch.length;
    }

    // Mark document as ready and update chunk count on KB
    await prisma.kbDocument.update({
      where: { id: doc.id },
      data: { status: 'ready' },
    });

    await prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { chunkCount: { increment: savedCount } },
    });

    return { documentId: doc.id, chunkCount: savedCount };
  } catch (err) {
    await prisma.kbDocument.update({
      where: { id: doc.id },
      data: { status: 'failed' },
    });
    throw err;
  }
}

export async function deleteDocument(docId: string, workspaceId: string) {
  const doc = await prisma.kbDocument.findFirst({
    where: { id: docId },
    include: { kb: true },
  });

  if (!doc || doc.kb?.workspaceId !== workspaceId) return null;

  const chunkCount = await prisma.kbChunk.count({ where: { documentId: docId } });
  await prisma.kbChunk.deleteMany({ where: { documentId: docId } });
  await prisma.kbDocument.delete({ where: { id: docId } });

  if (doc.kbId) {
    await prisma.knowledgeBase.update({
      where: { id: doc.kbId },
      data: { chunkCount: { decrement: chunkCount } },
    });
  }

  return { deleted: true };
}

// ─── Agent ↔ KB Assignment ────────────────────────────────────────────────────

export async function assignKbToAgent(
  agentId: string,
  kbId: string,
  workspaceId: string,
) {
  // Verify both belong to workspace
  const [agent, kb] = await Promise.all([
    prisma.agent.findFirst({ where: { id: agentId, workspaceId } }),
    prisma.knowledgeBase.findFirst({ where: { id: kbId, workspaceId } }),
  ]);

  if (!agent || !kb) throw new Error('Agent or Knowledge Base not found');

  return prisma.agentKnowledgeBase.upsert({
    where: { agentId_kbId: { agentId, kbId } },
    create: { agentId, kbId },
    update: {},
  });
}

export async function removeKbFromAgent(
  agentId: string,
  kbId: string,
  workspaceId: string,
) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
  if (!agent) return null;

  return prisma.agentKnowledgeBase.delete({
    where: { agentId_kbId: { agentId, kbId } },
  });
}

// ─── Search (used during calls) ───────────────────────────────────────────────

export async function searchKnowledgeBase(
  kbIds: string[],
  query: string,
  topK = TOP_K,
): Promise<string> {
  if (kbIds.length === 0) return '';

  // Embed the query
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return '';

  // Fetch all chunks for these KBs
  const chunks = await prisma.kbChunk.findMany({
    where: { kbId: { in: kbIds } },
    select: { id: true, content: true, embedding: true },
  });

  if (chunks.length === 0) return '';

  // Score each chunk
  const scored = chunks
    .map((chunk: { id: string; content: string | null; embedding: number[] }): { content: string; score: number } => ({
      content: chunk.content ?? '',
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((c: { content: string; score: number }) => c.content.length > 0)
    .sort((a: { content: string; score: number }, b: { content: string; score: number }) => b.score - a.score)
    .slice(0, topK);

  if (scored.length === 0) return '';

  return scored.map((c: { content: string; score: number }) => c.content).join('\n\n---\n\n');
}

// ─── Get KB IDs for an agent ──────────────────────────────────────────────────

export async function getAgentKbIds(agentId: string): Promise<string[]> {
  const links = await prisma.agentKnowledgeBase.findMany({
    where: { agentId },
    select: { kbId: true },
  });
  return links.map((l: { kbId: string }) => l.kbId);
}
