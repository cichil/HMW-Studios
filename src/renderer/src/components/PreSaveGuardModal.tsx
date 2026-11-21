import React from 'react';
import { AlertTriangle, ExternalLink, ShieldAlert, Sparkles, UploadCloud, X } from 'lucide-react';
import { useIdeStore } from '../store/useIdeStore';

export const PreSaveGuardModal: React.FC = () => {
  const {
    pendingSaveGuard,
    dismissSaveGuard,
    confirmSaveGuardForce,
    cleanAndSaveGuard,
    jumpToTabLine
  } = useIdeStore();

  if (!pendingSaveGuard) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{ width: 'min(620px, 95vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <ShieldAlert
              size={19}
              color={pendingSaveGuard.isProduction ? '#fb7185' : '#fbbf24'}
              style={{ flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                🛡️ Sabuk Pengaman Simpan ke Server {pendingSaveGuard.connectionName}
                {pendingSaveGuard.isProduction ? ' (🔴 PRODUKSI)' : ''}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                File: <strong>{pendingSaveGuard.tabTitle}</strong> — Ditemukan{' '}
                {pendingSaveGuard.hazards.length} potensi jebakan debug / sintaks sebelum diunggah.
              </div>
            </div>
          </div>
          <button type="button" className="btn-modal-exit" onClick={dismissSaveGuard}>
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
          {pendingSaveGuard.hazards.map((h, i) => (
            <div
              key={`${h.line}-${i}`}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background:
                  h.severity === 'critical'
                    ? 'rgba(244, 63, 94, 0.12)'
                    : 'rgba(245, 158, 11, 0.11)',
                border:
                  h.severity === 'critical'
                    ? '1px solid rgba(251, 113, 133, 0.4)'
                    : '1px solid rgba(251, 191, 36, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle
                    size={12.5}
                    color={h.severity === 'critical' ? '#fb7185' : '#fbbf24'}
                  />
                  <span>Baris {h.line}: {h.message}</span>
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {h.snippet}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  jumpToTabLine(pendingSaveGuard.tabId, h.line);
                  dismissSaveGuard();
                }}
              >
                <ExternalLink size={11} />
                <span>Baris {h.line}</span>
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={dismissSaveGuard}>
            Batal &amp; Periksa Kode
          </button>

          {pendingSaveGuard.hasAutoRemovable && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void cleanAndSaveGuard()}
              title="Hapus baris var_dump / print_r / dd / debugger otomatis lalu simpan ke server"
            >
              <Sparkles size={13} />
              <span>Hapus Jebakan Debug &amp; Simpan</span>
            </button>
          )}

          <button
            type="button"
            className="btn"
            style={{
              borderColor: 'rgba(251, 113, 133, 0.45)',
              color: '#fda4af'
            }}
            onClick={() => void confirmSaveGuardForce()}
          >
            <UploadCloud size={13} />
            <span>Tetap Simpan Apa Adanya</span>
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
