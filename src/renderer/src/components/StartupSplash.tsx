import React from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { HmwLogo } from './HmwLogo';

export const StartupSplash: React.FC = () => {
  const { splashVisible, dismissSplash } = useIdeStore();

  if (!splashVisible) return null;

  return (
    <div
      onClick={dismissSplash}
      title="Klik di mana saja untuk langsung masuk"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background:
          'radial-gradient(circle at 50% 34%, rgba(249, 115, 22, 0.14), transparent 52%), radial-gradient(circle at 62% 62%, rgba(56, 189, 248, 0.1), transparent 48%), #0c0f17',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        cursor: 'pointer'
      }}
    >
      <HmwLogo size={88} glow />

      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: -0.5,
            color: '#f8fafc',
            marginBottom: 6
          }}
        >
          HMW <span style={{ color: '#f97316' }}>Studio</span>
        </h1>

        <p
          style={{
            color: '#94a3b8',
            fontSize: 13,
            letterSpacing: 0.2
          }}
        >
          Modern Web, PHP &amp; Remote Server Development Environment
        </p>

        <div
          style={{
            marginTop: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}
        >
          {['Direct SFTP / FTPS', 'PHP 8 & Wisanggeni', 'Google Gemini AI'].map((pill) => (
            <span
              key={pill}
              style={{
                padding: '4px 11px',
                borderRadius: 999,
                background: 'rgba(30, 41, 59, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                color: '#cbd5e1',
                fontSize: 11.5,
                fontWeight: 600
              }}
            >
              {pill}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          width: 240,
          height: 4,
          borderRadius: 999,
          background: 'rgba(148, 163, 184, 0.16)',
          overflow: 'hidden',
          marginTop: 4
        }}
      >
        <div className="hmw-splash-bar" />
      </div>
    </div>
  );
};
