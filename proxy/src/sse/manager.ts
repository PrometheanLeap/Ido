import { config } from '../config.js';
import type { SurfaceUpdateEvent, SurfaceResolvedEvent } from './events.js';

// ── SSE Client ──────────────────────────────────────────────

interface SSEClient {
  id: string;
  tenantId: string;
  userId?: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
}

// ── SSE Manager ─────────────────────────────────────────────

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Keep connections alive with periodic heartbeats
    this.keepaliveInterval = setInterval(() => {
      this.broadcastKeepalive();
    }, config.sseKeepaliveIntervalMs);
  }

  addClient(
    clientId: string,
    tenantId: string,
    userId: string | undefined,
    controller: ReadableStreamDefaultController,
  ): void {
    const encoder = new TextEncoder();
    this.clients.set(clientId, {
      id: clientId,
      tenantId,
      userId,
      controller,
      encoder,
    });

    // Remove on close
    // (controller handles its own cleanup via cancel callback)
  }

  removeClient(clientId: string): void {
    console.log('[SSE] removeClient id=' + clientId.slice(0,8) + ' remaining=' + (this.clients.size - 1));
    this.clients.delete(clientId);
  }

  // ── Send to specific client ────────────────────────────────

  private send(client: SSEClient, event: string, data: unknown): void {
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      client.controller.enqueue(client.encoder.encode(payload));
    } catch {
      this.removeClient(client.id);
    }
  }

  // ── Broadcast to tenant ────────────────────────────────────

  broadcastToTenant(
    tenantId: string,
    event: string,
    data: unknown,
    targetUserId?: string | null,
  ): void {
    for (const client of this.clients.values()) {
      if (client.tenantId !== tenantId) continue;
      // If a target user is specified, only deliver to that user or clients
      // without a userId (admin/broadcast views). Null target = everyone.
      if (targetUserId != null && client.userId != null && client.userId !== targetUserId) continue;
      this.send(client, event, data);
    }
  }

  // ── Push surface update ────────────────────────────────────

  pushSurfaceUpdate(
    tenantId: string,
    update: SurfaceUpdateEvent | SurfaceResolvedEvent,
    targetUserId?: string | null,
  ): void {
    this.broadcastToTenant(tenantId, 'surface_update', update, targetUserId);
  }

  pushSurfaceResolved(tenantId: string, surfaceId: string, state: string, targetUserId?: string | null): void {
    this.broadcastToTenant(tenantId, 'surface_resolved', {
      type: 'surface_resolved',
      surfaceId,
      state,
    }, targetUserId);
  }

  pushNotification(tenantId: string, message: string): void {
    this.broadcastToTenant(tenantId, 'notification', {
      type: 'notification',
      message,
    });
  }

  // ── Keepalive ──────────────────────────────────────────────

  private broadcastKeepalive(): void {
    for (const client of this.clients.values()) {
      try {
        client.controller.enqueue(client.encoder.encode(': keepalive\n\n'));
      } catch (e) {
        console.warn('[SSE] keepalive failed for client ' + client.id.slice(0,8) + ': ' + (e instanceof Error ? e.message : String(e)));
        this.removeClient(client.id);
      }
    }
  }

  // ── Stats ──────────────────────────────────────────────────

  getClientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }
    for (const client of this.clients.values()) {
      try {
        client.controller.close();
      } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

// ── Singleton ───────────────────────────────────────────────

export const sseManager = new SSEManager();
