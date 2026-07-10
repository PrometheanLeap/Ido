import { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import * as queries from '../db/queries.js';
import type { TaskState, A2ATask } from '../types.js';
import { DomainError } from './surfaces.js';

export async function getTask(
  db: Kysely<DB>,
  taskId: string,
  tenantId: string,
): Promise<A2ATask> {
  const row = await queries.getTask(db, taskId);
  if (!row) throw new DomainError('Task not found', 404);
  if (row.tenant_id !== tenantId) throw new DomainError('Access denied', 403);
  return row;
}

export async function listTasks(
  db: Kysely<DB>,
  tenantId: string,
) {
  return queries.getTasksForTenant(db, tenantId);
}
