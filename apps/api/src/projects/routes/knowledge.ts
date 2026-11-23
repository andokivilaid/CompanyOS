// Project knowledge — upload, list, read, move, and delete the documents in a
// project's `.kortix/knowledge/` folder from outside a session.
//
// Writes commit directly to the default branch. Reads gate on
// `project.file.read`, writes on `project.file.write`.

import { createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import type { AppEnv } from '../../types';
import { PROJECT_ACTIONS } from '../../iam';
import { auth, errors, json } from '../../openapi';
import { logger } from '../../lib/logger';
import { workspaceIdParam } from '../../shared/route-params';
import {
  KNOWLEDGE_INDEX_PATH,
  KNOWLEDGE_ROOT,
  KnowledgePathError,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_TOTAL_BYTES,
  MAX_KNOWLEDGE_UPLOAD_BYTES,
  MAX_KNOWLEDGE_UPLOAD_FILES,
  assertKnowledgeRelativePath,
  normalizeKnowledgeDescription,
  normalizeKnowledgePath,
} from '../knowledge/format';
import {
  KnowledgeError,
  deleteKnowledgeFile,
  readKnowledge,
  readKnowledgeFileBytes,
  updateKnowledgeFile,
  uploadKnowledgeFiles,
} from '../knowledge/store';
import {
  assertAgentSessionWorkspaceAllowsRepository,
  assertProjectCapability,
  loadProjectForUser,
} from '../lib/access';
import { projectsApp } from '../lib/app';
import { withProjectGitAuth } from '../lib/git';

const LIMITS = {
  max_file_bytes: MAX_KNOWLEDGE_FILE_BYTES,
  max_upload_files: MAX_KNOWLEDGE_UPLOAD_FILES,
  max_upload_bytes: MAX_KNOWLEDGE_UPLOAD_BYTES,
  max_total_bytes: MAX_KNOWLEDGE_TOTAL_BYTES,
};

const KnowledgeFileSchema = z.object({
  path: z.string(),
  repo_path: z.string(),
  type: z.string(),
  size: z.number(),
  description: z.string().nullable(),
});

const KnowledgeListSchema = z.object({
  ref: z.string(),
  root: z.string(),
  index_path: z.string(),
  index_exists: z.boolean(),
  files: z.array(KnowledgeFileSchema),
  total_bytes: z.number(),
  limits: z.object({
    max_file_bytes: z.number(),
    max_upload_files: z.number(),
    max_upload_bytes: z.number(),
    max_total_bytes: z.number(),
  }),
});

const params = z.object({ workspaceId: z.string() });

function knowledgeErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof KnowledgePathError) {
    return c.json({ error: error.message, code: 'knowledge_invalid_path' }, 400);
  }
  if (error instanceof KnowledgeError) {
    switch (error.status) {
      case 400:
        return c.json({ error: error.message, code: error.code }, 400);
      case 404:
        return c.json({ error: error.message, code: error.code }, 404);
      case 409:
        return c.json({ error: error.message, code: error.code }, 409);
      case 413:
        return c.json({ error: error.message, code: error.code }, 413);
      default: {
        const _exhaustive: never = error.status;
        return _exhaustive;
      }
    }
  }
  logger.error('[knowledge] repository write failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return c.json(
    { error: 'Could not write to the project repository. Retry.', code: 'knowledge_git_failed' },
    502,
  );
}

async function loadForRead(c: Context<AppEnv>, projectId: string) {
  const loaded = await loadProjectForUser(c, projectId, 'read');
  if (!loaded) return null;
  await assertAgentSessionWorkspaceAllowsRepository(c, loaded.row.accountId, projectId);
  await assertProjectCapability(
    c,
    loaded.userId,
    loaded.row.accountId,
    projectId,
    PROJECT_ACTIONS.PROJECT_FILE_READ,
  );
  return loaded;
}

