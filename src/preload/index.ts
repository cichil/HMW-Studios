import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppUpdateStateDto,
  AptanaBridgeAPI,
  DbValueSearchProgressEvent,
  DesktopIslandCommand,
  DesktopIslandSnapshot,
  IdeShortcutAction,
  IslandActivity,
  LogMonitorStatus,
  ParsedLogEntry,
  TransferLogEntry,
  WorkspaceChangeEvent,
  XdebugEventDto
} from '@shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AptanaBridgeAPI = {
  system: {
    getInfo: () => ipcRenderer.invoke('system:getInfo'),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    onShortcut: (cb) => subscribe<IdeShortcutAction>('ide:shortcut', cb)
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke('workspace:selectFolder'),
    openFolder: (folderPath) => ipcRenderer.invoke('workspace:openFolder', folderPath),
    closeFolder: () => ipcRenderer.invoke('workspace:closeFolder'),
    createSampleProject: (targetDir) =>
      ipcRenderer.invoke('workspace:createSampleProject', targetDir),
    listTree: (folderPath) => ipcRenderer.invoke('workspace:listTree', folderPath),
    readFile: (filePath) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath, content) =>
      ipcRenderer.invoke('workspace:writeFile', filePath, content),
    createEntry: (targetPath, isDirectory, initialContent) =>
      ipcRenderer.invoke('workspace:createEntry', targetPath, isDirectory, initialContent),
    renameEntry: (oldPath, newPath) =>
      ipcRenderer.invoke('workspace:renameEntry', oldPath, newPath),
    deleteEntry: (targetPath) => ipcRenderer.invoke('workspace:deleteEntry', targetPath),
    copyOrMoveEntry: (sourcePath, targetDirPath, mode) =>
      ipcRenderer.invoke('workspace:copyOrMoveEntry', sourcePath, targetDirPath, mode),
    searchInFiles: (folderPath, query, caseSensitive) =>
      ipcRenderer.invoke('workspace:searchInFiles', folderPath, query, caseSensitive),
    replaceInFiles: (folderPath, query, replacement, options) =>
      ipcRenderer.invoke(
        'workspace:replaceInFiles',
        folderPath,
        query,
        replacement,
        options
      ),
    scanTodos: (folderPath) => ipcRenderer.invoke('workspace:scanTodos', folderPath),
    scanJoinEdges: (folderPath) => ipcRenderer.invoke('workspace:scanJoinEdges', folderPath),
    scanWebAssets: (folderPath) => ipcRenderer.invoke('workspace:scanWebAssets', folderPath),
    onChanged: (cb) => subscribe<WorkspaceChangeEvent>('workspace:changed', cb)
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    save: (payload) => ipcRenderer.invoke('projects:save', payload),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    touchOpened: (id) => ipcRenderer.invoke('projects:touchOpened', id),
    exportToFile: (payload) => ipcRenderer.invoke('projects:exportToFile', payload),
    openFromFile: (filePath) => ipcRenderer.invoke('projects:openFromFile', filePath)
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (payload) => ipcRenderer.invoke('connections:save', payload),
    remove: (id) => ipcRenderer.invoke('connections:remove', id),
    test: (id) => ipcRenderer.invoke('connections:test', id),
    listRemoteDir: (id, remoteSubPath) =>
      ipcRenderer.invoke('connections:listRemoteDir', id, remoteSubPath),
    readRemoteFile: (id, remoteRelativePath) =>
      ipcRenderer.invoke('connections:readRemoteFile', id, remoteRelativePath),
    writeRemoteFile: (id, remoteRelativePath, content) =>
      ipcRenderer.invoke('connections:writeRemoteFile', id, remoteRelativePath, content),
    createRemoteEntry: (id, remoteRelativePath, isDirectory, initialContent) =>
      ipcRenderer.invoke(
        'connections:createRemoteEntry',
        id,
        remoteRelativePath,
        isDirectory,
        initialContent
      ),
    renameRemoteEntry: (id, oldRelativePath, newRelativePath) =>
      ipcRenderer.invoke(
        'connections:renameRemoteEntry',
        id,
        oldRelativePath,
        newRelativePath
      ),
    deleteRemoteEntry: (id, remoteRelativePath, isDirectory) =>
      ipcRenderer.invoke(
        'connections:deleteRemoteEntry',
        id,
        remoteRelativePath,
        isDirectory
      ),
    chmodRemoteEntry: (id, remoteRelativePath, modeOctal) =>
      ipcRenderer.invoke(
        'connections:chmodRemoteEntry',
        id,
        remoteRelativePath,
        modeOctal
      ),
    uploadMultiplePaths: (id, localPaths, targetRemoteSubPath) =>
      ipcRenderer.invoke(
        'connections:uploadMultiplePaths',
        id,
        localPaths,
        targetRemoteSubPath
      ),
    searchRemoteFiles: (id, remoteSubPath, query, caseSensitive) =>
      ipcRenderer.invoke(
        'connections:searchRemoteFiles',
        id,
        remoteSubPath,
        query,
        caseSensitive
      ),
    listRemoteFilesIndex: (id, remoteSubPath, maxFiles) =>
      ipcRenderer.invoke('connections:listRemoteFilesIndex', id, remoteSubPath, maxFiles),
    scanRemoteWorkspaceSymbols: (id, remoteSubPath, maxFiles) =>
      ipcRenderer.invoke('connections:scanRemoteWorkspaceSymbols', id, remoteSubPath, maxFiles),
    getCachedRemoteIndex: (id) =>
      ipcRenderer.invoke('connections:getCachedRemoteIndex', id),
    uploadSingleFile: (id, workspacePath, relativePath) =>
      ipcRenderer.invoke('connections:uploadSingleFile', id, workspacePath, relativePath),
    downloadSingleFile: (id, workspacePath, relativePath) =>
      ipcRenderer.invoke('connections:downloadSingleFile', id, workspacePath, relativePath),
    downloadEntryToLocalDir: (
      id,
      remoteRelativePath,
      isDirectory,
      targetLocalDir,
      deleteSourceAfter
    ) =>
      ipcRenderer.invoke(
        'connections:downloadEntryToLocalDir',
        id,
        remoteRelativePath,
        isDirectory,
        targetLocalDir,
        deleteSourceAfter
      ),
    copyOrMoveRemoteEntry: (
      sourceId,
      sourceRelativePath,
      isDirectory,
      destId,
      targetRemoteSubPath,
      mode
    ) =>
      ipcRenderer.invoke(
        'connections:copyOrMoveRemoteEntry',
        sourceId,
        sourceRelativePath,
        isDirectory,
        destId,
        targetRemoteSubPath,
        mode
      ),
    replaceInRemoteFiles: (id, remoteSubPath, query, replacement, options) =>
      ipcRenderer.invoke(
        'connections:replaceInRemoteFiles',
        id,
        remoteSubPath,
        query,
        replacement,
        options
      ),
    poolStats: () => ipcRenderer.invoke('connections:poolStats'),
    disconnectPool: (id) => ipcRenderer.invoke('connections:disconnectPool', id),
    broadcastWriteFile: (connectionIds, remoteRelativePath, content) =>
      ipcRenderer.invoke(
        'connections:broadcastWriteFile',
        connectionIds,
        remoteRelativePath,
        content
      ),
    inspectServerHealth: (id) => ipcRenderer.invoke('connections:inspectServerHealth', id),
    listSshSnippets: () => ipcRenderer.invoke('connections:listSshSnippets'),
    saveSshSnippet: (payload) => ipcRenderer.invoke('connections:saveSshSnippet', payload),
    deleteSshSnippet: (id) => ipcRenderer.invoke('connections:deleteSshSnippet', id),
    runSshSnippetMulti: (connectionIds, command) =>
      ipcRenderer.invoke('connections:runSshSnippetMulti', connectionIds, command)
  },
  sync: {
    compare: (connectionId, workspacePath, mode) =>
      ipcRenderer.invoke('sync:compare', connectionId, workspacePath, mode),
    execute: (connectionId, workspacePath, items) =>
      ipcRenderer.invoke('sync:execute', connectionId, workspacePath, items),
    onTransferLog: (cb) => subscribe<TransferLogEntry>('sync:transferLog', cb)
  },
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id) => ipcRenderer.invoke('terminal:close', id),
    runCommand: (commandLine, cwd) =>
      ipcRenderer.invoke('terminal:runCommand', commandLine, cwd),
    onData: (cb) => subscribe<{ id: string; data: string }>('terminal:data', cb),
    onExit: (cb) => subscribe<{ id: string; exitCode: number }>('terminal:exit', cb)
  },
  rubles: {
    list: () => ipcRenderer.invoke('rubles:list'),
    saveSnippet: (snippet) => ipcRenderer.invoke('rubles:saveSnippet', snippet),
    deleteSnippet: (snippetId) => ipcRenderer.invoke('rubles:deleteSnippet', snippetId),
    saveCommand: (cmd) => ipcRenderer.invoke('rubles:saveCommand', cmd),
    deleteCommand: (commandId) => ipcRenderer.invoke('rubles:deleteCommand', commandId)
  },
  git: {
    status: (workspacePath) => ipcRenderer.invoke('git:status', workspacePath),
    init: (workspacePath) => ipcRenderer.invoke('git:init', workspacePath),
    stage: (workspacePath, paths) => ipcRenderer.invoke('git:stage', workspacePath, paths),
    unstage: (workspacePath, paths) =>
      ipcRenderer.invoke('git:unstage', workspacePath, paths),
    commit: (workspacePath, message) =>
      ipcRenderer.invoke('git:commit', workspacePath, message),
    checkout: (workspacePath, branch, createNew) =>
      ipcRenderer.invoke('git:checkout', workspacePath, branch, createNew),
    pull: (workspacePath) => ipcRenderer.invoke('git:pull', workspacePath),
    push: (workspacePath) => ipcRenderer.invoke('git:push', workspacePath),
    fileDiff: (workspacePath, relativePath) =>
      ipcRenderer.invoke('git:fileDiff', workspacePath, relativePath),
    blameLine: (workspacePath, relativePath, line) =>
      ipcRenderer.invoke('git:blameLine', workspacePath, relativePath, line)
  },
  preview: {
    start: (workspacePath) => ipcRenderer.invoke('preview:start', workspacePath),
    stop: () => ipcRenderer.invoke('preview:stop'),
    status: () => ipcRenderer.invoke('preview:status'),
    onReload: (cb) => subscribe<void>('preview:reload', cb)
  },
  php: {
    getCatalog: () => ipcRenderer.invoke('php:getCatalog'),
    lint: (code) => ipcRenderer.invoke('php:lint', code),
    autoFixLocal: (code) => ipcRenderer.invoke('php:autoFixLocal', code),
    runSnippet: (code, cwd) => ipcRenderer.invoke('php:runSnippet', code, cwd),
    scanWorkspace: (workspacePath) => ipcRenderer.invoke('php:scanWorkspace', workspacePath),
    getWisanggeniCatalog: (forceRefresh, customPathOrUrl) =>
      ipcRenderer.invoke('php:getWisanggeniCatalog', forceRefresh, customPathOrUrl),
    getLaravelCatalog: (workspacePath) =>
      ipcRenderer.invoke('php:getLaravelCatalog', workspacePath)
  },
  history: {
    list: (fileKey) => ipcRenderer.invoke('history:list', fileKey),
    getContent: (snapshotId) => ipcRenderer.invoke('history:getContent', snapshotId),
    record: (payload) => ipcRenderer.invoke('history:record', payload),
    clear: (fileKey) => ipcRenderer.invoke('history:clear', fileKey)
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    saveConfig: (payload) => ipcRenderer.invoke('ai:saveConfig', payload),
    testConnection: () => ipcRenderer.invoke('ai:testConnection'),
    chat: (req) => ipcRenderer.invoke('ai:chat', req),
    generateWisanggeniCrud: (req) => ipcRenderer.invoke('ai:generateWisanggeniCrud', req),
    inlineTransform: (req) => ipcRenderer.invoke('ai:inlineTransform', req),
    fixError: (req) => ipcRenderer.invoke('ai:fixError', req),
    sqlAndSecurityAudit: (req) => ipcRenderer.invoke('ai:sqlAndSecurityAudit', req),
    generateDocs: (req) => ipcRenderer.invoke('ai:generateDocs', req),
    inlineCompletion: (req) => ipcRenderer.invoke('ai:inlineCompletion', req),
    summarizeChanges: (req) => ipcRenderer.invoke('ai:summarizeChanges', req)
  },
  db: {
    list: () => ipcRenderer.invoke('db:list'),
    save: (payload) => ipcRenderer.invoke('db:save', payload),
    remove: (id) => ipcRenderer.invoke('db:remove', id),
    test: (id) => ipcRenderer.invoke('db:test', id),
    getCachedSchema: (id, database) =>
      ipcRenderer.invoke('db:getCachedSchema', id, database),
    introspect: (id, database, forceFull) =>
      ipcRenderer.invoke('db:introspect', id, database, forceFull),
    onProgress: (cb) => subscribe('db:progress', cb),
    onPartialSchema: (cb) => subscribe('db:partialSchema', cb),
    query: (id, sql, database, maxRows) =>
      ipcRenderer.invoke('db:query', id, sql, database, maxRows),
    queryMulti: (id, sqlScript, database, maxRows) =>
      ipcRenderer.invoke('db:queryMulti', id, sqlScript, database, maxRows),
    openXlsxWorkbook: () => ipcRenderer.invoke('db:openXlsxWorkbook'),
    importTabular: (id, payload) => ipcRenderer.invoke('db:importTabular', id, payload),
    searchValueAcrossDb: (id, payload) =>
      ipcRenderer.invoke('db:searchValueAcrossDb', id, payload),
    onValueSearchProgress: (cb) =>
      subscribe<DbValueSearchProgressEvent>('db:valueSearchProgress', cb),
    exportDataDictionary: (id, payload) =>
      ipcRenderer.invoke('db:exportDataDictionary', id, payload),
    diffTableRows: (payload) => ipcRenderer.invoke('db:diffTableRows', payload),
    updateCell: (id, payload) => ipcRenderer.invoke('db:updateCell', id, payload),
    insertRow: (id, payload) => ipcRenderer.invoke('db:insertRow', id, payload),
    deleteRow: (id, payload) => ipcRenderer.invoke('db:deleteRow', id, payload),
    exportExcel: (payload) => ipcRenderer.invoke('db:exportExcel', payload),
    exportSqlDump: (id, payload) => ipcRenderer.invoke('db:exportSqlDump', id, payload),
    importCsv: (id, payload) => ipcRenderer.invoke('db:importCsv', id, payload),
    listProcesses: (id) => ipcRenderer.invoke('db:listProcesses', id),
    killProcess: (id, processId) => ipcRenderer.invoke('db:killProcess', id, processId),
    inspectHealth: (id, database, mode) =>
      ipcRenderer.invoke('db:inspectHealth', id, database, mode),
    optimizeTable: (id, payload) =>
      ipcRenderer.invoke('db:optimizeTable', id, payload),
    generateTableDdl: (table, engine) =>
      ipcRenderer.invoke('db:generateTableDdl', table, engine),
    transferTableData: (payload) =>
      ipcRenderer.invoke('db:transferTableData', payload),
    listSavedQueries: () => ipcRenderer.invoke('db:listSavedQueries'),
    saveQuery: (payload) => ipcRenderer.invoke('db:saveQuery', payload),
    deleteSavedQuery: (id) => ipcRenderer.invoke('db:deleteSavedQuery', id),
    exportSavedQueries: () => ipcRenderer.invoke('db:exportSavedQueries'),
    importSavedQueries: () => ipcRenderer.invoke('db:importSavedQueries'),
    listRoutines: (id, database) => ipcRenderer.invoke('db:listRoutines', id, database),
    getRoutineDdl: (id, payload) => ipcRenderer.invoke('db:getRoutineDdl', id, payload),
    listSchedules: () => ipcRenderer.invoke('db:listSchedules'),
    saveSchedule: (payload) => ipcRenderer.invoke('db:saveSchedule', payload),
    deleteSchedule: (id) => ipcRenderer.invoke('db:deleteSchedule', id),
    runScheduleNow: (id) => ipcRenderer.invoke('db:runScheduleNow', id),
    executeBatchTx: (id, statements, database) =>
      ipcRenderer.invoke('db:executeBatchTx', id, statements, database),
    explainVisual: (id, sql, database) =>
      ipcRenderer.invoke('db:explainVisual', id, sql, database),
    listUsersRbac: (id) => ipcRenderer.invoke('db:listUsersRbac', id),
    applyRbacSql: (id, statements) => ipcRenderer.invoke('db:applyRbacSql', id, statements)
  },
  audit: {
    list: (limit) => ipcRenderer.invoke('audit:list', limit),
    clear: () => ipcRenderer.invoke('audit:clear'),
    exportJson: () => ipcRenderer.invoke('audit:exportJson')
  },
  security: {
    scanProject: (payload) => ipcRenderer.invoke('security:scanProject', payload)
  },
  patch: {
    scanModified: (workspacePath, sinceHours) =>
      ipcRenderer.invoke('patch:scanModified', workspacePath, sinceHours),
    buildZip: (payload) => ipcRenderer.invoke('patch:buildZip', payload)
  },
  logs: {
    start: (config) => ipcRenderer.invoke('logs:start', config),
    stop: () => ipcRenderer.invoke('logs:stop'),
    status: () => ipcRenderer.invoke('logs:status'),
    autoDetectPaths: (connectionId, workspacePath) =>
      ipcRenderer.invoke('logs:autoDetectPaths', connectionId, workspacePath),
    readSnapshot: (config) => ipcRenderer.invoke('logs:readSnapshot', config),
    onEntries: (cb) => subscribe<ParsedLogEntry[]>('logs:entries', cb),
    onStatus: (cb) => subscribe<LogMonitorStatus>('logs:status', cb)
  },
  http: {
    listSaved: () => ipcRenderer.invoke('http:listSaved'),
    saveRequest: (payload) => ipcRenderer.invoke('http:saveRequest', payload),
    deleteSaved: (id) => ipcRenderer.invoke('http:deleteSaved', id),
    send: (payload) => ipcRenderer.invoke('http:send', payload),
    getWorkspace: () => ipcRenderer.invoke('http:getWorkspace'),
    saveWorkspace: (ws) => ipcRenderer.invoke('http:saveWorkspace', ws)
  },
  xdebug: {
    getState: () => ipcRenderer.invoke('xdebug:getState'),
    start: (port, pathMapping) => ipcRenderer.invoke('xdebug:start', port, pathMapping),
    stop: () => ipcRenderer.invoke('xdebug:stop'),
    setPathMapping: (mapping) => ipcRenderer.invoke('xdebug:setPathMapping', mapping),
    syncBreakpoints: (items) => ipcRenderer.invoke('xdebug:syncBreakpoints', items),
    continueRun: () => ipcRenderer.invoke('xdebug:continueRun'),
    stepOver: () => ipcRenderer.invoke('xdebug:stepOver'),
    stepInto: () => ipcRenderer.invoke('xdebug:stepInto'),
    stepOut: () => ipcRenderer.invoke('xdebug:stepOut'),
    stopSession: () => ipcRenderer.invoke('xdebug:stopSession'),
    evalExpression: (expr) => ipcRenderer.invoke('xdebug:evalExpression', expr),
    onEvent: (cb) => subscribe<XdebugEventDto>('xdebug:event', cb)
  },
  bundle: {
    exportHmwPack: (payload) => ipcRenderer.invoke('bundle:exportHmwPack', payload),
    importHmwPack: (passphrase) => ipcRenderer.invoke('bundle:importHmwPack', passphrase)
  },
  island: {
    pushSnapshot: (snapshot) => ipcRenderer.invoke('island:pushSnapshot', snapshot),
    getSnapshot: () => ipcRenderer.invoke('island:getSnapshot'),
    setExpanded: (expanded) => ipcRenderer.invoke('island:setExpanded', expanded),
    dispatchCommand: (cmd) => ipcRenderer.invoke('island:dispatchCommand', cmd),
    onActivity: (cb) => subscribe<IslandActivity>('island:activity', cb),
    onSnapshot: (cb) => subscribe<DesktopIslandSnapshot>('island:snapshot', cb),
    onCommand: (cb) => subscribe<DesktopIslandCommand>('island:command', cb)
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:getState'),
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    openReleasePage: () => ipcRenderer.invoke('updater:openReleasePage'),
    onStateChanged: (cb) => subscribe<AppUpdateStateDto>('updater:stateChanged', cb)
  }
};

contextBridge.exposeInMainWorld('aptana', api);
