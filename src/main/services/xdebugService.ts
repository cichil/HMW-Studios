import { createServer, type Server, type Socket } from 'node:net';
import {
  buildDbgpCommand,
  dbgpUriToLocalFilePath,
  extractDbgpPacketsFromBuffer,
  localFilePathToDbgpUri,
  parseDbgpXml,
  type XdebugBreakpointItem,
  type XdebugInitInfo,
  type XdebugStackFrame,
  type XdebugVariableItem
} from '@shared/xdebugProtocol';

export interface XdebugPathMapping {
  remoteRoot: string;
  localRoot: string;
}

export interface XdebugSessionState {
  listening: boolean;
  port: number;
  connected: boolean;
  status: 'idle' | 'listening' | 'running' | 'break' | 'stopping';
  initInfo: XdebugInitInfo | null;
  pausedFile: string | null;
  pausedLine: number | null;
  stack: XdebugStackFrame[];
  locals: XdebugVariableItem[];
  superglobals: XdebugVariableItem[];
  pathMapping: XdebugPathMapping;
  lastError: string | null;
}

export interface XdebugEventPayload {
  type: 'state' | 'log' | 'eval-result';
  state?: XdebugSessionState;
  message?: string;
  evalExpr?: string;
  evalResult?: string;
}

export class XdebugService {
  private server: Server | null = null;
  private socket: Socket | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private txSeq = 1;
  private breakpoints: XdebugBreakpointItem[] = [];
  private listeners: Array<(evt: XdebugEventPayload) => void> = [];
  private pendingEvalByTx = new Map<number, string>();
  private pendingContextByTx = new Map<number, 'locals' | 'superglobals'>();

  private state: XdebugSessionState = {
    listening: false,
    port: 9003,
    connected: false,
    status: 'idle',
    initInfo: null,
    pausedFile: null,
    pausedLine: null,
    stack: [],
    locals: [],
    superglobals: [],
    pathMapping: { remoteRoot: '', localRoot: '' },
    lastError: null
  };

