/** Small inline icons for game buttons. Inherit colour from the button text. */

const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;

export function LockIcon() {
  return (
    <svg {...base}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" fill="currentColor" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12 14.2v2.6" stroke="rgba(0,0,0,.45)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LevelUpIcon() {
  return (
    <svg {...base}>
      <path d="M5 13.5 12 6.5l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19.5 12 12.5l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}

export function ClaimIcon() {
  return (
    <svg {...base}>
      <path d="M12 2.5 20.5 12 12 21.5 3.5 12Z" fill="currentColor" />
      <path d="M12 2.5 15.5 12 12 21.5 8.5 12Z" fill="rgba(255,255,255,.35)" />
    </svg>
  );
}

export function UnlockIcon() {
  return (
    <svg {...base}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" fill="currentColor" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function RenewIcon() {
  return (
    <svg {...base}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M19.8 3.8v4.6h-4.6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
