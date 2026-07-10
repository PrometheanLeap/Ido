import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}

const sizeClasses = {
  sm: 'text-heading',
  md: 'text-display',
  lg: 'text-2xl',
};

export function Logo({ size = 'md', animate = false }: LogoProps) {
  const dim = size === 'lg' ? 48 : size === 'sm' ? 24 : 36;
  return (
    <div className="flex items-center justify-center gap-2 select-none">
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="ido-logo-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-primary-glow)" />
          </linearGradient>
        </defs>
        <style>
          {animate ? `
            @keyframes dot-pulse {
              0%   { opacity: 1; }
              45%  { opacity: 0.2; }
              100% { opacity: 0.2; }
            }
            .dot-0 { animation: dot-pulse 3s ease-in-out infinite; }
            .dot-1 { animation: dot-pulse 3s ease-in-out infinite; animation-delay: 1s; }
            .dot-2 { animation: dot-pulse 3s ease-in-out infinite; animation-delay: 2s; }
          ` : ''}
        </style>
        <circle cx="18" cy="10" r="3" fill="url(#ido-logo-grad)" className={animate ? 'dot-0' : ''} />
        <circle cx="11" cy="22" r="3" fill="url(#ido-logo-grad)" className={animate ? 'dot-1' : ''} />
        <circle cx="25" cy="22" r="3" fill="url(#ido-logo-grad)" className={animate ? 'dot-2' : ''} />
      </svg>
      <span className={`${sizeClasses[size]} font-semibold tracking-tight text-gradient`}>Ido</span>
    </div>
  );
}
