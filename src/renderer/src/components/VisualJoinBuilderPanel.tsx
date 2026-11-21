import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookMarked,
  Check,
  Code2,
  Copy,
  Database,
  FileSpreadsheet,
  Filter,
  KeyRound,
  LayoutGrid,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Unlink,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import type {
  DbColumnMeta,
  DbQueryResult,
  DbTableMeta,
  SavedSqlQueryItem,
  SavedVisualQuerySpec
} from '@shared/types';
import { extractFallbackSqlEntities, type SqlTableReference } from '@shared/sqlSchemaAnalyzer';
import {
  buildJoinQueryOutputs,
  buildJoinSpecFromSelectedTables,
  formatQualifiedTableForQuery,
  inferSmartJoinBetweenTables,
  suggestJoinCandidatesForQuery,
  suggestUniqueTableAlias,
  type SqlAggregateFunc,
  type SqlJoinOperator,
  type SqlJoinType,
  type SqlWhereOperator,
  type VisualJoinExtraCondition,
  type VisualJoinSelectedColumn,
  type VisualJoinStep,
  type VisualOrderByRule,
  type VisualWhereRule
} from '@shared/sqlJoinHelper';
import { getCombinedLearnedJoinEdges } from '../languages/phpIntelliSense';
import { useIdeStore } from '../store/useIdeStore';
import { SavedQueryDrawerPanel } from './SavedQueryDrawerPanel';
import { QueryChartPivotPanel } from './QueryChartPivotPanel';
import { VirtualScrollList } from './VirtualScrollList';

const CARD_WIDTH = 246;
const CARD_HEADER_H = 34;
const CARD_SUBHEADER_H = 26;
const FIELD_ROW_H = 23;
const MAX_VISIBLE_FIELD_ROWS = 10;

interface CanvasTableNode {
  id: string;
  schema?: string;
  name: string;
  alias: string;
  x: number;
  y: number;
  scrollTop: number;
  fieldFilter: string;
}

interface CanvasJoinLink {
  id: string;
  fromNodeId: string;
  fromColumn: string;
  toNodeId: string;
  toColumn: string;
  joinType: SqlJoinType;
  operator: SqlJoinOperator;
}

type BottomTabId = 'select' | 'where' | 'group-order' | 'code' | 'preview';
type CodeFormatId = 'sql' | 'phpMysql' | 'phpWisanggeni' | 'laravel';

const JoinVennIcon: React.FC<{ joinType: SqlJoinType; size?: number }> = ({
  joinType,
  size = 15
}) => {
  const leftFill =
    joinType === 'LEFT JOIN' ? 'rgba(56, 189, 248, 0.75)' : 'rgba(148, 163, 184, 0.14)';
  const rightFill =
    joinType === 'RIGHT JOIN' ? 'rgba(192, 132, 252, 0.75)' : 'rgba(148, 163, 184, 0.14)';
  const strokeColor =
    joinType === 'LEFT JOIN'
      ? '#38bdf8'
      : joinType === 'RIGHT JOIN'
        ? '#c084fc'
        : '#34d399';

  return (
    <svg width={size + 6} height={size} viewBox="0 0 22 15" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="7.5" r="5.5" fill={leftFill} stroke={strokeColor} strokeWidth="1.3" />
      <circle cx="14" cy="7.5" r="5.5" fill={rightFill} stroke={strokeColor} strokeWidth="1.3" />
      {joinType === 'INNER JOIN' && (
        <path
          d="M 11 2.9 A 5.5 5.5 0 0 1 11 12.1 A 5.5 5.5 0 0 1 11 2.9 Z"
          fill="rgba(52, 211, 153, 0.85)"
        />
      )}
    </svg>
  );
};

