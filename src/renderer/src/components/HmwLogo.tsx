import React, { useId } from 'react';

interface HmwLogoProps {
  size?: number;
  glow?: boolean;
}

export const HmwLogo: React.FC<HmwLogoProps> = ({ size = 28, glow = false }) => {
  const uid = useId().replace(/:/g, '');
  const bgGradId = `hmw-bg-${uid}`;
  const ringGradId = `hmw-ring-${uid}`;
  const accentGradId = `hmw-acc-${uid}`;
  const cyanGradId = `hmw-cyan-${uid}`;
  const sheenGradId = `hmw-sheen-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        flexShrink: 0,
        display: 'block',
        filter: glow
          ? 'drop-shadow(0 12px 28px rgba(249, 115, 22, 0.32))'
          : 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.38))'
      }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgGradId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E273B" />
          <stop offset="55%" stopColor="#121724" />
          <stop offset="100%" stopColor="#0B0E17" />
        </linearGradient>

        <linearGradient id={ringGradId} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="50%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        <linearGradient id={accentGradId} x1="22" y1="16" x2="42" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDBA74" />
          <stop offset="45%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>

        <linearGradient id={cyanGradId} x1="10" y1="20" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>

        <linearGradient id={sheenGradId} x1="32" y1="4" x2="32" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Base Squircle */}
      <rect
        x="3"
        y="3"
        width="58"
        height="58"
        rx="15"
        fill={`url(#${bgGradId})`}
        stroke={`url(#${ringGradId})`}
        strokeWidth="2.4"
      />

      {/* Top Glass Specular Sheen */}
      <path
        d="M18 4.5H46C53.4558 4.5 59.5 10.5442 59.5 18V24C43 28.5 21 28.5 4.5 24V18C4.5 10.5442 10.5442 4.5 18 4.5Z"
        fill={`url(#${sheenGradId})`}
      />

      {/* Left Code Chevron (<) */}
      <path
        d="M18.5 23L10.5 32L18.5 41"
        stroke={`url(#${cyanGradId})`}
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Right Code Chevron (>) */}
      <path
        d="M45.5 23L53.5 32L45.5 41"
        stroke={`url(#${accentGradId})`}
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sculpted Central 'H' Pillars & Dynamic Crossbar */}
      <rect x="23" y="18" width="5.2" height="28" rx="2.6" fill="#F8FAFC" />
      <rect x="35.8" y="18" width="5.2" height="28" rx="2.6" fill="#F8FAFC" />
      <path
        d="M24.5 32H39.5"
        stroke={`url(#${accentGradId})`}
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="2.4" fill="#FFF7ED" />
    </svg>
  );
};