async function loadForWrite(c: Context<AppEnv>, projectId: string) {
  const loaded = await loadProjectForUser(c, projectId, 'write');
  if (!loaded) return null;
  await assertAgentSessionWorkspaceAllowsRepository(c, loaded.row.accountId, projectId);
  await assertProjectCapability(
    c,
    loaded.userId,
    loaded.row.accountId,
    projectId,
    PROJECT_ACTIONS.PROJECT_FILE_WRITE,
  );
  return loaded;
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const UpdateBodySchema = z
  .object({
    path: z.string().min(1).max(512),
    new_path: z.string().min(1).max(512).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export function registerKnowledgeRoutes(): void {
  projectsApp.use(
    '/:workspaceId/knowledge',
    bodyLimit({
      maxSize: MAX_KNOWLEDGE_UPLOAD_BYTES + 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: `One upload must be ${MAX_KNOWLEDGE_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`,
            code: 'knowledge_upload_too_large',
          },
          413,
        ),
    }),
  );

  projectsApp.openapi(
    createRoute({
      method: 'get',
      path: '/{workspaceId}/knowledge',
      tags: ['files'],
      summary: 'List the documents in the project knowledge folder',
      ...auth,
      request: { params },
      responses: {
        200: json(KnowledgeListSchema, 'Knowledge documents on the default branch'),
        ...errors(400, 403, 404, 409, 413, 502),
      },
    }),
    async (c: Context<AppEnv>) => {
      const projectId = workspaceIdParam(c);
      if (!projectId) return c.json({ error: 'Not found' }, 404);
      const loaded = await loadForRead(c, projectId);
      if (!loaded) return c.json({ error: 'Not found' }, 404);
      try {
        const state = await readKnowledge(
          await withProjectGitAuth(loaded.row),
          loaded.row.defaultBranch,
        );
        return c.json({ ...state, limits: LIMITS });
      } catch (error) {
        return knowledgeErrorResponse(c, error);
      }
    },
  );

  projectsApp.openapi(
    createRoute({
      method: 'post',
      path: '/{workspaceId}/knowledge',
      tags: ['files'],
      summary: 'Upload documents to the project knowledge folder',
      description:
        `Commits the files under \`${KNOWLEDGE_ROOT}/<folder>/\` and regenerates ` +
        `\`${KNOWLEDGE_INDEX_PATH}\` in one commit on the default branch. ` +
        `Up to ${MAX_KNOWLEDGE_UPLOAD_FILES} files, ${MAX_KNOWLEDGE_FILE_BYTES / (1024 * 1024)} MB each, ` +
        `${MAX_KNOWLEDGE_UPLOAD_BYTES / (1024 * 1024)} MB per request, ` +
        `${MAX_KNOWLEDGE_TOTAL_BYTES / (1024 * 1024)} MB per project.`,
      ...auth,
      request: {
        params,
        body: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: z.object({
                file: z.any().openapi({ type: 'string', format: 'binary' }),
                folder: z.string().optional(),
                description: z.string().optional(),
                replace: z.enum(['true', 'false']).optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({
            commit_sha: z.string(),
            branch: z.string(),
            files: z.array(KnowledgeFileSchema),
          }),
          'Committed documents',
        ),
        ...errors(400, 403, 404, 409, 413, 502),
      },
    }),
    async (c: Context<AppEnv>) => {
      const projectId = workspaceIdParam(c);
      if (!projectId) return c.json({ error: 'Not found' }, 404);
      const loaded = await loadForWrite(c, projectId);
      if (!loaded) return c.json({ error: 'Not found' }, 404);

      let form: FormData | null = null;
      try {
        form = await c.req.formData();
      } catch {
        form = null;
      }
      if (!form) {
        return c.json({ error: 'Send multipart/form-data', code: 'knowledge_invalid_body' }, 400);
      }
      const uploads = form.getAll('file').filter((value: unknown): value is File => value instanceof File);
      if (uploads.length === 0) {
        return c.json({ error: 'Attach at least one file', code: 'knowledge_no_files' }, 400);
      }
      if (uploads.length > MAX_KNOWLEDGE_UPLOAD_FILES) {
        return c.json(
          {
            error: `Upload at most ${MAX_KNOWLEDGE_UPLOAD_FILES} files at once`,
            code: 'knowledge_too_many_files',
          },
          400,
        );
      }
      const oversized = uploads.find((file: File) => file.size > MAX_KNOWLEDGE_FILE_BYTES);
      if (oversized) {
        return c.json(
          {
            error: `"${oversized.name}" is over the ${MAX_KNOWLEDGE_FILE_BYTES / (1024 * 1024)} MB file limit`,
            code: 'knowledge_file_too_large',
          },
          413,
        );
      }
      const folder = form.get('folder');
      const rawDescription = form.get('description');
      const replace = form.get('replace') === 'true';
      try {
        const description =
          typeof rawDescription === 'string' ? normalizeKnowledgeDescription(rawDescription) : undefined;
        const files = await Promise.all(
          uploads.map(async (file: File) => ({
            path: normalizeKnowledgePath(file.name, typeof folder === 'string' ? folder : null),
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        );
        const result = await uploadKnowledgeFiles(await withProjectGitAuth(loaded.row), {
          branch: loaded.row.defaultBranch,
          files,
          description: description ?? undefined,
          replace,
        });
        return c.json(result, 201);
      } catch (error) {
        return knowledgeErrorResponse(c, error);
      }
    },
  );

  projectsApp.openapi(
    createRoute({
      method: 'patch',
      path: '/{workspaceId}/knowledge',
      tags: ['files'],
      summary: 'Move a knowledge document or change its description',
      ...auth,
      request: {
        params,
        body: { content: { 'application/json': { schema: UpdateBodySchema } } },
      },
      responses: {
        200: json(
          z.object({ commit_sha: z.string(), branch: z.string(), file: KnowledgeFileSchema }),
          'Updated document',
        ),
        ...errors(400, 403, 404, 409, 413, 502),
      },
    }),
    async (c: Context<AppEnv>) => {
      const projectId = workspaceIdParam(c);
      if (!projectId) return c.json({ error: 'Not found' }, 404);
      const loaded = await loadForWrite(c, projectId);
      if (!loaded) return c.json({ error: 'Not found' }, 404);
      const parsed = UpdateBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(
          { error: 'Invalid body', code: 'knowledge_invalid_body', issues: parsed.error.issues },
          400,
        );
      }
      try {
        const body = parsed.data;
        const result = await updateKnowledgeFile(await withProjectGitAuth(loaded.row), {
          branch: loaded.row.defaultBranch,
          path: assertKnowledgeRelativePath(body.path),
          newPath: body.new_path === undefined ? undefined : assertKnowledgeRelativePath(body.new_path),
          description:
            body.description === undefined ? undefined : normalizeKnowledgeDescription(body.description),
        });
        return c.json(result);
      } catch (error) {
        return knowledgeErrorResponse(c, error);
      }
    },
  );

  projectsApp.openapi(
    createRoute({
      method: 'delete',
      path: '/{workspaceId}/knowledge',
      tags: ['files'],
      summary: 'Delete a knowledge document',
      ...auth,
      request: { params, query: z.object({ path: z.string().optional() }) },
      responses: {
        200: json(
          z.object({ commit_sha: z.string(), branch: z.string(), path: z.string() }),
          'Deleted document',
        ),
        ...errors(400, 403, 404, 409, 413, 502),
      },
    }),
    async (c: Context<AppEnv>) => {
      const projectId = workspaceIdParam(c);
      if (!projectId) return c.json({ error: 'Not found' }, 404);
      const path = c.req.query('path');
      if (!path) {
        return c.json({ error: 'path query param is required', code: 'knowledge_invalid_path' }, 400);
      }
      const loaded = await loadForWrite(c, projectId);
      if (!loaded) return c.json({ error: 'Not found' }, 404);
      try {
        const result = await deleteKnowledgeFile(await withProjectGitAuth(loaded.row), {
          branch: loaded.row.defaultBranch,
          path,
        });
        return c.json(result);
      } catch (error) {
        return knowledgeErrorResponse(c, error);
      }
    },
  );

  projectsApp.openapi(
    createRoute({
      method: 'get',
      path: '/{workspaceId}/knowledge/file',
      tags: ['files'],
      summary: 'Download the exact bytes of a knowledge document',
      ...auth,
      request: { params, query: z.object({ path: z.string().optional() }) },
      responses: {
        200: {
          description: 'Document bytes',
          content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
        },
        ...errors(400, 403, 404, 409, 413, 502),
      },
    }),
    async (c: Context<AppEnv>) => {
      const projectId = workspaceIdParam(c);
      if (!projectId) return c.json({ error: 'Not found' }, 404);
      const path = c.req.query('path');
      if (!path) {
        return c.json({ error: 'path query param is required', code: 'knowledge_invalid_path' }, 400);
      }
      const loaded = await loadForRead(c, projectId);
      if (!loaded) return c.json({ error: 'Not found' }, 404);
      try {
        const { file, bytes, sha } = await readKnowledgeFileBytes(
          await withProjectGitAuth(loaded.row),
          loaded.row.defaultBranch,
          path,
        );
        const filename = file.path.split('/').pop() ?? 'document';
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            'Content-Type': CONTENT_TYPES[file.type] ?? 'application/octet-stream',
            'Content-Length': String(bytes.byteLength),
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            ETag: `"${sha}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          },
        });
      } catch (error) {
        return knowledgeErrorResponse(c, error);
      }
    },
  );
}