export const VisualJoinBuilderPanel: React.FC = () => {
  const {
    dbSchema,
    dbSchemaLoading,
    dbSchemaLoadingMessage,
    dbSchemaLoadingPercent,
    dbSchemaLoadingTargetDb,
    dbSchemaError,
    loadDbSchema,
    selectedDbProfileId,
    tabs,
    pendingJoinSeedTables,
    consumePendingJoinSeedTables,
    pendingVisualSavedQuery,
    consumePendingVisualSavedQuery,
    savedSqlQueries,
    recordSqlExecutionHistory,
    triggerSqlCodeLensAction,
    insertTextIntoActiveTab,
    openReportGenerator,
    setDbArchitectTab,
    showToast
  } = useIdeStore();

  // Merge live DB schema tables + fallback tables extracted from open PHP/SQL tabs
  const { allAvailableTables, fallbackOnlyKeySet } = useMemo(() => {
    const map = new Map<string, DbTableMeta>();
    const fbOnly = new Set<string>();
    const liveList = dbSchema?.allTables?.length
      ? dbSchema.allTables
      : dbSchema?.tables ?? [];
    for (const t of liveList) {
      const sch = t.schema ?? dbSchema?.currentDatabase ?? '';
      map.set(`${sch.toLowerCase()}.${t.name.toLowerCase()}`, {
        ...t,
        schema: sch || undefined
      });
    }
    const openSqlSources = tabs
      .filter((t) => t.language === 'php' || t.language === 'sql')
      .map((t) => t.content);
    if (openSqlSources.length > 0) {
      const fb = extractFallbackSqlEntities(openSqlSources);
      for (const ft of fb.tables) {
        const k = `${(ft.schema ?? '').toLowerCase()}.${ft.name.toLowerCase()}`;
        if (!map.has(k)) {
          map.set(k, ft);
          fbOnly.add(k);
        }
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) => {
      const sa = (a.schema ?? '').localeCompare(b.schema ?? '');
      return sa !== 0 ? sa : a.name.localeCompare(b.name);
    });
    return { allAvailableTables: sorted, fallbackOnlyKeySet: fbOnly };
  }, [dbSchema, tabs]);

  const activeDb = dbSchema?.currentDatabase ?? '';
  const learnedEdges = useMemo(() => getCombinedLearnedJoinEdges(), [tabs]);

  const availableDatabases = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const d of dbSchema?.databases ?? []) {
      if (d) set.add(d);
    }
    for (const t of allAvailableTables) {
      if (t.schema) set.add(t.schema);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dbSchema, allAvailableTables]);

  // Left palette state
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteDbFilter, setPaletteDbFilter] = useState<string>(
    dbSchema?.currentDatabase || '__ALL__'
  );
  const userPickedDbFilterRef = useRef(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [autoLinkOnAdd, setAutoLinkOnAdd] = useState(true);

  // Navicat Diagram Canvas state
  const [nodes, setNodes] = useState<CanvasTableNode[]>([]);
  const [links, setLinks] = useState<CanvasJoinLink[]>([]);
  const [zoom, setZoom] = useState(1);
  const [editingAliasNodeId, setEditingAliasNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // Interactive Drag-to-Move Card & Drag-Field-to-Field Wire state
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const [draggingCard, setDraggingCard] = useState<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const [wireDrag, setWireDrag] = useState<{
    fromNodeId: string;
    fromColumn: string;
    cursorCanvasX: number;
    cursorCanvasY: number;
  } | null>(null);

  const [pendingClickPort, setPendingClickPort] = useState<{
    nodeId: string;
    column: string;
  } | null>(null);

  const [hoveredTargetField, setHoveredTargetField] = useState<{
    nodeId: string;
    column: string;
  } | null>(null);

  // Query Clauses state (Navicat Bottom Pane)
  const [selectedCols, setSelectedCols] = useState<VisualJoinSelectedColumn[]>([]);
  const [distinct, setDistinct] = useState(false);
  const [autoAliasCollisions, setAutoAliasCollisions] = useState(true);
  const [whereRules, setWhereRules] = useState<VisualWhereRule[]>([]);
  const [manualWhere, setManualWhere] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [havingClause, setHavingClause] = useState('');
  const [orderByRules, setOrderByRules] = useState<VisualOrderByRule[]>([]);
  const [limit, setLimit] = useState<number>(100);
  const [offset, setOffset] = useState<number>(0);

  // Bottom Tabs & Output Code / Live Preview state
  const [bottomTab, setBottomTab] = useState<BottomTabId>('code');
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [codeFormat, setCodeFormat] = useState<CodeFormatId>('sql');
  const [copied, setCopied] = useState(false);
  const [previewResult, setPreviewResult] = useState<DbQueryResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [activeSavedQueryId, setActiveSavedQueryId] = useState<string | null>(null);
  const [chartViewOpen, setChartViewOpen] = useState(false);

  // Sync left DB dropdown to active database on initial load unless user manually picked a filter
  useEffect(() => {
    if (!userPickedDbFilterRef.current && dbSchema?.currentDatabase) {
      setPaletteDbFilter(dbSchema.currentDatabase);
    }
  }, [dbSchema?.currentDatabase]);

  // Live elapsed timer during query execution so user always sees active progress
  useEffect(() => {
    if (!previewLoading) {
      setPreviewElapsedMs(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      setPreviewElapsedMs(Date.now() - started);
    }, 100);
    return () => clearInterval(timer);
  }, [previewLoading]);

  const applySavedVisualItem = useCallback((item: SavedSqlQueryItem): void => {
    const spec = item.visualDiagramSpec;
    if (!spec) return;
    setNodes(
      spec.nodes.map((n) => ({
        id: n.id,
        schema: n.schema,
        name: n.name,
        alias: n.alias,
        x: n.x,
        y: n.y,
        scrollTop: n.scrollTop ?? 0,
        fieldFilter: n.fieldFilter ?? ''
      }))
    );
    setLinks(spec.links.map((l) => ({ ...l })));
    setSelectedCols(spec.selectedCols.map((c) => ({ ...c })));
    setDistinct(Boolean(spec.distinct));
    setAutoAliasCollisions(spec.autoAliasCollisions ?? true);
    setWhereRules(
      (spec.whereRules ?? []).map((w) => ({
        ...w,
        operator: w.operator as SqlWhereOperator
      }))
    );
    setManualWhere(spec.manualWhere ?? '');
    setGroupByColumns([...(spec.groupByColumns ?? [])]);
    setHavingClause(spec.havingClause ?? '');
    setOrderByRules((spec.orderByRules ?? []).map((o) => ({ ...o })));
    setLimit(spec.limit ?? 100);
    setOffset(spec.offset ?? 0);
    setActiveSavedQueryId(item.id);
    setSelectedLinkId(null);
    setSavedDrawerOpen(false);
  }, []);

  useEffect(() => {
    if (!pendingVisualSavedQuery) return;
    const req = consumePendingVisualSavedQuery();
    if (req?.visualDiagramSpec) {
      applySavedVisualItem(req);
    }
  }, [pendingVisualSavedQuery, consumePendingVisualSavedQuery, applySavedVisualItem]);

  const currentVisualSpec = useMemo<SavedVisualQuerySpec | undefined>(() => {
    if (nodes.length === 0) return undefined;
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        schema: n.schema,
        name: n.name,
        alias: n.alias,
        x: n.x,
        y: n.y,
        scrollTop: n.scrollTop,
        fieldFilter: n.fieldFilter
      })),
      links: links.map((l) => ({ ...l })),
      selectedCols: selectedCols.map((c) => ({ ...c })),
      distinct,
      autoAliasCollisions,
      whereRules: whereRules.map((w) => ({ ...w })),
      manualWhere,
      groupByColumns: [...groupByColumns],
      havingClause,
      orderByRules: orderByRules.map((o) => ({ ...o })),
      limit,
      offset
    };
  }, [
    nodes,
    links,
    selectedCols,
    distinct,
    autoAliasCollisions,
    whereRules,
    manualWhere,
    groupByColumns,
    havingClause,
    orderByRules,
    limit,
    offset
  ]);

  const resolveTableMeta = useCallback(
    (schema: string | undefined, name: string): DbTableMeta | undefined => {
      const sLow = (schema ?? '').toLowerCase();
      const nLow = name.toLowerCase();
      if (sLow) {
        const exact = allAvailableTables.find(
          (t) => (t.schema ?? '').toLowerCase() === sLow && t.name.toLowerCase() === nLow
        );
        if (exact) return exact;
      }
      if (activeDb) {
        const inActive = allAvailableTables.find(
          (t) =>
            (t.schema ?? '').toLowerCase() === activeDb.toLowerCase() &&
            t.name.toLowerCase() === nLow
        );
        if (inActive) return inActive;
      }
      return allAvailableTables.find((t) => t.name.toLowerCase() === nLow);
    },
    [allAvailableTables, activeDb]
  );

  const getFilteredColumnsForNode = useCallback(
    (node: CanvasTableNode): DbColumnMeta[] => {
      const meta = resolveTableMeta(node.schema, node.name);
      const cols = meta?.columns ?? [];
      const q = node.fieldFilter.trim().toLowerCase();
      if (!q) return cols;
      return cols.filter((c) => c.name.toLowerCase().includes(q));
    },
    [resolveTableMeta]
  );

  const getCardHeight = useCallback(
    (node: CanvasTableNode): number => {
      const cols = getFilteredColumnsForNode(node);
      const visibleCount = Math.max(1, Math.min(MAX_VISIBLE_FIELD_ROWS, cols.length));
      return CARD_HEADER_H + CARD_SUBHEADER_H + visibleCount * FIELD_ROW_H + 8;
    },
    [getFilteredColumnsForNode]
  );

  // Hydrate initial seed tables (from ER Diagram `+JOIN` or Sidebar table `Rakit JOIN`) or first DB table
  const seedAppliedRef = useRef(false);
  useEffect(() => {
    if (pendingJoinSeedTables && pendingJoinSeedTables.length > 0) {
      const seeds = consumePendingJoinSeedTables() ?? [];
      if (seeds.length > 0) {
        const spec = buildJoinSpecFromSelectedTables(
          seeds,
          allAvailableTables,
          activeDb || undefined,
          learnedEdges
        );

        const baseNodeId = `node-1`;
        const nextNodes: CanvasTableNode[] = [
          {
            id: baseNodeId,
            schema: spec.baseSchema,
            name: spec.baseTable,
            alias: spec.baseAlias,
            x: 34,
            y: 34,
            scrollTop: 0,
            fieldFilter: ''
          }
        ];

        const aliasToNodeId = new Map<string, string>([[spec.baseAlias, baseNodeId]]);
        spec.joins.forEach((j, idx) => {
          const nid = `node-${idx + 2}`;
          aliasToNodeId.set(j.alias, nid);
          const colSlot = (idx + 1) % 3;
          const rowSlot = Math.floor((idx + 1) / 3);
          nextNodes.push({
            id: nid,
            schema: j.targetSchema,
            name: j.targetTable,
            alias: j.alias,
            x: 34 + colSlot * 310,
            y: 34 + rowSlot * 320,
            scrollTop: 0,
            fieldFilter: ''
          });
        });

        const nextLinks: CanvasJoinLink[] = spec.joins.map((j, idx) => {
          const dotIdx = j.leftRef.indexOf('.');
          const srcAlias = dotIdx > 0 ? j.leftRef.slice(0, dotIdx) : spec.baseAlias;
          const srcCol = dotIdx > 0 ? j.leftRef.slice(dotIdx + 1) : j.leftRef;
          const fromNodeId = aliasToNodeId.get(srcAlias) ?? baseNodeId;
          const toNodeId = aliasToNodeId.get(j.alias) ?? `node-${idx + 2}`;
          return {
            id: `link-${Date.now()}-${idx}`,
            fromNodeId,
            fromColumn: srcCol,
            toNodeId,
            toColumn: j.rightColumn,
            joinType: j.joinType,
            operator: j.operator ?? '='
          };
        });

        setNodes(nextNodes);
        setLinks(nextLinks);
        setSelectedCols([]);
        setSelectedLinkId(null);
        seedAppliedRef.current = true;
        return;
      }
    }

    // Wait until initial DB schema load finishes before auto-seeding a fallback table
    if (dbSchemaLoading && !dbSchema) {
      return;
    }

    if (!seedAppliedRef.current && nodes.length === 0 && allAvailableTables.length > 0) {
      const preferred =
        allAvailableTables.find(
          (t) => activeDb && (t.schema ?? '').toLowerCase() === activeDb.toLowerCase()
        ) ?? allAvailableTables[0];
      if (preferred) {
        const alias = suggestUniqueTableAlias(preferred.name, new Set());
        setNodes([
          {
            id: 'node-init-1',
            schema: preferred.schema,
            name: preferred.name,
            alias,
            x: 36,
            y: 34,
            scrollTop: 0,
            fieldFilter: ''
          }
        ]);
        seedAppliedRef.current = true;
      }
    }
  }, [
    pendingJoinSeedTables,
    consumePendingJoinSeedTables,
    allAvailableTables,
    activeDb,
    learnedEdges,
    nodes.length,
    dbSchemaLoading,
    dbSchema
  ]);

  // Escape cancels click-to-wire mode or closes Join Popover
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPendingClickPort(null);
        setWireDrag(null);
        setSelectedLinkId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Mousemove / Mouseup for smooth Card Dragging and Field-to-Field Wire Dragging
  const clientToCanvasCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = canvasScrollRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left + el.scrollLeft) / zoom,
        y: (clientY - rect.top + el.scrollTop) / zoom
      };
    },
    [zoom]
  );

  useEffect(() => {
    if (!draggingCard && !wireDrag) return;

    const handleMove = (e: MouseEvent): void => {
      if (draggingCard) {
        const dx = (e.clientX - draggingCard.startClientX) / zoom;
        const dy = (e.clientY - draggingCard.startClientY) / zoom;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === draggingCard.nodeId
              ? {
                  ...n,
                  x: Math.max(12, Math.round(draggingCard.origX + dx)),
                  y: Math.max(12, Math.round(draggingCard.origY + dy))
                }
              : n
          )
        );
      } else if (wireDrag) {
        const pt = clientToCanvasCoords(e.clientX, e.clientY);
        setWireDrag((prev) =>
          prev ? { ...prev, cursorCanvasX: pt.x, cursorCanvasY: pt.y } : null
        );
      }
    };

    const handleUp = (): void => {
      if (draggingCard) {
        setDraggingCard(null);
      }
      if (wireDrag) {
        setWireDrag(null);
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingCard, wireDrag, zoom, clientToCanvasCoords]);

  // Connect two fields on the canvas (creates a new link or avoids exact duplicate)
  const connectTableFields = useCallback(
    (
      nodeAId: string,
      colA: string,
      nodeBId: string,
      colB: string,
      preferredJoinType: SqlJoinType = 'LEFT JOIN'
    ): void => {
      if (nodeAId === nodeBId) {
        showToast('Untuk Self-Join, tambahkan tabel yang sama sekali lagi ke kanvas lalu tarik garisnya.');
        return;
      }

      setLinks((prev) => {
        const exists = prev.some(
          (l) =>
            (l.fromNodeId === nodeAId &&
              l.fromColumn.toLowerCase() === colA.toLowerCase() &&
              l.toNodeId === nodeBId &&
              l.toColumn.toLowerCase() === colB.toLowerCase()) ||
            (l.fromNodeId === nodeBId &&
              l.fromColumn.toLowerCase() === colB.toLowerCase() &&
              l.toNodeId === nodeAId &&
              l.toColumn.toLowerCase() === colA.toLowerCase())
        );
        if (exists) return prev;

        // Orient from earlier-placed node -> later-placed node so join direction matches FROM -> JOIN order
        const idxA = nodes.findIndex((n) => n.id === nodeAId);
        const idxB = nodes.findIndex((n) => n.id === nodeBId);
        const forward = idxA <= idxB;

        const newLink: CanvasJoinLink = {
          id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fromNodeId: forward ? nodeAId : nodeBId,
          fromColumn: forward ? colA : colB,
          toNodeId: forward ? nodeBId : nodeAId,
          toColumn: forward ? colB : colA,
          joinType: preferredJoinType,
          operator: '='
        };
        setSelectedLinkId(newLink.id);
        return [...prev, newLink];
      });

      setPendingClickPort(null);
      setWireDrag(null);
    },
    [nodes, showToast]
  );

  // Add a table onto the Navicat Canvas (via click `+`, double-click, recommendation chip, or drag-and-drop!)
  const addTableToCanvas = useCallback(
    (
      tbl: { schema?: string; name: string },
      customPos?: { x: number; y: number },
      explicitJoin?: {
        sourceAlias: string;
        sourceColumn: string;
        targetColumn: string;
      }
    ): void => {
      const usedAliases = new Set<string>();
      for (const n of nodes) {
        usedAliases.add(n.alias.toLowerCase());
        usedAliases.add(n.name.toLowerCase());
      }
      const newAlias = suggestUniqueTableAlias(tbl.name, usedAliases);
      const newNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const defaultCol = nodes.length % 3;
      const defaultRow = Math.floor(nodes.length / 3);
      const posX = customPos ? Math.max(16, Math.round(customPos.x)) : 36 + defaultCol * 308;
      const posY = customPos ? Math.max(16, Math.round(customPos.y)) : 34 + defaultRow * 326;

      const newNode: CanvasTableNode = {
        id: newNodeId,
        schema: tbl.schema,
        name: tbl.name,
        alias: newAlias,
        x: posX,
        y: posY,
        scrollTop: 0,
        fieldFilter: ''
      };

      setNodes((prev) => [...prev, newNode]);

      if (nodes.length > 0) {
        const chosenRel =
          explicitJoin ??
          (autoLinkOnAdd
            ? inferSmartJoinBetweenTables({
                existingTables: nodes.map((n) => ({
                  schema: n.schema,
                  name: n.name,
                  alias: n.alias
                })),
                targetTable: tbl,
                allTables: allAvailableTables,
                activeDatabase: activeDb || undefined,
                learnedEdges
              })
            : null);

        if (chosenRel) {
          const srcNode = nodes.find(
            (n) => n.alias.toLowerCase() === chosenRel.sourceAlias.toLowerCase()
          );
          if (srcNode) {
            setLinks((prev) => [
              ...prev,
              {
                id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                fromNodeId: srcNode.id,
                fromColumn: chosenRel.sourceColumn,
                toNodeId: newNodeId,
                toColumn: chosenRel.targetColumn,
                joinType: 'LEFT JOIN',
                operator: '='
              }
            ]);
          }
        }
      }
    },
    [nodes, autoLinkOnAdd, allAvailableTables, activeDb, learnedEdges]
  );

  const removeNodeFromCanvas = (nodeId: string): void => {
    const target = nodes.find((n) => n.id === nodeId);
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setLinks((prev) =>
      prev.filter((l) => l.fromNodeId !== nodeId && l.toNodeId !== nodeId)
    );
    if (target) {
      setSelectedCols((prev) => prev.filter((c) => c.tableAlias !== target.alias));
      setGroupByColumns((prev) =>
        prev.filter((g) => !g.toLowerCase().startsWith(`${target.alias.toLowerCase()}.`))
      );
      setOrderByRules((prev) =>
        prev.filter((o) => !o.columnRef.toLowerCase().startsWith(`${target.alias.toLowerCase()}.`))
      );
    }
  };

  const promoteNodeToBaseFrom = (nodeId: string): void => {
    setNodes((prev) => {
      const idx = prev.findIndex((n) => n.id === nodeId);
      if (idx <= 0) return prev;
      const picked = prev[idx];
      return [picked, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  const handleRenameNodeAlias = (nodeId: string, rawNextAlias: string): void => {
    const clean = rawNextAlias.trim().replace(/[^A-Za-z0-9_]/g, '');
    if (!clean) {
      setEditingAliasNodeId(null);
      return;
    }
    const target = nodes.find((n) => n.id === nodeId);
    if (!target || target.alias === clean) {
      setEditingAliasNodeId(null);
      return;
    }
    if (nodes.some((n) => n.id !== nodeId && n.alias.toLowerCase() === clean.toLowerCase())) {
      showToast(`Alias "${clean}" sudah dipakai tabel lain di kanvas.`);
      return;
    }
    const oldAlias = target.alias;
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, alias: clean } : n)));
    setSelectedCols((prev) =>
      prev.map((c) => (c.tableAlias === oldAlias ? { ...c, tableAlias: clean } : c))
    );
    setWhereRules((prev) =>
      prev.map((w) =>
        w.columnRef.startsWith(`${oldAlias}.`)
          ? { ...w, columnRef: `${clean}.${w.columnRef.slice(oldAlias.length + 1)}` }
          : w
      )
    );
    setGroupByColumns((prev) =>
      prev.map((g) =>
        g.startsWith(`${oldAlias}.`) ? `${clean}.${g.slice(oldAlias.length + 1)}` : g
      )
    );
    setOrderByRules((prev) =>
      prev.map((o) =>
        o.columnRef.startsWith(`${oldAlias}.`)
          ? { ...o, columnRef: `${clean}.${o.columnRef.slice(oldAlias.length + 1)}` }
          : o
      )
    );
    setEditingAliasNodeId(null);
  };

  const handleAutoArrangeLayout = (): void => {
    setNodes((prev) =>
      prev.map((n, idx) => ({
        ...n,
        x: 36 + (idx % 3) * 308,
        y: 34 + Math.floor(idx / 3) * 328
      }))
    );
  };

  const toggleFieldChecked = (tableAlias: string, columnName: string): void => {
    setSelectedCols((prev) => {
      const exists = prev.some(
        (c) =>
          c.tableAlias === tableAlias &&
          c.columnName === columnName &&
          !c.aggregate
      );
      if (exists) {
        return prev.filter(
          (c) =>
            !(
              c.tableAlias === tableAlias &&
              c.columnName === columnName &&
              !c.aggregate
            )
        );
      }
      return [...prev, { tableAlias, columnName }];
    });
  };

  const toggleAllFieldsForNode = (node: CanvasTableNode): void => {
    const meta = resolveTableMeta(node.schema, node.name);
    const cols = meta?.columns ?? [];
    if (cols.length === 0) {
      toggleFieldChecked(node.alias, '*');
      return;
    }
    const allChecked = cols.every((col) =>
      selectedCols.some((sc) => sc.tableAlias === node.alias && sc.columnName === col.name)
    );
    if (allChecked) {
      setSelectedCols((prev) => prev.filter((sc) => sc.tableAlias !== node.alias));
    } else {
      setSelectedCols((prev) => {
        const withoutNode = prev.filter((sc) => sc.tableAlias !== node.alias);
        return [
          ...withoutNode,
          ...cols.map((col) => ({ tableAlias: node.alias, columnName: col.name }))
        ];
      });
    }
  };

  // Compute Smart Related Table Chips based on tables currently on Canvas
  const recommendedJoinChips = useMemo(() => {
    if (nodes.length === 0) return [];
    const existingRefs: SqlTableReference[] = nodes.map((n) => ({
      schema: n.schema,
      schemaLower: n.schema?.toLowerCase(),
      table: n.name,
      tableLower: n.name.toLowerCase(),
      alias: n.alias,
      aliasLower: n.alias.toLowerCase()
    }));
    return suggestJoinCandidatesForQuery({
      existingRefs,
      allTables: allAvailableTables,
      activeDatabase: activeDb || undefined,
      learnedEdges,
      maxResults: 12
    });
  }, [nodes, allAvailableTables, activeDb, learnedEdges]);

  const recommendedTableKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const c of recommendedJoinChips) {
      s.add(`${(c.targetSchema ?? activeDb ?? '').toLowerCase()}.${c.targetTable.toLowerCase()}`);
    }
    return s;
  }, [recommendedJoinChips, activeDb]);

  // Filtered Left Palette tables (keep live DB tables cleanly above PHP fallback tables!)
  const filteredPaletteTables = useMemo(() => {
    const q = paletteSearch.trim().toLowerCase();
    const hasLiveTablesInSelectedDb =
      paletteDbFilter !== '__ALL__' &&
      Boolean(dbSchema) &&
      allAvailableTables.some(
        (t) =>
          !fallbackOnlyKeySet.has(`${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`) &&
          (t.schema ?? activeDb).toLowerCase() === paletteDbFilter.toLowerCase()
      );

    return allAvailableTables
      .filter((t) => {
        const isFallback = fallbackOnlyKeySet.has(
          `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`
        );
        if (paletteDbFilter !== '__ALL__') {
          if (isFallback && !t.schema && hasLiveTablesInSelectedDb) {
            return false;
          }
          if ((t.schema ?? activeDb).toLowerCase() !== paletteDbFilter.toLowerCase()) {
            return false;
          }
        }
        if (!q) return true;
        return (
          t.name.toLowerCase().includes(q) ||
          (t.schema ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const fbA = fallbackOnlyKeySet.has(
          `${(a.schema ?? '').toLowerCase()}.${a.name.toLowerCase()}`
        )
          ? 1
          : 0;
        const fbB = fallbackOnlyKeySet.has(
          `${(b.schema ?? '').toLowerCase()}.${b.name.toLowerCase()}`
        )
          ? 1
          : 0;
        if (fbA !== fbB) return fbA - fbB;
        return a.name.localeCompare(b.name);
      });
  }, [allAvailableTables, fallbackOnlyKeySet, dbSchema, paletteDbFilter, paletteSearch, activeDb]);

  // All qualified `alias.col` choices across canvas tables (for WHERE / GROUP BY / ORDER BY dropdowns)
  const allCanvasColumnRefs = useMemo(() => {
    const out: Array<{ ref: string; label: string; tableAlias: string }> = [];
    for (const n of nodes) {
      const meta = resolveTableMeta(n.schema, n.name);
      for (const col of meta?.columns ?? []) {
        out.push({
          ref: `${n.alias}.${col.name}`,
          label: `${n.alias}.${col.name} (${n.name})`,
          tableAlias: n.alias
        });
      }
    }
    return out;
  }, [nodes, resolveTableMeta]);

  // Convert Navicat Canvas `(nodes, links)` into `VisualJoinStep[]` + generated outputs!
  const { visualJoinSteps, unlinkedNodeIds } = useMemo(() => {
    if (nodes.length <= 1) {
      return { visualJoinSteps: [] as VisualJoinStep[], unlinkedNodeIds: new Set<string>() };
    }

    const baseNode = nodes[0];
    const placedIds = new Set<string>([baseNode.id]);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const steps: VisualJoinStep[] = [];
    const unlinked = new Set<string>();

    for (let i = 1; i < nodes.length; i++) {
      const tgt = nodes[i];
      // Find all links connecting any already-placed node <-> `tgt`
      const matchingLinks = links.filter(
        (l) =>
          (placedIds.has(l.fromNodeId) && l.toNodeId === tgt.id) ||
          (placedIds.has(l.toNodeId) && l.fromNodeId === tgt.id)
      );

      if (matchingLinks.length > 0) {
        const primary = matchingLinks[0];
        const primaryIsForward = placedIds.has(primary.fromNodeId);
        const srcNode =
          nodeById.get(primaryIsForward ? primary.fromNodeId : primary.toNodeId) ?? baseNode;
        const srcCol = primaryIsForward ? primary.fromColumn : primary.toColumn;
        const tgtCol = primaryIsForward ? primary.toColumn : primary.fromColumn;

        const extraConditions: VisualJoinExtraCondition[] = matchingLinks.slice(1).map((ex) => {
          const fwd = placedIds.has(ex.fromNodeId);
          const exSrcNode = nodeById.get(fwd ? ex.fromNodeId : ex.toNodeId) ?? baseNode;
          const exSrcCol = fwd ? ex.fromColumn : ex.toColumn;
          const exTgtCol = fwd ? ex.toColumn : ex.fromColumn;
          return {
            leftRef: `${exSrcNode.alias}.${exSrcCol}`,
            operator: ex.operator,
            rightColumn: exTgtCol
          };
        });

        steps.push({
          id: primary.id,
          joinType: primary.joinType,
          targetSchema: tgt.schema,
          targetTable: tgt.name,
          alias: tgt.alias,
          leftRef: `${srcNode.alias}.${srcCol}`,
          operator: primary.operator,
          rightColumn: tgtCol,
          extraConditions: extraConditions.length > 0 ? extraConditions : undefined
        });
      } else {
        unlinked.add(tgt.id);
        const baseMeta = resolveTableMeta(baseNode.schema, baseNode.name);
        const tgtMeta = resolveTableMeta(tgt.schema, tgt.name);
        const fbLeft = baseMeta?.primaryKeys[0] ?? baseMeta?.columns[0]?.name ?? 'id';
        const fbRight = tgtMeta?.primaryKeys[0] ?? tgtMeta?.columns[0]?.name ?? 'id';
        steps.push({
          id: `unlinked-${tgt.id}`,
          joinType: 'LEFT JOIN',
          targetSchema: tgt.schema,
          targetTable: tgt.name,
          alias: tgt.alias,
          leftRef: `${baseNode.alias}.${fbLeft}`,
          operator: '=',
          rightColumn: fbRight
        });
      }

      placedIds.add(tgt.id);
    }

    return { visualJoinSteps: steps, unlinkedNodeIds: unlinked };
  }, [nodes, links, resolveTableMeta]);

  const generatedOutputs = useMemo(() => {
    const baseNode = nodes[0];
    if (!baseNode) {
      return {
        sql: '-- Tarik atau klik [+] pada tabel di panel kiri untuk mulai merakit query visual.',
        phpMysql: '// Pilih tabel di kanvas terlebih dahulu',
        phpWisanggeni: '// Pilih tabel di kanvas terlebih dahulu',
        laravelQueryBuilder: '// Pilih tabel di kanvas terlebih dahulu'
      };
    }
    return buildJoinQueryOutputs(
      {
        baseSchema: baseNode.schema,
        baseTable: baseNode.name,
        baseAlias: baseNode.alias,
        joins: visualJoinSteps,
        selectedColumns: selectedCols,
        distinct,
        autoAliasCollisions,
        whereRules,
        whereClause: manualWhere,
        groupByColumns,
        havingClause,
        orderByRules,
        limit,
        offset,
        activeDatabase: activeDb || undefined
      },
      allAvailableTables
    );
  }, [
    nodes,
    visualJoinSteps,
    selectedCols,
    distinct,
    autoAliasCollisions,
    whereRules,
    manualWhere,
    groupByColumns,
    havingClause,
    orderByRules,
    limit,
    offset,
    activeDb,
    allAvailableTables
  ]);

  const displayedCode =
    codeFormat === 'sql'
      ? generatedOutputs.sql
      : codeFormat === 'phpMysql'
        ? generatedOutputs.phpMysql
        : codeFormat === 'phpWisanggeni'
          ? generatedOutputs.phpWisanggeni
          : generatedOutputs.laravelQueryBuilder;

  // Canvas dimensions & exact SVG Port coordinate calculator
  const canvasSize = useMemo(() => {
    let maxX = 860;
    let maxY = 390;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.x + CARD_WIDTH + 90);
      maxY = Math.max(maxY, n.y + getCardHeight(n) + 70);
    }
    return { width: maxX, height: maxY };
  }, [nodes, getCardHeight]);

  const getPortPosition = useCallback(
    (
      node: CanvasTableNode,
      columnName: string,
      side: 'left' | 'right'
    ): { x: number; y: number } => {
      const cols = getFilteredColumnsForNode(node);
      const idx = cols.findIndex((c) => c.name.toLowerCase() === columnName.toLowerCase());
      const cardH = getCardHeight(node);
      const rawCenterY =
        CARD_HEADER_H +
        CARD_SUBHEADER_H +
        (idx >= 0 ? idx * FIELD_ROW_H + FIELD_ROW_H / 2 : FIELD_ROW_H / 2) -
        node.scrollTop;
      const clampedY = Math.max(
        CARD_HEADER_H + CARD_SUBHEADER_H + 6,
        Math.min(cardH - 8, rawCenterY)
      );
      return {
        x: side === 'right' ? node.x + CARD_WIDTH : node.x,
        y: node.y + clampedY
      };
    },
    [getFilteredColumnsForNode, getCardHeight]
  );

  const renderedLinks = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return links
      .map((lnk) => {
        const fromNode = nodeMap.get(lnk.fromNodeId);
        const toNode = nodeMap.get(lnk.toNodeId);
        if (!fromNode || !toNode) return null;

        const fromRight = fromNode.x + CARD_WIDTH / 2 <= toNode.x + CARD_WIDTH / 2;
        const p1 = getPortPosition(fromNode, lnk.fromColumn, fromRight ? 'right' : 'left');
        const p2 = getPortPosition(toNode, lnk.toColumn, fromRight ? 'left' : 'right');
        const dx = Math.max(54, Math.abs(p2.x - p1.x) * 0.45);
        const c1x = fromRight ? p1.x + dx : p1.x - dx;
        const c2x = fromRight ? p2.x - dx : p2.x + dx;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        return {
          link: lnk,
          fromNode,
          toNode,
          p1,
          p2,
          pathD: `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`,
          midX,
          midY
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [links, nodes, getPortPosition]);

  // Actions: Copy, Insert, Run Live Preview, Export Excel, Auto GROUP BY
  const handleCopyCode = async (): Promise<void> => {
    await navigator.clipboard.writeText(displayedCode);
    setCopied(true);
    showToast('Kode hasil Visual Query Builder disalin ke clipboard.');
    setTimeout(() => setCopied(false), 1800);
  };

  const handleInsertIntoEditor = (): void => {
    insertTextIntoActiveTab(displayedCode);
    setDbArchitectTab('closed');
  };

  const handleOpenInSqlRunner = (): void => {
    const baseNode = nodes[0];
    setDbArchitectTab('closed');
    triggerSqlCodeLensAction({
      mode: 'run',
      sqlTemplate: generatedOutputs.sql,
      params: [],
      sourceTitle: 'Navicat Visual Query Builder',
      primaryTable: baseNode ? { schema: baseNode.schema, table: baseNode.name } : null
    });
  };

  const handleRunLivePreview = async (): Promise<void> => {
    if (!selectedDbProfileId) {
      showToast('Hubungkan profil Database di Sidebar kiri terlebih dahulu untuk menguji live.');
      return;
    }
    if (nodes.length === 0) return;

    setBottomExpanded(true);
    setBottomTab('preview');
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await window.aptana.db.query(
        selectedDbProfileId,
        generatedOutputs.sql,
        activeDb || undefined,
        Math.min(limit || 100, 500)
      );
      setPreviewResult(res);
      recordSqlExecutionHistory({
        sql: generatedOutputs.sql,
        profileId: selectedDbProfileId,
        database: activeDb || undefined,
        rowCount: res.rowCount,
        durationMs: res.durationMs
      });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExportPreviewExcel = async (): Promise<void> => {
    if (!previewResult || previewResult.rows.length === 0) return;
    const baseName = nodes[0]?.name || 'query_join';
    setExportingXlsx(true);
    try {
      const res = await window.aptana.db.exportExcel({
        defaultFileName: `join_${baseName}.xlsx`,
        sheetName: `JOIN ${baseName}`.slice(0, 31),
        columns: previewResult.columns,
        rows: previewResult.rows,
        openAfterSave: true
      });
      if (!res.canceled && res.filePath) {
        showToast(`Excel JOIN tersimpan (${res.rowCount} baris): ${res.filePath}`);
      }
    } catch (err) {
      showToast(`Gagal export Excel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleAutoGroupBy = (): void => {
    const plainSelected = selectedCols
      .filter((c) => !c.aggregate && c.columnName !== '*')
      .map((c) => `${c.tableAlias}.${c.columnName}`);
    if (plainSelected.length === 0) {
      showToast('Centang minimal 1 kolom biasa (non-agregasi) untuk mengisi GROUP BY otomatis.');
      return;
    }
    setGroupByColumns(Array.from(new Set([...groupByColumns, ...plainSelected])));
  };

  const addWhereRule = (): void => {
    const defaultCol = allCanvasColumnRefs[0]?.ref ?? '';
    setWhereRules((prev) => [
      ...prev,
      {
        id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        conjunction: 'AND',
        columnRef: defaultCol,
        operator: '=',
        value: '1',
        enabled: true
      }
    ]);
  };

  const addOrderByRule = (): void => {
    const defaultCol = allCanvasColumnRefs[0]?.ref ?? '';
    setOrderByRules((prev) => [
      ...prev,
      {
        id: `ob-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        columnRef: defaultCol,
        direction: 'ASC'
      }
    ]);
  };

  const selectedLinkInfo = useMemo(
    () => renderedLinks.find((rl) => rl.link.id === selectedLinkId) ?? null,
    [renderedLinks, selectedLinkId]
  );

  // Set of `(nodeId:colLower)` that participate in any active link so field rows light up with `🔗`!
  const linkedFieldKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) {
      s.add(`${l.fromNodeId}:${l.fromColumn.toLowerCase()}`);
      s.add(`${l.toNodeId}:${l.toColumn.toLowerCase()}`);
    }
    return s;
  }, [links]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        userSelect: draggingCard || wireDrag ? 'none' : 'auto'
      }}
    >
      {/* 1. LEFT PALETTE: Database & Table List (Drag or Click + onto Canvas, Navicat-style) */}
      {paletteOpen && (
        <div
          style={{
            width: 248,
            flexShrink: 0,
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                {dbSchemaLoading ? (
                  <>
                    <RefreshCw size={12} className="spin" color="#38bdf8" />
                    <span style={{ color: '#7dd3fc' }}>Memuat Database...</span>
                  </>
                ) : (
                  <>
                    <Database size={12} color="var(--accent)" />
                    <span>Daftar Tabel ({filteredPaletteTables.length})</span>
                  </>
                )}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {selectedDbProfileId && (
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ padding: 2 }}
                    disabled={dbSchemaLoading}
                    title="Muat ulang skema & daftar tabel database aktif dari server"
                    onClick={() =>
                      void loadDbSchema(
                        selectedDbProfileId,
                        paletteDbFilter !== '__ALL__' ? paletteDbFilter : activeDb || undefined,
                        true
                      )
                    }
                  >
                    <RefreshCw size={12} className={dbSchemaLoading ? 'spin' : ''} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  style={{ padding: 2 }}
                  title="Sembunyikan Panel Tabel"
                  onClick={() => setPaletteOpen(false)}
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
            </div>

            <select
              className="form-input"
              style={{ fontSize: 11.5, padding: '4px 7px' }}
              value={paletteDbFilter}
              disabled={dbSchemaLoading && availableDatabases.length === 0}
              onChange={(e) => {
                const nextDb = e.target.value;
                userPickedDbFilterRef.current = true;
                setPaletteDbFilter(nextDb);
                if (nextDb !== '__ALL__' && selectedDbProfileId) {
                  const liveCountInDb = (dbSchema?.allTables ?? dbSchema?.tables ?? []).filter(
                    (t) => (t.schema ?? dbSchema?.currentDatabase ?? '').toLowerCase() === nextDb.toLowerCase()
                  ).length;
                  if (
                    !dbSchema ||
                    dbSchema.currentDatabase.toLowerCase() !== nextDb.toLowerCase() ||
                    liveCountInDb === 0
                  ) {
                    void loadDbSchema(selectedDbProfileId, nextDb, false);
                  }
                }
              }}
            >
              <option value="__ALL__">Semua Database ({allAvailableTables.length})</option>
              {availableDatabases.map((dbName) => {
                const isCur = activeDb && dbName.toLowerCase() === activeDb.toLowerCase();
                return (
                  <option key={dbName} value={dbName}>
                    {dbName}
                    {isCur ? ' (Aktif)' : ''}
                  </option>
                );
              })}
            </select>

            <div style={{ position: 'relative' }}>
              <Search
                size={12}
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 7,
                  color: 'var(--text-muted)'
                }}
              />
              <input
                type="text"
                className="form-input"
                style={{ fontSize: 11.5, padding: '4px 8px 4px 25px', width: '100%' }}
                placeholder="Cari tabel (tarik / klik +)..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
              />
            </div>

            {/* Live Database Loading Status Card inside Left Palette */}
            {dbSchemaLoading && (
              <div
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 4,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: '#bae6fd'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ⏳ Memuat{dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ' DB'}...
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
                    {dbSchemaLoadingPercent}%
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                  {dbSchemaLoadingMessage || 'Mengambil daftar tabel, kolom & Foreign Key...'}
                </div>
                <div
                  style={{
                    height: 3.5,
                    borderRadius: 999,
                    background: 'rgba(15, 23, 42, 0.7)',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(8, dbSchemaLoadingPercent)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                      transition: 'width 0.22s ease'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Database Connection Error / Unloaded Schema Notice */}
            {!dbSchemaLoading && dbSchemaError && (
              <div
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.13)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: 10.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700 }}>
                  <AlertTriangle size={12} /> Gagal memuat database
                </div>
                <div style={{ fontSize: 10, opacity: 0.9 }}>{dbSchemaError}</div>
                {selectedDbProfileId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '2px 6px', fontSize: 10, justifyContent: 'center' }}
                    onClick={() =>
                      void loadDbSchema(
                        selectedDbProfileId,
                        paletteDbFilter !== '__ALL__' ? paletteDbFilter : undefined,
                        true
                      )
                    }
                  >
                    <RefreshCw size={10} /> Coba Muat Ulang
                  </button>
                )}
              </div>
            )}

            {!dbSchemaLoading && !dbSchema && !dbSchemaError && selectedDbProfileId && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '4px 8px', fontSize: 11, justifyContent: 'center' }}
                onClick={() => void loadDbSchema(selectedDbProfileId, undefined, true)}
              >
                <RefreshCw size={11} /> Muat Skema Database Sekarang
              </button>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {dbSchemaLoading && filteredPaletteTables.length === 0 ? (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
                {[82, 68, 90, 74, 62, 86].map((w, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '6px 7px',
                      borderRadius: 6,
                      border: '1px solid rgba(56, 189, 248, 0.14)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5
                    }}
                  >
                    <div className="hmw-skeleton-bar" style={{ height: 11, width: `${w}%` }} />
                    <div className="hmw-skeleton-bar" style={{ height: 8, width: '42%' }} />
                  </div>
                ))}
              </div>
            ) : (
              <VirtualScrollList
                items={filteredPaletteTables}
                itemHeight={42}
                overscan={12}
                style={{ flex: 1, padding: '4px 6px' }}
                getKey={(tbl) => `${tbl.schema ?? ''}.${tbl.name}`}
                emptyState={
                  <div style={{ padding: 12, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Tidak ada tabel yang cocok. Hubungkan Database di Sidebar atau pilih database lain di atas.
                  </div>
                }
                renderItem={(tbl) => {
                  const fullKey = `${(tbl.schema ?? activeDb ?? '').toLowerCase()}.${tbl.name.toLowerCase()}`;
                  const onCanvasCount = nodes.filter(
                    (n) =>
                      n.name.toLowerCase() === tbl.name.toLowerCase() &&
                      (n.schema ?? activeDb ?? '').toLowerCase() ===
                        (tbl.schema ?? activeDb ?? '').toLowerCase()
                  ).length;
                  const isRecommended = recommendedTableKeySet.has(fullKey);
                  const showSchemaPrefix =
                    tbl.schema && (!activeDb || tbl.schema.toLowerCase() !== activeDb.toLowerCase());

                  return (
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'application/hmw-join-table',
                          JSON.stringify({ schema: tbl.schema, name: tbl.name })
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDoubleClick={() => addTableToCanvas({ schema: tbl.schema, name: tbl.name })}
                      title="Tarik (Drag & Drop) ke Kanvas atau klik ganda untuk menambahkan tabel"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        height: 40,
                        padding: '4px 7px',
                        marginBottom: 2,
                        borderRadius: 6,
                        cursor: 'grab',
                        fontSize: 11.5,
                        background:
                          onCanvasCount > 0
                            ? 'rgba(16, 185, 129, 0.09)'
                            : isRecommended
                              ? 'rgba(56, 189, 248, 0.08)'
                              : 'transparent',
                        border:
                          onCanvasCount > 0
                            ? '1px solid rgba(16, 185, 129, 0.3)'
                            : isRecommended
                              ? '1px solid rgba(56, 189, 248, 0.25)'
                              : '1px solid transparent'
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <Table2
                            size={12}
                            color={
                              onCanvasCount > 0
                                ? '#34d399'
                                : isRecommended
                                  ? '#38bdf8'
                                  : 'var(--text-muted)'
                            }
                            style={{ flexShrink: 0 }}
                          />
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: onCanvasCount > 0 || isRecommended ? 600 : 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {showSchemaPrefix ? `${tbl.schema}.` : ''}
                            {tbl.name}
                          </span>
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', paddingLeft: 17 }}>
                          {tbl.columns.length} field
                          {fallbackOnlyKeySet.has(
                            `${(tbl.schema ?? '').toLowerCase()}.${tbl.name.toLowerCase()}`
                          )
                            ? ' • dari kode PHP'
                            : ''}
                          {isRecommended ? ' • ★ Relasi cocok' : ''}
                          {onCanvasCount > 0 ? ` • Di kanvas (${onCanvasCount})` : ''}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 6px', fontSize: 10.5, flexShrink: 0 }}
                        title={`Tambahkan ${tbl.name} ke Kanvas Diagram`}
                        onClick={() => addTableToCanvas({ schema: tbl.schema, name: tbl.name })}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* 2. RIGHT MAIN AREA: Top Diagram Canvas + Bottom Navicat Multi-Tab Designer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Canvas Toolbar */}
        <div
          style={{
            padding: '7px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {!paletteOpen && (
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => setPaletteOpen(true)}
                title="Buka Panel Daftar Tabel"
              >
                <PanelLeftOpen size={12} /> Daftar Tabel
              </button>
            )}

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '2px 7px',
                borderRadius: 5,
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)'
              }}
              title="Otomatis menggambar garis relasi JOIN saat tabel ditambahkan ke kanvas"
            >
              <input
                type="checkbox"
                checked={autoLinkOnAdd}
                onChange={(e) => setAutoLinkOnAdd(e.target.checked)}
              />
              <span>Auto-Link Relasi</span>
            </label>

            <button
              type="button"
              className="btn"
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={handleAutoArrangeLayout}
              title="Susun rapi posisi kotak tabel di kanvas"
            >
              <LayoutGrid size={12} /> Susun Rapi
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 6px' }}
                onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.1).toFixed(2))))}
                title="Perkecil Kanvas"
              >
                <ZoomOut size={12} />
              </button>
              <span style={{ fontSize: 11, minWidth: 38, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 6px' }}
                onClick={() => setZoom((z) => Math.min(1.35, Number((z + 0.1).toFixed(2))))}
                title="Perbesar Kanvas"
              >
                <ZoomIn size={12} />
              </button>
            </div>

            {nodes.length > 0 && (
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 8px', fontSize: 11, color: '#fca5a5' }}
                onClick={() => {
                  setNodes([]);
                  setLinks([]);
                  setSelectedCols([]);
                  setWhereRules([]);
                  setGroupByColumns([]);
                  setOrderByRules([]);
                  setSelectedLinkId(null);
                }}
                title="Kosongkan semua tabel dari kanvas"
              >
                <Trash2 size={11} /> Reset
              </button>
            )}
          </div>

          {/* Right Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${savedDrawerOpen ? 'btn-accent' : ''}`}
              style={{ padding: '4px 9px', fontSize: 11.5 }}
              onClick={() => setSavedDrawerOpen((v) => !v)}
              title="Simpan Desain Query Visual Ini atau Buka Pustaka Query Tersimpan"
            >
              <BookMarked size={12} color={savedDrawerOpen ? '#fff' : '#fbbf24'} />
              <span>Simpan / Pustaka ({savedSqlQueries.length})</span>
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: '4px 9px', fontSize: 11.5 }}
              onClick={() => void handleCopyCode()}
            >
              {copied ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
              <span>{copied ? 'Tersalin!' : 'Salin Kode'}</span>
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: '4px 9px', fontSize: 11.5 }}
              onClick={handleInsertIntoEditor}
              title="Sisipkan kode SQL / PHP / Wisanggeni / Laravel yang aktif ke posisi kursor editor"
            >
              <Code2 size={12} /> Sisipkan ke Editor
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: '4px 9px', fontSize: 11.5, color: '#34d399' }}
              disabled={nodes.length === 0}
              onClick={() => {
                const baseTbl = nodes[0]?.name || 'rekap';
                const cols =
                  previewResult?.columns?.length
                    ? previewResult.columns
                    : selectedCols
                        .filter((c) => c.columnName !== '*')
                        .map((c) => c.outputAlias || c.columnName);
                openReportGenerator({
                  sqlQuery: generatedOutputs.sql,
                  columns: cols,
                  suggestedSlug: `lap_${baseTbl}`,
                  suggestedTitle: `Laporan Rekapitulasi ${baseTbl}`
                });
              }}
              title="Generate File Laporan PHP (*_cetak.php & *_excel.php) langsung dari Query JOIN ini"
            >
              <FileSpreadsheet size={12} /> Buat Laporan PHP
            </button>
            <button
              type="button"
              className="btn btn-accent"
              style={{ padding: '4px 11px', fontSize: 11.5 }}
              disabled={previewLoading || nodes.length === 0}
              onClick={() => void handleRunLivePreview()}
              title="Jalankan query hasil rakitan visual secara live ke Database"
            >
              {previewLoading ? (
                <RefreshCw size={12} className="spin" />
              ) : (
                <Play size={12} />
              )}
              <span>
                {previewLoading
                  ? `Menjalankan (${(previewElapsedMs / 1000).toFixed(1)}s)...`
                  : 'Jalankan Query Live'}
              </span>
            </button>
          </div>
        </div>

        {savedDrawerOpen && (
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)'
            }}
          >
            <SavedQueryDrawerPanel
              currentSql={generatedOutputs.sql}
              currentVisualSpec={currentVisualSpec}
              defaultNameHint={
                nodes.length > 0 ? `JOIN ${nodes.map((n) => n.name).join(' + ')}` : undefined
              }
              activeSavedId={activeSavedQueryId}
              onSaved={(it) => setActiveSavedQueryId(it.id)}
              onLoadVisualSpec={applySavedVisualItem}
              onExecuteSql={(sql) => {
                setDbArchitectTab('closed');
                triggerSqlCodeLensAction({
                  mode: 'run',
                  sqlTemplate: sql,
                  params: [],
                  sourceTitle: 'Pustaka Query Tersimpan'
                });
              }}
              onClose={() => setSavedDrawerOpen(false)}
            />
          </div>
        )}

        {/* Smart 1-Click Related Table Strip + Active Wiring Hint */}
        {(recommendedJoinChips.length > 0 || pendingClickPort) && (
          <div
            style={{
              padding: '5px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background: pendingClickPort
                ? 'rgba(56, 189, 248, 0.14)'
                : 'rgba(15, 23, 42, 0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {pendingClickPort ? (
              <>
                <Link2 size={13} color="#38bdf8" />
                <span style={{ fontSize: 11.5, color: '#7dd3fc' }}>
                  Menyambungkan field{' '}
                  <strong>
                    {nodes.find((n) => n.id === pendingClickPort.nodeId)?.alias}.
                    {pendingClickPort.column}
                  </strong>{' '}
                  — klik titik konektor atau nama field di kotak tabel tujuan!
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 7px', fontSize: 10.5 }}
                  onClick={() => setPendingClickPort(null)}
                >
                  Batal (Esc)
                </button>
              </>
            ) : (
              <>
                <span
                  style={{
                    fontSize: 10.5,
                    color: '#6ee7b7',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0
                  }}
                >
                  <Sparkles size={11} /> Tambah Relasi Cepat:
                </span>
                {recommendedJoinChips.slice(0, 7).map((cand, idx) => {
                  const labelTbl = formatQualifiedTableForQuery(
                    cand.targetSchema,
                    cand.targetTable,
                    activeDb || undefined
                  );
                  return (
                    <button
                      key={`${cand.targetSchema ?? ''}.${cand.targetTable}.${cand.targetColumn}.${idx}`}
                      type="button"
                      className="btn"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        borderColor:
                          cand.reason === 'learned-code'
                            ? 'rgba(251, 191, 36, 0.45)'
                            : 'rgba(56, 189, 248, 0.35)',
                        color: cand.reason === 'learned-code' ? '#fde68a' : '#bae6fd',
                        flexShrink: 0
                      }}
                      title={`${cand.reasonLabel} — otomatis menghubungkan ${cand.onExpression}`}
                      onClick={() =>
                        addTableToCanvas(
                          { schema: cand.targetSchema, name: cand.targetTable },
                          undefined,
                          {
                            sourceAlias: cand.sourceAliasOrTable,
                            sourceColumn: cand.sourceColumn,
                            targetColumn: cand.targetColumn
                          }
                        )
                      }
                    >
                      + {labelTbl}{' '}
                      <span style={{ opacity: 0.72 }}>
                        ({cand.targetColumn}={cand.sourceAliasOrTable}.{cand.sourceColumn})
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* INTERACTIVE 2D NAVICAT DIAGRAM CANVAS */}
        <div
          ref={canvasScrollRef}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/hmw-join-table')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData('application/hmw-join-table');
            if (!raw) return;
            e.preventDefault();
            try {
              const parsed = JSON.parse(raw) as { schema?: string; name: string };
              const pt = clientToCanvasCoords(e.clientX, e.clientY);
              addTableToCanvas(parsed, { x: pt.x - CARD_WIDTH / 2, y: pt.y - 18 });
            } catch {
              // ignore malformed payload
            }
          }}
          onClick={() => {
            setSelectedLinkId(null);
          }}
          style={{
            flex: 1,
            minHeight: 220,
            overflow: 'auto',
            position: 'relative',
            backgroundColor: '#0b1120',
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.16) 1px, transparent 0)',
            backgroundSize: '18px 18px'
          }}
        >
          {/* Floating Non-Blocking Live Progress Banner on Canvas (DB Load / Query Run / Excel Export) */}
          {(dbSchemaLoading || previewLoading || exportingXlsx) && (
            <div
              style={{
                position: 'sticky',
                top: 10,
                left: 0,
                right: 0,
                zIndex: 28,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
                padding: '0 14px'
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(15, 23, 42, 0.92)',
                  border: '1px solid rgba(56, 189, 248, 0.55)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                  color: '#e0f2fe',
                  fontSize: 11.5,
                  fontWeight: 600
                }}
              >
                <RefreshCw size={13} className="spin" color="#38bdf8" />
                {dbSchemaLoading ? (
                  <span>
                    Sedang memuat database
                    {dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ''} —{' '}
                    <span style={{ fontWeight: 400, color: '#bae6fd' }}>
                      {dbSchemaLoadingMessage || 'Mengambil daftar tabel & kolom...'}
                    </span>{' '}
                    ({dbSchemaLoadingPercent}%)
                  </span>
                ) : previewLoading ? (
                  <span>
                    Menjalankan query JOIN ke database{' '}
                    <strong>{activeDb || 'aktif'}</strong>... (
                    {(previewElapsedMs / 1000).toFixed(1)}s)
                  </span>
                ) : (
                  <span>Menyiapkan &amp; mengekspor file Excel (.xlsx)...</span>
                )}
              </div>
            </div>
          )}

          {nodes.length === 0 ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: 'var(--text-muted)',
                padding: 24,
                textAlign: 'center'
              }}
            >
              {dbSchemaLoading ? (
                <>
                  <RefreshCw size={30} className="spin" color="#38bdf8" />
                  <strong style={{ fontSize: 14, color: '#e0f2fe' }}>
                    Sedang Memuat Skema Database
                    {dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ''}... (
                    {dbSchemaLoadingPercent}%)
                  </strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 480 }}>
                    {dbSchemaLoadingMessage ||
                      'Membuka koneksi & membaca daftar database, tabel, kolom, serta relasi Foreign Key...'}
                  </span>
                  <div
                    style={{
                      width: 280,
                      height: 5,
                      borderRadius: 999,
                      background: 'rgba(15, 23, 42, 0.85)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      overflow: 'hidden',
                      marginTop: 2
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(10, dbSchemaLoadingPercent)}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                        transition: 'width 0.22s ease'
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Link2 size={28} color="var(--accent)" />
                  <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
                    Kanvas Visual Query Builder (Gaya Navicat)
                  </strong>
                  <span style={{ fontSize: 12, maxWidth: 520 }}>
                    <strong>Tarik (Drag &amp; Drop)</strong> atau klik <strong>[+]</strong> pada
                    tabel di panel sebelah kiri untuk menaruh kotak tabel ke kanvas, centang field
                    untuk <code>SELECT</code>, lalu <strong>tarik garis antar-field</strong> untuk
                    membuat <code>LEFT / INNER / RIGHT JOIN</code>!
                  </span>
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                width: canvasSize.width * zoom,
                height: canvasSize.height * zoom,
                position: 'relative'
              }}
            >
              <div
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  position: 'relative'
                }}
              >
                {/* SVG Layer: Bezier Join Wires + Live Dragging Wire */}
                <svg
                  width={canvasSize.width}
                  height={canvasSize.height}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    pointerEvents: 'none',
                    zIndex: 3
                  }}
                >
                  {renderedLinks.map((rl) => {
                    const isSel = selectedLinkId === rl.link.id;
                    const stroke =
                      rl.link.joinType === 'LEFT JOIN'
                        ? '#38bdf8'
                        : rl.link.joinType === 'RIGHT JOIN'
                          ? '#c084fc'
                          : '#34d399';
                    return (
                      <g key={rl.link.id}>
                        {/* Invisible wide hit target for easy wire clicking */}
                        <path
                          d={rl.pathD}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={14}
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLinkId(isSel ? null : rl.link.id);
                          }}
                        />
                        <path
                          d={rl.pathD}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={isSel ? 3 : 2}
                          strokeOpacity={isSel ? 1 : 0.85}
                        />
                        <circle cx={rl.p1.x} cy={rl.p1.y} r={4.2} fill={stroke} />
                        <circle cx={rl.p2.x} cy={rl.p2.y} r={4.2} fill={stroke} />
                      </g>
                    );
                  })}

                  {/* Active Dragged Wire Preview */}
                  {wireDrag &&
                    (() => {
                      const srcNode = nodes.find((n) => n.id === wireDrag.fromNodeId);
                      if (!srcNode) return null;
                      const goRight = wireDrag.cursorCanvasX >= srcNode.x + CARD_WIDTH / 2;
                      const startPt = getPortPosition(
                        srcNode,
                        wireDrag.fromColumn,
                        goRight ? 'right' : 'left'
                      );
                      const dx = Math.max(40, Math.abs(wireDrag.cursorCanvasX - startPt.x) * 0.4);
                      const c1x = goRight ? startPt.x + dx : startPt.x - dx;
                      const c2x = goRight
                        ? wireDrag.cursorCanvasX - dx
                        : wireDrag.cursorCanvasX + dx;
                      return (
                        <g>
                          <path
                            d={`M ${startPt.x} ${startPt.y} C ${c1x} ${startPt.y}, ${c2x} ${wireDrag.cursorCanvasY}, ${wireDrag.cursorCanvasX} ${wireDrag.cursorCanvasY}`}
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth={2.4}
                            strokeDasharray="6 4"
                          />
                          <circle cx={startPt.x} cy={startPt.y} r={4.5} fill="#fbbf24" />
                          <circle
                            cx={wireDrag.cursorCanvasX}
                            cy={wireDrag.cursorCanvasY}
                            r={4.5}
                            fill="#fbbf24"
                          />
                        </g>
                      );
                    })()}
                </svg>

                {/* Interactive Join Type Venn Pills on Midpoint of Each Wire */}
                {renderedLinks.map((rl) => {
                  const isSel = selectedLinkId === rl.link.id;
                  const shortType =
                    rl.link.joinType === 'LEFT JOIN'
                      ? 'LEFT'
                      : rl.link.joinType === 'RIGHT JOIN'
                        ? 'RIGHT'
                        : 'INNER';
                  const borderCol =
                    rl.link.joinType === 'LEFT JOIN'
                      ? '#38bdf8'
                      : rl.link.joinType === 'RIGHT JOIN'
                        ? '#c084fc'
                        : '#34d399';
                  return (
                    <button
                      key={`pill-${rl.link.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLinkId(isSel ? null : rl.link.id);
                      }}
                      title={`Klik untuk mengubah tipe JOIN (${rl.fromNode.alias}.${rl.link.fromColumn} ${rl.link.operator} ${rl.toNode.alias}.${rl.link.toColumn})`}
                      style={{
                        position: 'absolute',
                        left: rl.midX,
                        top: rl.midY,
                        transform: 'translate(-50%, -50%)',
                        zIndex: isSel ? 8 : 5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: '#0f172a',
                        border: `1.5px solid ${borderCol}`,
                        color: '#f8fafc',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: isSel
                          ? `0 0 0 3px rgba(56, 189, 248, 0.28), 0 4px 12px rgba(0,0,0,0.5)`
                          : '0 2px 8px rgba(0,0,0,0.5)'
                      }}
                    >
                      <JoinVennIcon joinType={rl.link.joinType} size={13} />
                      <span>{shortType}</span>
                      {rl.link.operator !== '=' && (
                        <span style={{ color: '#fbbf24' }}>{rl.link.operator}</span>
                      )}
                    </button>
                  );
                })}

                {/* Floating Join Inspector Popover when a Join Wire / Venn Pill is clicked */}
                {selectedLinkInfo && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: Math.max(16, Math.min(canvasSize.width - 310, selectedLinkInfo.midX - 145)),
                      top: selectedLinkInfo.midY + 18,
                      width: 294,
                      zIndex: 12,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--accent)',
                      borderRadius: 8,
                      padding: 10,
                      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 11.5 }}>Pengaturan Garis Relasi JOIN</strong>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ padding: 2 }}
                        onClick={() => setSelectedLinkId(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>

                    {/* Visual Venn Join Type Selector */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                      {(['LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN'] as SqlJoinType[]).map((jt) => {
                        const active = selectedLinkInfo.link.joinType === jt;
                        return (
                          <button
                            key={jt}
                            type="button"
                            className={active ? 'btn btn-accent' : 'btn'}
                            style={{
                              padding: '4px 4px',
                              fontSize: 10,
                              justifyContent: 'center',
                              gap: 3
                            }}
                            onClick={() =>
                              setLinks((prev) =>
                                prev.map((l) =>
                                  l.id === selectedLinkInfo.link.id ? { ...l, joinType: jt } : l
                                )
                              )
                            }
                          >
                            <JoinVennIcon joinType={jt} size={12} />
                            <span>{jt.replace(' JOIN', '')}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Condition Field & Operator Selector */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto 1fr',
                        gap: 4,
                        alignItems: 'center',
                        fontSize: 11
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 2 }}>
                          {selectedLinkInfo.fromNode.alias} ({selectedLinkInfo.fromNode.name})
                        </div>
                        <select
                          className="form-input"
                          style={{ fontSize: 11, padding: '3px 5px', width: '100%' }}
                          value={selectedLinkInfo.link.fromColumn}
                          onChange={(e) =>
                            setLinks((prev) =>
                              prev.map((l) =>
                                l.id === selectedLinkInfo.link.id
                                  ? { ...l, fromColumn: e.target.value }
                                  : l
                              )
                            )
                          }
                        >
                          {(
                            resolveTableMeta(
                              selectedLinkInfo.fromNode.schema,
                              selectedLinkInfo.fromNode.name
                            )?.columns ?? [{ name: selectedLinkInfo.link.fromColumn }]
                          ).map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <select
                        className="form-input"
                        style={{ fontSize: 11, padding: '3px 4px', marginTop: 14 }}
                        value={selectedLinkInfo.link.operator}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((l) =>
                              l.id === selectedLinkInfo.link.id
                                ? { ...l, operator: e.target.value as SqlJoinOperator }
                                : l
                            )
                          )
                        }
                      >
                        {(['=', '!=', '<', '<=', '>', '>='] as SqlJoinOperator[]).map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>

                      <div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 2 }}>
                          {selectedLinkInfo.toNode.alias} ({selectedLinkInfo.toNode.name})
                        </div>
                        <select
                          className="form-input"
                          style={{ fontSize: 11, padding: '3px 5px', width: '100%' }}
                          value={selectedLinkInfo.link.toColumn}
                          onChange={(e) =>
                            setLinks((prev) =>
                              prev.map((l) =>
                                l.id === selectedLinkInfo.link.id
                                  ? { ...l, toColumn: e.target.value }
                                  : l
                              )
                            )
                          }
                        >
                          {(
                            resolveTableMeta(
                              selectedLinkInfo.toNode.schema,
                              selectedLinkInfo.toNode.name
                            )?.columns ?? [{ name: selectedLinkInfo.link.toColumn }]
                          ).map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn"
                      style={{
                        fontSize: 11,
                        padding: '4px 8px',
                        justifyContent: 'center',
                        color: '#fca5a5',
                        borderColor: 'rgba(239, 68, 68, 0.4)'
                      }}
                      onClick={() => {
                        setLinks((prev) =>
                          prev.filter((l) => l.id !== selectedLinkInfo.link.id)
                        );
                        setSelectedLinkId(null);
                      }}
                    >
                      <Unlink size={12} /> Putus Garis Relasi JOIN Ini
                    </button>
                  </div>
                )}

                {/* FLOATING NAVICAT TABLE CARDS */}
                {nodes.map((node, nodeIdx) => {
                  const isBase = nodeIdx === 0;
                  const isUnlinked = unlinkedNodeIds.has(node.id);
                  const cols = getFilteredColumnsForNode(node);
                  const starChecked = selectedCols.some(
                    (c) => c.tableAlias === node.alias && c.columnName === '*'
                  );
                  const showDbBadge =
                    node.schema && (!activeDb || node.schema.toLowerCase() !== activeDb.toLowerCase());

                  return (
                    <div
                      key={node.id}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        left: node.x,
                        top: node.y,
                        width: CARD_WIDTH,
                        zIndex: draggingCard?.nodeId === node.id ? 9 : 4,
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: isBase
                          ? '1.5px solid #38bdf8'
                          : isUnlinked
                            ? '1.5px dashed #fbbf24'
                            : '1px solid var(--border-strong)',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                        overflow: 'hidden'
                      }}
                    >
                      {/* Draggable Card Header */}
                      <div
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest('button, input')) return;
                          e.preventDefault();
                          setDraggingCard({
                            nodeId: node.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            origX: node.x,
                            origY: node.y
                          });
                        }}
                        style={{
                          height: CARD_HEADER_H,
                          padding: '0 8px',
                          background: isBase
                            ? 'linear-gradient(90deg, rgba(14, 165, 233, 0.24), rgba(15, 23, 42, 0.9))'
                            : 'linear-gradient(90deg, rgba(16, 185, 129, 0.18), rgba(15, 23, 42, 0.9))',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 5,
                          cursor: 'grab'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            minWidth: 0,
                            flex: 1
                          }}
                        >
                          <span
                            title={
                              isBase
                                ? 'Tabel Utama (FROM)'
                                : 'Klik untuk menjadikan tabel ini sebagai Tabel Utama (FROM)'
                            }
                            onClick={() => {
                              if (!isBase) promoteNodeToBaseFrom(node.id);
                            }}
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              padding: '1px 4px',
                              borderRadius: 3,
                              background: isBase
                                ? 'rgba(56, 189, 248, 0.25)'
                                : 'rgba(148, 163, 184, 0.16)',
                              color: isBase ? '#7dd3fc' : 'var(--text-muted)',
                              cursor: isBase ? 'default' : 'pointer',
                              flexShrink: 0
                            }}
                          >
                            {isBase ? 'FROM' : 'JOIN'}
                          </span>

                          <strong
                            title={`${node.schema ? `${node.schema}.` : ''}${node.name}`}
                            style={{
                              fontSize: 11.5,
                              fontFamily: 'var(--font-mono)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {showDbBadge ? `${node.schema}.` : ''}
                            {node.name}
                          </strong>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          {editingAliasNodeId === node.id ? (
                            <input
                              type="text"
                              autoFocus
                              defaultValue={node.alias}
                              style={{
                                width: 42,
                                fontSize: 10.5,
                                padding: '1px 4px',
                                borderRadius: 4,
                                border: '1px solid var(--accent)',
                                background: '#0f172a',
                                color: '#fff',
                                fontFamily: 'var(--font-mono)'
                              }}
                              onBlur={(e) => handleRenameNodeAlias(node.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRenameNodeAlias(node.id, e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  setEditingAliasNodeId(null);
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '1px 5px',
                                fontSize: 10,
                                fontFamily: 'var(--font-mono)',
                                color: '#fde68a'
                              }}
                              title="Klik untuk mengubah alias tabel"
                              onClick={() => setEditingAliasNodeId(node.id)}
                            >
                              {node.alias}
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '1px 4px', fontSize: 9.5 }}
                            title="Centang / lepas semua field pada tabel ini"
                            onClick={() => toggleAllFieldsForNode(node)}
                          >
                            ☑
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ padding: 2 }}
                            title="Hapus tabel dari kanvas"
                            onClick={() => removeNodeFromCanvas(node.id)}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Card Subheader: `*` Wildcard Checkbox + Mini Field Filter */}
                      <div
                        style={{
                          height: CARD_SUBHEADER_H,
                          padding: '0 8px',
                          background: 'rgba(15, 23, 42, 0.65)',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6
                        }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 10.5,
                            fontFamily: 'var(--font-mono)',
                            color: starChecked ? '#38bdf8' : 'var(--text-secondary)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={starChecked}
                            onChange={() => toggleFieldChecked(node.alias, '*')}
                          />
                          <span>{node.alias}.* (Semua)</span>
                        </label>

                        <input
                          type="text"
                          placeholder="filter..."
                          value={node.fieldFilter}
                          onChange={(e) =>
                            setNodes((prev) =>
                              prev.map((n) =>
                                n.id === node.id ? { ...n, fieldFilter: e.target.value } : n
                              )
                            )
                          }
                          style={{
                            width: 78,
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 4,
                            border: '1px solid var(--border-subtle)',
                            background: 'rgba(0,0,0,0.28)',
                            color: 'var(--text-primary)'
                          }}
                        />
                      </div>

                      {/* Scrollable Field List with Left/Right Drag-to-Join Connector Ports */}
                      <div
                        onScroll={(e) => {
                          const st = e.currentTarget.scrollTop;
                          setNodes((prev) =>
                            prev.map((n) => (n.id === node.id ? { ...n, scrollTop: st } : n))
                          );
                        }}
                        style={{
                          maxHeight: MAX_VISIBLE_FIELD_ROWS * FIELD_ROW_H + 4,
                          overflowY: 'auto',
                          padding: '2px 0'
                        }}
                      >
                        {cols.length === 0 ? (
                          <div
                            style={{
                              padding: '7px 10px',
                              fontSize: 10.5,
                              color: dbSchemaLoading ? '#7dd3fc' : 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6
                            }}
                          >
                            {dbSchemaLoading ? (
                              <>
                                <RefreshCw size={11} className="spin" color="#38bdf8" />
                                <span>Memuat daftar field dari database...</span>
                              </>
                            ) : (
                              <span>Field skema belum dimuat (gunakan {node.alias}.*)</span>
                            )}
                          </div>
                        ) : (
                          cols.map((col) => {
                            const isChecked = selectedCols.some(
                              (sc) =>
                                sc.tableAlias === node.alias &&
                                sc.columnName === col.name &&
                                !sc.aggregate
                            );
                            const isLinked = linkedFieldKeySet.has(
                              `${node.id}:${col.name.toLowerCase()}`
                            );
                            const isPendingSrc =
                              pendingClickPort?.nodeId === node.id &&
                              pendingClickPort.column === col.name;
                            const isHoverTarget =
                              hoveredTargetField?.nodeId === node.id &&
                              hoveredTargetField.column === col.name &&
                              ((wireDrag && wireDrag.fromNodeId !== node.id) ||
                                (pendingClickPort && pendingClickPort.nodeId !== node.id));

                            const startWireFromField = (e: React.MouseEvent): void => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (pendingClickPort && pendingClickPort.nodeId !== node.id) {
                                connectTableFields(
                                  pendingClickPort.nodeId,
                                  pendingClickPort.column,
                                  node.id,
                                  col.name
                                );
                                return;
                              }
                              setPendingClickPort({ nodeId: node.id, column: col.name });
                              const pt = clientToCanvasCoords(e.clientX, e.clientY);
                              setWireDrag({
                                fromNodeId: node.id,
                                fromColumn: col.name,
                                cursorCanvasX: pt.x,
                                cursorCanvasY: pt.y
                              });
                            };

                            return (
                              <div
                                key={col.name}
                                onMouseEnter={() =>
                                  setHoveredTargetField({ nodeId: node.id, column: col.name })
                                }
                                onMouseLeave={() => setHoveredTargetField(null)}
                                onMouseUp={(e) => {
                                  if (wireDrag && wireDrag.fromNodeId !== node.id) {
                                    e.stopPropagation();
                                    connectTableFields(
                                      wireDrag.fromNodeId,
                                      wireDrag.fromColumn,
                                      node.id,
                                      col.name
                                    );
                                  }
                                }}
                                onClick={() => {
                                  if (pendingClickPort && pendingClickPort.nodeId !== node.id) {
                                    connectTableFields(
                                      pendingClickPort.nodeId,
                                      pendingClickPort.column,
                                      node.id,
                                      col.name
                                    );
                                  }
                                }}
                                style={{
                                  height: FIELD_ROW_H,
                                  padding: '0 6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 5,
                                  fontSize: 11,
                                  background: isHoverTarget
                                    ? 'rgba(52, 211, 153, 0.24)'
                                    : isPendingSrc
                                      ? 'rgba(251, 191, 36, 0.2)'
                                      : isChecked
                                        ? 'rgba(56, 189, 248, 0.09)'
                                        : 'transparent',
                                  cursor:
                                    pendingClickPort && pendingClickPort.nodeId !== node.id
                                      ? 'crosshair'
                                      : 'default'
                                }}
                              >
                                {/* Left Connector Port (`●` Drag / Click to JOIN) */}
                                <span
                                  onMouseDown={startWireFromField}
                                  title={`Tarik garis dari ${node.alias}.${col.name} ke field tabel lain untuk JOIN`}
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: isLinked
                                      ? '#38bdf8'
                                      : isPendingSrc
                                        ? '#fbbf24'
                                        : 'rgba(148, 163, 184, 0.35)',
                                    border: '1.5px solid #0f172a',
                                    cursor: 'crosshair',
                                    flexShrink: 0
                                  }}
                                />

                                {/* Checkbox + Column Name */}
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    minWidth: 0,
                                    flex: 1,
                                    cursor: 'pointer'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleFieldChecked(node.alias, col.name)}
                                  />
                                  {col.isPrimaryKey && (
                                    <KeyRound
                                      size={10}
                                      color="#fbbf24"
                                      style={{ flexShrink: 0 }}
                                    />
                                  )}
                                  <span
                                    style={{
                                      fontFamily: 'var(--font-mono)',
                                      color: isLinked
                                        ? '#7dd3fc'
                                        : isChecked
                                          ? '#f8fafc'
                                          : 'var(--text-secondary)',
                                      fontWeight: isLinked || col.isPrimaryKey ? 600 : 400,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap'
                                    }}
                                  >
                                    {col.name}
                                  </span>
                                </label>

                                <span
                                  style={{
                                    fontSize: 9.5,
                                    color: 'var(--text-muted)',
                                    fontFamily: 'var(--font-mono)',
                                    flexShrink: 0
                                  }}
                                >
                                  {col.dataType}
                                </span>

                                {/* Right Connector Port (`●` Drag / Click to JOIN) */}
                                <span
                                  onMouseDown={startWireFromField}
                                  title={`Tarik garis dari ${node.alias}.${col.name} ke field tabel lain untuk JOIN`}
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: isLinked
                                      ? '#38bdf8'
                                      : isPendingSrc
                                        ? '#fbbf24'
                                        : 'rgba(148, 163, 184, 0.35)',
                                    border: '1.5px solid #0f172a',
                                    cursor: 'crosshair',
                                    flexShrink: 0
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. BOTTOM PANE: Navicat Multi-Tab Clause Designer & Live SQL/PHP/Excel Output */}
        <div
          style={{
            height: bottomExpanded ? 268 : 36,
            flexShrink: 0,
            borderTop: '1px solid var(--border-strong)',
            background: 'var(--bg-surface)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          {/* Bottom Tab Header Bar */}
          <div
            style={{
              height: 36,
              padding: '0 10px',
              borderBottom: bottomExpanded ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              background: 'var(--bg-elevated)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
              <button
                type="button"
                className={bottomTab === 'select' && bottomExpanded ? 'btn btn-accent' : 'btn'}
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  setBottomTab('select');
                  setBottomExpanded(true);
                }}
              >
                <Table2 size={12} /> Kolom SELECT &amp; Fungsi ({selectedCols.length || 'Auto'})
              </button>
              <button
                type="button"
                className={bottomTab === 'where' && bottomExpanded ? 'btn btn-accent' : 'btn'}
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  setBottomTab('where');
                  setBottomExpanded(true);
                }}
              >
                <Filter size={12} /> Filter WHERE ({whereRules.length + (manualWhere.trim() ? 1 : 0)})
              </button>
              <button
                type="button"
                className={bottomTab === 'group-order' && bottomExpanded ? 'btn btn-accent' : 'btn'}
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  setBottomTab('group-order');
                  setBottomExpanded(true);
                }}
              >
                <SlidersHorizontal size={12} /> GROUP BY • ORDER BY • LIMIT
              </button>
              <button
                type="button"
                className={bottomTab === 'code' && bottomExpanded ? 'btn btn-accent' : 'btn'}
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  setBottomTab('code');
                  setBottomExpanded(true);
                }}
              >
                <Code2 size={12} /> Kode SQL / PHP / Wisanggeni / Laravel
              </button>
              <button
                type="button"
                className={bottomTab === 'preview' && bottomExpanded ? 'btn btn-accent' : 'btn'}
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  setBottomTab('preview');
                  setBottomExpanded(true);
                }}
              >
                {previewLoading ? (
                  <RefreshCw size={12} className="spin" />
                ) : (
                  <Play size={12} />
                )}{' '}
                Hasil Uji Live{' '}
                {previewLoading
                  ? `(Memuat ${(previewElapsedMs / 1000).toFixed(1)}s)`
                  : previewResult
                    ? `(${previewResult.rows.length})`
                    : ''}
              </button>
            </div>

            <button
              type="button"
              className="btn"
              style={{ padding: '2px 8px', fontSize: 10.5 }}
              onClick={() => setBottomExpanded((v) => !v)}
            >
              {bottomExpanded ? 'Lipat Panel ▼' : 'Buka Panel ▲'}
            </button>
          </div>

          {/* Bottom Tab Body */}
          {bottomExpanded && (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', minHeight: 0 }}>
              {/* TAB 1: SELECT COLUMNS, AGGREGATE FUNCTIONS & ALIASES */}
              {bottomTab === 'select' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={distinct}
                          onChange={(e) => setDistinct(e.target.checked)}
                        />
                        <span>SELECT DISTINCT</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={autoAliasCollisions}
                          onChange={(e) => setAutoAliasCollisions(e.target.checked)}
                        />
                        <span>Auto-Alias Kolom Kembar (mis. <code>u.nama AS unitkerja_nama</code>)</span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => {
                          const firstRef = allCanvasColumnRefs[0];
                          if (!firstRef) return;
                          const [ta, cn] = firstRef.ref.split('.');
                          setSelectedCols((prev) => [
                            ...prev,
                            { tableAlias: ta, columnName: cn, aggregate: 'COUNT' }
                          ]);
                        }}
                      >
                        <Plus size={11} /> Tambah Fungsi COUNT / SUM
                      </button>
                      {selectedCols.length > 0 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => setSelectedCols([])}
                        >
                          Reset Pilihan Field
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedCols.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 2px' }}>
                      Belum ada field yang dicentang secara spesifik di kotak tabel atas — otomatis memilih kolom utama tiap tabel secara rapi. Centang kotak di dalam kartu tabel di atas untuk mengatur urutan, fungsi <code>COUNT/SUM</code>, atau alias <code>AS</code>.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                          <th style={{ padding: '4px 6px', width: 64 }}>Urut</th>
                          <th style={{ padding: '4px 6px' }}>Tabel.Kolom</th>
                          <th style={{ padding: '4px 6px', width: 170 }}>Fungsi Agregasi</th>
                          <th style={{ padding: '4px 6px', width: 210 }}>Alias Output (AS ...)</th>
                          <th style={{ padding: '4px 6px', width: 42 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCols.map((sc, idx) => (
                          <tr key={`${sc.tableAlias}.${sc.columnName}.${idx}`} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                            <td style={{ padding: '4px 6px' }}>
                              <div style={{ display: 'flex', gap: 2 }}>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  disabled={idx === 0}
                                  style={{ padding: 2 }}
                                  onClick={() =>
                                    setSelectedCols((prev) => {
                                      const cp = [...prev];
                                      [cp[idx - 1], cp[idx]] = [cp[idx], cp[idx - 1]];
                                      return cp;
                                    })
                                  }
                                >
                                  <ArrowUp size={11} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  disabled={idx === selectedCols.length - 1}
                                  style={{ padding: 2 }}
                                  onClick={() =>
                                    setSelectedCols((prev) => {
                                      const cp = [...prev];
                                      [cp[idx], cp[idx + 1]] = [cp[idx + 1], cp[idx]];
                                      return cp;
                                    })
                                  }
                                >
                                  <ArrowDown size={11} />
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                              <select
                                className="form-input"
                                style={{ fontSize: 11.5, padding: '2px 6px' }}
                                value={`${sc.tableAlias}.${sc.columnName}`}
                                onChange={(e) => {
                                  const [ta, cn] = e.target.value.split('.');
                                  setSelectedCols((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, tableAlias: ta, columnName: cn } : item
                                    )
                                  );
                                }}
                              >
                                <option value={`${sc.tableAlias}.${sc.columnName}`}>
                                  {sc.tableAlias}.{sc.columnName}
                                </option>
                                {allCanvasColumnRefs.map((cr) => (
                                  <option key={cr.ref} value={cr.ref}>
                                    {cr.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <select
                                className="form-input"
                                style={{ fontSize: 11.5, padding: '2px 6px', width: '100%' }}
                                value={sc.aggregate ?? ''}
                                onChange={(e) =>
                                  setSelectedCols((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, aggregate: e.target.value as SqlAggregateFunc }
                                        : item
                                    )
                                  )
                                }
                              >
                                <option value="">— Tanpa Fungsi</option>
                                <option value="COUNT">COUNT(...)</option>
                                <option value="COUNT_DISTINCT">COUNT(DISTINCT ...)</option>
                                <option value="SUM">SUM(...)</option>
                                <option value="AVG">AVG(...)</option>
                                <option value="MIN">MIN(...)</option>
                                <option value="MAX">MAX(...)</option>
                                <option value="GROUP_CONCAT">GROUP_CONCAT(...)</option>
                              </select>
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <input
                                type="text"
                                className="form-input"
                                style={{ fontSize: 11.5, padding: '2px 7px', width: '100%', fontFamily: 'var(--font-mono)' }}
                                placeholder="otomatis jika dikosongkan"
                                value={sc.outputAlias ?? ''}
                                onChange={(e) =>
                                  setSelectedCols((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, outputAlias: e.target.value } : item
                                    )
                                  )
                                }
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() =>
                                  setSelectedCols((prev) => prev.filter((_, i) => i !== idx))
                                }
                              >
                                <Trash2 size={12} color="#fca5a5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* TAB 2: VISUAL WHERE CRITERIA BUILDER */}
              {bottomTab === 'where' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      Susun kriteria <code>WHERE</code> secara visual (mendukung angka, teks, maupun variabel PHP seperti <code>$nip</code>):
                    </span>
                    <button
                      type="button"
                      className="btn btn-accent"
                      style={{ padding: '3px 9px', fontSize: 11 }}
                      onClick={addWhereRule}
                    >
                      <Plus size={12} /> Tambah Kondisi WHERE
                    </button>
                  </div>

                  {whereRules.map((rule, idx) => {
                    const needsVal = rule.operator !== 'IS_NULL' && rule.operator !== 'IS_NOT_NULL';
                    return (
                      <div
                        key={rule.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '24px 72px 1.2fr 155px 1.2fr 28px',
                          gap: 6,
                          alignItems: 'center'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={rule.enabled !== false}
                          onChange={(e) =>
                            setWhereRules((prev) =>
                              prev.map((r) =>
                                r.id === rule.id ? { ...r, enabled: e.target.checked } : r
                              )
                            )
                          }
                        />
                        {idx === 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>WHERE</span>
                        ) : (
                          <select
                            className="form-input"
                            style={{ fontSize: 11, padding: '3px 5px' }}
                            value={rule.conjunction}
                            onChange={(e) =>
                              setWhereRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, conjunction: e.target.value as 'AND' | 'OR' }
                                    : r
                                )
                              )
                            }
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}

                        <select
                          className="form-input"
                          style={{ fontSize: 11.5, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                          value={rule.columnRef}
                          onChange={(e) =>
                            setWhereRules((prev) =>
                              prev.map((r) =>
                                r.id === rule.id ? { ...r, columnRef: e.target.value } : r
                              )
                            )
                          }
                        >
                          {allCanvasColumnRefs.map((cr) => (
                            <option key={cr.ref} value={cr.ref}>
                              {cr.label}
                            </option>
                          ))}
                        </select>

                        <select
                          className="form-input"
                          style={{ fontSize: 11.5, padding: '3px 6px' }}
                          value={rule.operator}
                          onChange={(e) =>
                            setWhereRules((prev) =>
                              prev.map((r) =>
                                r.id === rule.id
                                  ? { ...r, operator: e.target.value as SqlWhereOperator }
                                  : r
                              )
                            )
                          }
                        >
                          <option value="=">= (Sama dengan)</option>
                          <option value="!=">!= (Tidak sama)</option>
                          <option value="LIKE_CONTAINS">LIKE '%...%' (Mengandung)</option>
                          <option value="LIKE_PREFIX">LIKE '...%' (Diawali)</option>
                          <option value="NOT_LIKE">NOT LIKE '%...%'</option>
                          <option value=">">&gt; (Lebih besar)</option>
                          <option value=">=">&gt;= (Minimal)</option>
                          <option value="<">&lt; (Lebih kecil)</option>
                          <option value="<=">&lt;= (Maksimal)</option>
                          <option value="IN">IN (a, b, c)</option>
                          <option value="NOT_IN">NOT IN (a, b, c)</option>
                          <option value="IS_NULL">IS NULL (Kosong)</option>
                          <option value="IS_NOT_NULL">IS NOT NULL (Terisi)</option>
                        </select>

                        {needsVal ? (
                          <input
                            type="text"
                            className="form-input"
                            style={{ fontSize: 11.5, padding: '3px 7px', fontFamily: 'var(--font-mono)' }}
                            placeholder="Nilai (mis. 1, dinas, atau $nip)"
                            value={rule.value}
                            onChange={(e) =>
                              setWhereRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id ? { ...r, value: e.target.value } : r
                                )
                              )
                            }
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                        )}

                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() =>
                            setWhereRules((prev) => prev.filter((r) => r.id !== rule.id))
                          }
                        >
                          <Trash2 size={12} color="#fca5a5" />
                        </button>
                      </div>
                    );
                  })}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      Ekspresi WHERE Tambahan (Opsional):
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: 1, fontSize: 11.5, padding: '4px 8px', fontFamily: 'var(--font-mono)' }}
                      placeholder="contoh: LEFT(p.kd_unitkerja, 4) = '0201'"
                      value={manualWhere}
                      onChange={(e) => setManualWhere(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* TAB 3: GROUP BY, HAVING, ORDER BY & LIMIT */}
              {bottomTab === 'group-order' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {/* Left: GROUP BY & HAVING */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 11.5 }}>GROUP BY &amp; HAVING</strong>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 7px', fontSize: 10.5 }}
                        onClick={handleAutoGroupBy}
                        title="Otomatis mengisi GROUP BY dari seluruh kolom SELECT non-agregasi"
                      >
                        ⚡ Auto GROUP BY
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 5 }}>
                      <select
                        className="form-input"
                        style={{ flex: 1, fontSize: 11.5, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val && !groupByColumns.includes(val)) {
                            setGroupByColumns((prev) => [...prev, val]);
                          }
                          e.currentTarget.value = '';
                        }}
                      >
                        <option value="">+ Pilih kolom untuk GROUP BY...</option>
                        {allCanvasColumnRefs.map((cr) => (
                          <option key={cr.ref} value={cr.ref}>
                            {cr.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {groupByColumns.map((gb) => (
                        <span
                          key={gb}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 7px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            background: 'rgba(56, 189, 248, 0.14)',
                            border: '1px solid rgba(56, 189, 248, 0.35)'
                          }}
                        >
                          {gb}
                          <X
                            size={11}
                            style={{ cursor: 'pointer' }}
                            onClick={() =>
                              setGroupByColumns((prev) => prev.filter((x) => x !== gb))
                            }
                          />
                        </span>
                      ))}
                    </div>

                    <input
                      type="text"
                      className="form-input"
                      style={{ fontSize: 11.5, padding: '4px 8px', fontFamily: 'var(--font-mono)' }}
                      placeholder="HAVING (opsional, mis. COUNT(*) > 1)"
                      value={havingClause}
                      onChange={(e) => setHavingClause(e.target.value)}
                    />
                  </div>

                  {/* Right: ORDER BY, LIMIT & OFFSET */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 11.5 }}>ORDER BY &amp; LIMIT</strong>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 7px', fontSize: 10.5 }}
                        onClick={addOrderByRule}
                      >
                        <Plus size={11} /> Tambah Urutan
                      </button>
                    </div>

                    {orderByRules.map((ob) => (
                      <div key={ob.id} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <select
                          className="form-input"
                          style={{ flex: 1, fontSize: 11.5, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                          value={ob.columnRef}
                          onChange={(e) =>
                            setOrderByRules((prev) =>
                              prev.map((item) =>
                                item.id === ob.id ? { ...item, columnRef: e.target.value } : item
                              )
                            )
                          }
                        >
                          {allCanvasColumnRefs.map((cr) => (
                            <option key={cr.ref} value={cr.ref}>
                              {cr.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className="form-input"
                          style={{ width: 84, fontSize: 11.5, padding: '3px 6px' }}
                          value={ob.direction}
                          onChange={(e) =>
                            setOrderByRules((prev) =>
                              prev.map((item) =>
                                item.id === ob.id
                                  ? { ...item, direction: e.target.value as 'ASC' | 'DESC' }
                                  : item
                              )
                            )
                          }
                        >
                          <option value="ASC">ASC ↑</option>
                          <option value="DESC">DESC ↓</option>
                        </select>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() =>
                            setOrderByRules((prev) => prev.filter((item) => item.id !== ob.id))
                          }
                        >
                          <Trash2 size={12} color="#fca5a5" />
                        </button>
                      </div>
                    ))}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LIMIT:</label>
                      <input
                        type="number"
                        min={0}
                        max={50000}
                        className="form-input"
                        style={{ width: 88, fontSize: 11.5, padding: '3px 7px' }}
                        value={limit}
                        onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
                      />
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>OFFSET:</label>
                      <input
                        type="number"
                        min={0}
                        className="form-input"
                        style={{ width: 88, fontSize: 11.5, padding: '3px 7px' }}
                        value={offset}
                        onChange={(e) => setOffset(Math.max(0, Number(e.target.value) || 0))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: GENERATED SQL / PHP / WISANGGENI / LARAVEL CODE */}
              {bottomTab === 'code' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(
                        [
                          ['sql', 'SQL Murni'],
                          ['phpMysql', 'PHP (mysqli)'],
                          ['phpWisanggeni', 'Wisanggeni ($query->dosql)'],
                          ['laravel', 'Laravel (DB::table)']
                        ] as Array<[CodeFormatId, string]>
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={codeFormat === id ? 'btn btn-accent' : 'btn'}
                          style={{ padding: '3px 9px', fontSize: 11 }}
                          onClick={() => setCodeFormat(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 9px', fontSize: 11 }}
                        onClick={handleOpenInSqlRunner}
                      >
                        Buka di SQL Runner Lebar
                      </button>
                    </div>
                  </div>

                  <pre
                    style={{
                      flex: 1,
                      margin: 0,
                      padding: '8px 11px',
                      borderRadius: 6,
                      background: '#090d16',
                      border: '1px solid var(--border-subtle)',
                      color: '#e2e8f0',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11.5,
                      lineHeight: 1.48,
                      overflow: 'auto'
                    }}
                  >
                    {displayedCode}
                  </pre>
                </div>
              )}

              {/* TAB 5: LIVE QUERY EXECUTION PREVIEW + 1-CLICK EXPORT EXCEL (.XLSX) */}
              {bottomTab === 'preview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      {previewLoading ? (
                        '⏳ Menjalankan query JOIN ke server database...'
                      ) : previewError ? (
                        <span style={{ color: '#fca5a5' }}>❌ Error SQL: {previewError}</span>
                      ) : previewResult ? (
                        <span>
                          ✅ Menampilkan <strong>{previewResult.rows.length}</strong> baris •{' '}
                          <strong>{previewResult.durationMs} ms</strong>
                        </span>
                      ) : (
                        'Klik tombol "Jalankan Query Live" di kanan atas untuk melihat hasil data langsung di sini.'
                      )}
                    </div>

                    {previewResult && previewResult.rows.length > 0 && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={`btn ${chartViewOpen ? 'btn-accent' : ''}`}
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={() => setChartViewOpen((v) => !v)}
                        >
                          <BarChart3 size={12} /> Grafik &amp; Pivot
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={exportingXlsx}
                          style={{
                            padding: '3px 10px',
                            fontSize: 11,
                            color: '#6ee7b7',
                            borderColor: 'rgba(16, 185, 129, 0.45)'
                          }}
                          onClick={() => void handleExportPreviewExcel()}
                        >
                          <FileSpreadsheet size={12} />{' '}
                          {exportingXlsx ? 'Menyimpan...' : 'Export Excel (.xlsx)'}
                        </button>
                      </div>
                    )}
                  </div>

                  {chartViewOpen && previewResult && previewResult.rows.length > 0 && (
                    <QueryChartPivotPanel
                      columns={previewResult.columns}
                      rows={previewResult.rows}
                      title="Grafik Hasil Query JOIN Visual"
                    />
                  )}

                  {previewLoading && (
                    <div
                      style={{
                        flex: 1,
                        minHeight: 110,
                        borderRadius: 6,
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        background: 'rgba(56, 189, 248, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: 16
                      }}
                    >
                      <RefreshCw size={22} className="spin" color="#38bdf8" />
                      <strong style={{ fontSize: 12.5, color: '#e0f2fe' }}>
                        Menjalankan Query JOIN ke Database {activeDb ? `"${activeDb}"` : 'Aktif'}... (
                        {(previewElapsedMs / 1000).toFixed(1)} detik)
                      </strong>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Mengambil baris hasil query dari server database, mohon tunggu sejenak...
                      </span>
                    </div>
                  )}

                  {!previewLoading && previewResult && previewResult.columns.length > 0 && (
                    <div
                      style={{
                        flex: 1,
                        overflow: 'auto',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6
                      }}
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-elevated)', position: 'sticky', top: 0 }}>
                            {previewResult.columns.map((c) => (
                              <th
                                key={c}
                                style={{
                                  textAlign: 'left',
                                  padding: '5px 8px',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  fontFamily: 'var(--font-mono)',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.rows.slice(0, 200).map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              style={{
                                borderBottom: '1px solid rgba(148,163,184,0.08)',
                                background: rIdx % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent'
                              }}
                            >
                              {previewResult.columns.map((c) => {
                                const v = row[c];
                                return (
                                  <td
                                    key={c}
                                    style={{
                                      padding: '4px 8px',
                                      fontFamily: 'var(--font-mono)',
                                      whiteSpace: 'nowrap',
                                      maxWidth: 260,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      color: v === null ? 'var(--text-muted)' : 'var(--text-primary)'
                                    }}
                                  >
                                    {v === null || v === undefined ? 'NULL' : String(v)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
