import {
  inspectPhpFileDependencies,
  type PhpFileDependencyReport
} from '@shared/moduleCompanion';

export interface CodeAnalysisWorkerRequest {
  reqId: number;
  tabId: string;
  code: string;
}

export interface CodeAnalysisWorkerResponse {
  reqId: number;
  tabId: string;
  deps: PhpFileDependencyReport;
}

self.onmessage = (event: MessageEvent<CodeAnalysisWorkerRequest>): void => {
  const { reqId, tabId, code } = event.data;
  try {
    const deps = inspectPhpFileDependencies(code);
    const reply: CodeAnalysisWorkerResponse = { reqId, tabId, deps };
    self.postMessage(reply);
  } catch {
    const emptyReply: CodeAnalysisWorkerResponse = {
      reqId,
      tabId,
      deps: {
        includes: [],
        readTables: [],
        writeTables: [],
        declaredSymbols: [],
        inputsUsed: []
      }
    };
    self.postMessage(emptyReply);
  }
};
