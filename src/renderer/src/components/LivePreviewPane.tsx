import React from 'react';
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet, X } from 'lucide-react';
import { useIdeStore } from '../store/useIdeStore';

export const LivePreviewPane: React.FC = () => {
  const {
    previewOpen,
    previewState,
    previewSubPath,
    previewViewport,
    previewReloadTick,
    setPreviewSubPath,
    setPreviewViewport,
    bumpPreviewReload,
    togglePreviewPane
  } = useIdeStore();

  if (!previewOpen || !previewState.running) return null;

  const cleanSub = previewSubPath.replace(/^\/+/, '');
  const fullUrl = `${previewState.url}${cleanSub}?t=${previewReloadTick}`;

  const iframeMaxWidth =
    previewViewport === 'mobile'
      ? 390
      : previewViewport === 'tablet'
        ? 768
        : '100%';

  return (
    <aside className="preview-pane">
      <div
        style={{
          height: 35,
          padding: '0 8px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        <input
          value={previewSubPath}
          onChange={(e) => setPreviewSubPath(e.target.value)}
          placeholder="index.html"
          style={{ flex: 1, padding: '3px 8px', fontSize: 12 }}
          title="Path relatif file HTML yang dipratinjau"
        />

        <button
          className={`btn-ghost ${previewViewport === 'desktop' ? 'btn' : ''}`}
          style={{ padding: 4 }}
          title="Viewport Desktop"
          onClick={() => setPreviewViewport('desktop')}
        >
          <Monitor size={13} />
        </button>

        <button
          className={`btn-ghost ${previewViewport === 'tablet' ? 'btn' : ''}`}
          style={{ padding: 4 }}
          title="Viewport Tablet (768px)"
          onClick={() => setPreviewViewport('tablet')}
        >
          <Tablet size={13} />
        </button>

        <button
          className={`btn-ghost ${previewViewport === 'mobile' ? 'btn' : ''}`}
          style={{ padding: 4 }}
          title="Viewport Mobile (390px)"
          onClick={() => setPreviewViewport('mobile')}
        >
          <Smartphone size={13} />
        </button>

        <button
          className="btn-ghost"
          style={{ border: 'none', padding: 4 }}
          title="Segarkan Pratinjau"
          onClick={bumpPreviewReload}
        >
          <RefreshCw size={13} />
        </button>

        <a
          href={`${previewState.url}${cleanSub}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost"
          style={{ padding: 4, display: 'inline-flex', alignItems: 'center' }}
          title="Buka di Browser Eksternal"
        >
          <ExternalLink size={13} />
        </a>

        <button
          className="btn-ghost"
          style={{ border: 'none', padding: 4 }}
          title="Tutup Live Preview"
          onClick={() => void togglePreviewPane()}
        >
          <X size={14} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          background: '#0b0d12',
          display: 'flex',
          justifyContent: 'center',
          overflow: 'auto'
        }}
      >
        <iframe
          key={`${fullUrl}`}
          src={fullUrl}
          title="HMW Studio Live Web Preview"
          style={{
            width: iframeMaxWidth,
            height: '100%',
            border: 'none',
            background: '#ffffff'
          }}
        />
      </div>
    </aside>
  );
};
