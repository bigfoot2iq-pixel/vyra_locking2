import type { CSSProperties } from "react";
import { DAY } from "@/lib/format";
import type { LockInfo } from "@/hooks/useGuardians";

/**
 * One ◆ per day of the lock.
 * claimed → silver · due (earned, unclaimed) → pulsing aurum · now → filling · ahead → hollow.
 */
export function VigilTrack({ lock, claimedDays = 0, now }: { lock: LockInfo; claimedDays?: number; now: number }) {
  const elapsed = Math.max(0, now - lock.start);
  const fullDays = Math.min(Math.floor(elapsed / DAY), lock.durationDays);
  const frac = (elapsed % DAY) / DAY;
  const compact = lock.durationDays > 14;

  return (
    <div className={`vigil${compact ? " vigil-compact" : ""}`} aria-label={`Day ${fullDays} of ${lock.durationDays}`}>
      {Array.from({ length: lock.durationDays }, (_, i) => {
        let state = "";
        if (i < claimedDays) state = "claimed";
        else if (i < fullDays) state = "due";
        else if (i === fullDays && now < lock.end) state = "now";
        return (
          <span
            key={i}
            className={`day ${state}`}
            style={state === "now" ? ({ "--fill": `${Math.round(frac * 100)}%` } as CSSProperties) : undefined}
            title={`Day ${i + 1}`}
          />
        );
      })}
    </div>
  );
}
