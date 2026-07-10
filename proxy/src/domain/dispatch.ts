import { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import * as queries from '../db/queries.js';

// ── Retry Schedule (exponential backoff with jitter) ──────

const RETRY_SCHEDULE_MS = [
  0,          // attempt 1: immediate
  30_000,     // attempt 2: 30s
  120_000,    // attempt 3: 2m
  300_000,    // attempt 4: 5m
  900_000,    // attempt 5: 15m
  1_800_000,  // attempt 6: 30m
  3_600_000,  // attempt 7: 1h
  7_200_000,  // attempt 8: 2h
  7_200_000,  // attempt 9: 2h
  7_200_000,  // attempt 10: 2h
  7_200_000,  // attempt 11: 2h
  7_200_000,  // attempt 12: 2h
];

const MAX_RETRIES = 12;

// ── Dispatch Callback ───────────────────────────────────────

export async function dispatchCallback(
  db: Kysely<DB>,
  taskId: string,
): Promise<void> {
  const task = await queries.getTask(db, taskId);
  if (!task) return;

  if (!task.callback_url) return;
  if (task.dispatch_state === 'DELIVERED') return;
  if (task.retry_count >= MAX_RETRIES) {
    await queries.updateTaskDispatchState(db, taskId, 'DISPATCH_FAILED', task.retry_count);
    await queries.createEvent(db, {
      surfaceId: task.surface_id,
      tenantId: task.tenant_id,
      eventType: 'callback_failed',
      detail: { reason: 'Max retries exhausted' },
    });
    return;
  }

  // Calculate delay for this attempt
  const attemptIndex = Math.min(task.retry_count, RETRY_SCHEDULE_MS.length - 1);
  const delay = RETRY_SCHEDULE_MS[attemptIndex] ?? 7_200_000;

  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  const actualDelay = Math.max(0, Math.floor(delay + jitter));

  // If delay > 0, schedule for later
  if (actualDelay > 0 && task.retry_count > 0) {
    setTimeout(() => attemptDispatch(db, taskId), actualDelay);
    return;
  }

  await attemptDispatch(db, taskId);
}

async function attemptDispatch(db: Kysely<DB>, taskId: string): Promise<void> {
  const task = await queries.getTask(db, taskId);
  if (!task || !task.callback_url) return;
  if (task.dispatch_state === 'DELIVERED') return;

  await queries.updateTaskDispatchState(db, taskId, 'DISPATCHING');

  const payload = {
    task_id: task.task_id,
    surface_id: task.surface_id,
    status: task.status === 'TASK_STATE_COMPLETED' ? 'COMPLETED' : 'REJECTED',
    user_input: JSON.parse(task.output_json || '{}'),
    submitted_at: task.completed_at ?? new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (task.callback_token) {
    headers['Authorization'] = `Bearer ${task.callback_token}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(task.callback_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      await queries.updateTaskDispatchState(db, taskId, 'DELIVERED');
      await queries.createEvent(db, {
        surfaceId: task.surface_id,
        tenantId: task.tenant_id,
        eventType: 'callback_delivered',
        detail: { statusCode: response.status },
      });
    } else {
      await handleRetry(db, taskId, task.retry_count);
    }
  } catch (err) {
    await handleRetry(db, taskId, task.retry_count);
  }
}

async function handleRetry(db: Kysely<DB>, taskId: string, currentRetries: number): Promise<void> {
  const newRetryCount = currentRetries + 1;
  await queries.updateTaskDispatchState(db, taskId, 'PENDING', newRetryCount);

  // Schedule next retry
  const attemptIndex = Math.min(newRetryCount, RETRY_SCHEDULE_MS.length - 1);
  const delay = RETRY_SCHEDULE_MS[attemptIndex] ?? 7_200_000;

  if (newRetryCount < MAX_RETRIES) {
    setTimeout(() => dispatchCallback(db, taskId), delay);
  }
}

// ── Dispatch all pending ────────────────────────────────────

export async function dispatchAllPending(db: Kysely<DB>): Promise<void> {
  const tasks = await db
    .selectFrom('a2a_tasks')
    .where('dispatch_state', 'in', ['PENDING', 'DISPATCHING'])
    .where('callback_url', 'is not', null)
    .where('retry_count', '<', MAX_RETRIES)
    .selectAll()
    .execute();

  for (const task of tasks) {
    await dispatchCallback(db, task.task_id);
  }
}