  onEvent(cb: (evt: XdebugEventPayload) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== cb);
    };
  }

  private emit(evt: XdebugEventPayload): void {
    for (const fn of this.listeners) {
      try {
        fn(evt);
      } catch {
        // ignore listener failure
      }
    }
  }

  private emitState(): void {
    this.emit({ type: 'state', state: { ...this.state } });
  }

  private log(message: string): void {
    this.emit({ type: 'log', message });
  }

  getState(): XdebugSessionState {
    return { ...this.state };
  }

  setPathMapping(mapping: XdebugPathMapping): XdebugSessionState {
    this.state.pathMapping = {
      remoteRoot: mapping.remoteRoot.trim(),
      localRoot: mapping.localRoot.trim()
    };
    this.emitState();
    return this.getState();
  }

  async start(port = 9003, pathMapping?: XdebugPathMapping): Promise<XdebugSessionState> {
    if (pathMapping) {
      this.state.pathMapping = {
        remoteRoot: pathMapping.remoteRoot.trim(),
        localRoot: pathMapping.localRoot.trim()
      };
    }
    if (this.server && this.state.listening && this.state.port === port) {
      return this.getState();
    }
    await this.stop();

    const safePort = Math.max(1024, Math.min(65535, Math.floor(port)));
    await new Promise<void>((resolveListen, rejectListen) => {
      const srv = createServer((sock) => this.handleIncomingSocket(sock));
      srv.once('error', (err) => {
        this.state.lastError = `Gagal mendengar port ${safePort}: ${err.message}`;
        this.state.listening = false;
        this.state.status = 'idle';
        this.emitState();
        rejectListen(err);
      });
      srv.listen(safePort, '127.0.0.1', () => {
        this.server = srv;
        this.state.listening = true;
        this.state.port = safePort;
        this.state.status = 'listening';
        this.state.lastError = null;
        this.emitState();
        this.log(`🟢 Xdebug DBGp Listener aktif di 127.0.0.1:${safePort}. Menunggu koneksi PHP...`);
        resolveListen();
      });
    });

    return this.getState();
  }

  async stop(): Promise<XdebugSessionState> {
    if (this.socket) {
      try {
        this.sendRawCommand('stop');
      } catch {
        // ignore
      }
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    if (this.server) {
      await new Promise<void>((res) => {
        this.server?.close(() => res());
      });
      this.server = null;
    }
    this.rxBuffer = Buffer.alloc(0);
    this.state = {
      ...this.state,
      listening: false,
      connected: false,
      status: 'idle',
      initInfo: null,
      pausedFile: null,
      pausedLine: null,
      stack: [],
      locals: [],
      superglobals: []
    };
    this.emitState();
    this.log('⏹ Xdebug DBGp Listener dihentikan.');
    return this.getState();
  }

  syncBreakpoints(items: XdebugBreakpointItem[]): XdebugBreakpointItem[] {
    this.breakpoints = items.map((b) => ({ ...b }));
    if (this.socket && this.state.connected) {
      this.pushAllBreakpointsToSocket();
    }
    return this.breakpoints;
  }

  private pushAllBreakpointsToSocket(): void {
    for (const bp of this.breakpoints) {
      if (!bp.enabled) continue;
      const uri = localFilePathToDbgpUri(bp.filePath, this.state.pathMapping);
      this.sendRawCommand('breakpoint_set', { t: 'line', f: uri, n: bp.line });
    }
  }

  private sendRawCommand(
    cmd: string,
    args: Record<string, string | number> = {},
    payload?: string
  ): number {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Tidak ada sesi Xdebug PHP yang sedang terhubung.');
    }
    const txId = this.txSeq++;
    const wire = buildDbgpCommand(cmd, txId, args, payload);
    this.socket.write(wire, 'utf-8');
    return txId;
  }

  private handleIncomingSocket(sock: Socket): void {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
    }
    this.socket = sock;
    this.rxBuffer = Buffer.alloc(0);
    this.state.connected = true;
    this.state.status = 'running';
    this.state.lastError = null;
    this.emitState();
    this.log('⚡ Sesi Xdebug PHP baru terhubung!');

    sock.on('data', (chunk: Buffer) => {
      this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
      const { packets, remainder } = extractDbgpPacketsFromBuffer(this.rxBuffer);
      this.rxBuffer = Buffer.from(remainder);
      for (const xml of packets) {
        this.handleDbgpXml(xml);
      }
    });

    sock.on('close', () => {
      if (this.socket === sock) {
        this.socket = null;
      }
      this.state.connected = false;
      this.state.status = this.state.listening ? 'listening' : 'idle';
      this.state.pausedFile = null;
      this.state.pausedLine = null;
      this.state.stack = [];
      this.state.locals = [];
      this.state.superglobals = [];
      this.emitState();
      this.log('🔌 Sesi Xdebug PHP selesai / terputus.');
    });

    sock.on('error', (err) => {
      this.state.lastError = err.message;
      this.emitState();
      this.log(`⚠️ Xdebug socket error: ${err.message}`);
    });
  }

  private handleDbgpXml(xml: string): void {
    const parsed = parseDbgpXml(xml);
    if (parsed.kind === 'init' && parsed.init) {
      this.state.initInfo = parsed.init;
      this.log(
        `📌 Init ${parsed.init.engineName} ${parsed.init.engineVersion} • ${parsed.init.fileuri}`
      );
      this.sendRawCommand('feature_set', { n: 'max_depth', v: 3 });
      this.sendRawCommand('feature_set', { n: 'max_children', v: 64 });
      this.sendRawCommand('feature_set', { n: 'max_data', v: 4096 });
      this.pushAllBreakpointsToSocket();
      // Auto-run to first breakpoint
      this.sendRawCommand('run');
      this.emitState();
      return;
    }

    if (parsed.kind !== 'response') return;

    if (parsed.errorMessage) {
      this.log(`⚠️ DBGp [${parsed.command}]: ${parsed.errorMessage}`);
    }

    if (parsed.command === 'eval' && parsed.transactionId !== undefined) {
      const expr = this.pendingEvalByTx.get(parsed.transactionId) ?? '';
      this.pendingEvalByTx.delete(parsed.transactionId);
      this.emit({
        type: 'eval-result',
        evalExpr: expr,
        evalResult: parsed.evalValue ?? parsed.errorMessage ?? '(void)'
      });
      return;
    }

    if (parsed.command === 'stack_get' && parsed.stack) {
      this.state.stack = parsed.stack.map((frame) => ({
        ...frame,
        filename: dbgpUriToLocalFilePath(frame.filename, this.state.pathMapping)
      }));
      const top = this.state.stack[0];
      if (top) {
        this.state.pausedFile = top.filename;
        this.state.pausedLine = top.lineno;
      }
      this.emitState();
      return;
    }

    if (parsed.command === 'context_get' && parsed.properties && parsed.transactionId !== undefined) {
      const ctxKind = this.pendingContextByTx.get(parsed.transactionId);
      this.pendingContextByTx.delete(parsed.transactionId);
      if (ctxKind === 'superglobals') {
        this.state.superglobals = parsed.properties;
      } else {
        this.state.locals = parsed.properties;
      }
      this.emitState();
      return;
    }

    if (
      parsed.command === 'run' ||
      parsed.command === 'step_over' ||
      parsed.command === 'step_into' ||
      parsed.command === 'step_out'
    ) {
      if (parsed.status === 'break') {
        this.state.status = 'break';
        this.sendRawCommand('stack_get');
        const txLoc = this.sendRawCommand('context_get', { d: 0, c: 0 });
        this.pendingContextByTx.set(txLoc, 'locals');
        const txSup = this.sendRawCommand('context_get', { d: 0, c: 1 });
        this.pendingContextByTx.set(txSup, 'superglobals');
        this.emitState();
      } else if (parsed.status === 'stopping' || parsed.status === 'stopped') {
        this.state.status = 'stopping';
        this.sendRawCommand('stop');
        this.emitState();
      }
    }
  }

  continueRun(): void {
    this.state.status = 'running';
    this.state.pausedFile = null;
    this.state.pausedLine = null;
    this.sendRawCommand('run');
    this.emitState();
  }

  stepOver(): void {
    this.state.status = 'running';
    this.sendRawCommand('step_over');
    this.emitState();
  }

  stepInto(): void {
    this.state.status = 'running';
    this.sendRawCommand('step_into');
    this.emitState();
  }

  stepOut(): void {
    this.state.status = 'running';
    this.sendRawCommand('step_out');
    this.emitState();
  }

  stopSession(): void {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.sendRawCommand('stop');
      } catch {
        // ignore
      }
    }
  }

  evalExpression(expr: string): void {
    const clean = expr.trim();
    if (!clean) return;
    const tx = this.sendRawCommand('eval', {}, clean);
    this.pendingEvalByTx.set(tx, clean);
  }
}
