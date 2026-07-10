import { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import * as queries from '../db/queries.js';
import { sseManager } from '../sse/manager.js';
import { buildSurfaceUpdateEvent } from '../sse/events.js';

export async function sweepExpired(db: Kysely<DB>): Promise<number> {
  const expiredTasks = await queries.getExpiredTasks(db);
  let count = 0;

  for (const task of expiredTasks) {
    // Use background setter — sweep is automated, should not bump updated_at
    // and corrupt History sort order.
    await queries.setSurfaceStateBackground(db, task.surface_id, 'EXPIRED');
    await queries.updateTaskStatus(
      db,
      task.task_id,
      'TASK_STATE_FAILED',
      undefined,
      'EXPIRED',
    );

    await queries.createEvent(db, {
      surfaceId: task.surface_id,
      tenantId: task.tenant_id,
      eventType: 'expired',
    });

    // Push SSE update so frontend moves it to History immediately
    const surface = await queries.getSurface(db, task.surface_id);
    if (surface) {
      sseManager.pushSurfaceUpdate(task.tenant_id, buildSurfaceUpdateEvent(surface), surface.user_id);
    }

    count++;
  }

  return count;
}
