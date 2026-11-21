import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface VirtualWindowResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
  totalHeightPx: number;
}

/**
 * High-framerate 60 FPS windowing hook for large lists & SQL data grids.
 * Only renders visible items + overscan buffer so 681+ tables or 5,000+ rows stay smooth.
 */
export function useVirtualWindow(opts: {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  fallbackViewportHeight?: number;
}): VirtualWindowResult {
  const { itemCount, itemHeight, overscan = 10, fallbackViewportHeight = 520 } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(fallbackViewportHeight);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const safeHeight = Math.max(18, itemHeight);
  const totalHeightPx = itemCount * safeHeight;
  const rawStart = Math.floor(scrollTop / safeHeight);
  const visibleCount = Math.ceil(viewportHeight / safeHeight);
  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(itemCount, rawStart + visibleCount + overscan);
  const topSpacerPx = startIndex * safeHeight;
  const bottomSpacerPx = Math.max(0, (itemCount - endIndex) * safeHeight);

  return {
    containerRef,
    onScroll,
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    totalHeightPx
  };
}

export interface VirtualScrollListProps<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
}

export function VirtualScrollList<T>({
  items,
  itemHeight,
  overscan = 10,
  className,
  style,
  getKey,
  renderItem,
  emptyState
}: VirtualScrollListProps<T>): React.ReactElement {
  const { containerRef, onScroll, startIndex, endIndex, topSpacerPx, bottomSpacerPx } =
    useVirtualWindow({
      itemCount: items.length,
      itemHeight,
      overscan
    });

  if (items.length === 0 && emptyState) {
    return (
      <div className={className} style={{ overflowY: 'auto', ...style }}>
        {emptyState}
      </div>
    );
  }

  const slice = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={className}
      style={{ overflowY: 'auto', position: 'relative', ...style }}
    >
      {topSpacerPx > 0 && <div style={{ height: topSpacerPx, flexShrink: 0 }} />}
      {slice.map((item, localIdx) => {
        const idx = startIndex + localIdx;
        return <React.Fragment key={getKey(item, idx)}>{renderItem(item, idx)}</React.Fragment>;
      })}
      {bottomSpacerPx > 0 && <div style={{ height: bottomSpacerPx, flexShrink: 0 }} />}
    </div>
  );
}
