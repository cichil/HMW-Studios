import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { PreviewServerState } from '@shared/types';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const LIVE_RELOAD_SNIPPET = `
<script>
(() => {
  try {
    const es = new EventSource('/__aptana_live_reload');
    es.onmessage = (ev) => {
      if (ev.data === 'reload') window.location.reload();
    };
  } catch {}
})();
</script>
`;

export class PreviewServerService {
  private server: Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private state: PreviewServerState = {
    running: false,
    port: 0,
    url: '',
    workspacePath: ''
  };
  private reloadListeners = new Set<() => void>();

  onReload(cb: () => void): () => void {
    this.reloadListeners.add(cb);
    return () => this.reloadListeners.delete(cb);
  }

  getStatus(): PreviewServerState {
    return { ...this.state };
  }

  notifyFileSaved(): void {
    if (!this.state.running) return;
    for (const res of this.sseClients) {
      try {
        res.write('data: reload\n\n');
      } catch {
        this.sseClients.delete(res);
      }
    }
    for (const fn of this.reloadListeners) fn();
  }

  async start(workspacePath: string): Promise<PreviewServerState> {
    const resolvedRoot = resolve(workspacePath);
    if (this.state.running && this.state.workspacePath === resolvedRoot) {
      return this.getStatus();
    }

    await this.stop();

    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this.handleRequest(resolvedRoot, req, res);
    });

    const port = await new Promise<number>((resolvePort, rejectPort) => {
      srv.once('error', rejectPort);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          resolvePort(addr.port);
        } else {
          rejectPort(new Error('Failed to bind preview server port'));
        }
      });
    });

    this.server = srv;
    this.state = {
      running: true,
      port,
      url: `http://127.0.0.1:${port}/`,
      workspacePath: resolvedRoot
    };
    return this.getStatus();
  }

  async stop(): Promise<PreviewServerState> {
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // Ignore
      }
    }
    this.sseClients.clear();

    if (this.server) {
      const activeServer = this.server;
      this.server = null;
      await new Promise<void>((r) => activeServer.close(() => r()));
    }

    this.state = {
      running: false,
      port: 0,
      url: '',
      workspacePath: ''
    };
    return this.getStatus();
  }

  private async handleRequest(
    rootDir: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const rawUrl = (req.url || '/').split('?')[0];
    if (rawUrl === '/__aptana_live_reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('data: connected\n\n');
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }

    const decoded = decodeURIComponent(rawUrl).replace(/^\/+/, '');
    let candidate = resolve(rootDir, decoded || 'index.html');

    // Prevent directory traversal outside workspace root
    if (!candidate.startsWith(rootDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    try {
      const st = await stat(candidate);
      if (st.isDirectory()) {
        candidate = join(candidate, 'index.html');
      }
      const ext = extname(candidate).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const buf = await readFile(candidate);

      if (ext === '.html' || ext === '.htm') {
        let html = buf.toString('utf-8');
        if (html.includes('</body>')) {
          html = html.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`);
        } else {
          html += LIVE_RELOAD_SNIPPET;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store'
        });
        res.end(html, 'utf-8');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!DOCTYPE html><html><body style="background:#14171f;color:#e5e7eb;font-family:sans-serif;padding:2rem;">
        <h2 style="color:#f97316;">HMW Studio Live Preview — 404</h2>
        <p>File tidak ditemukan: <code>${decoded || 'index.html'}</code></p>
        <p>Pastikan proyek Anda memiliki <code>index.html</code> atau pilih path file HTML di bilah alamat Preview.</p>
        ${LIVE_RELOAD_SNIPPET}
        </body></html>`
      );
    }
  }
}
