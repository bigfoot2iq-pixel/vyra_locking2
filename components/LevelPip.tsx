import { LEVEL_COUNT } from "@/hooks/useProtocol";

/** "Lv 3" with five notches, the first `level + 1` lit. `level` is 0-based. */
export function LevelPip({ level, label = true }: { level: number; label?: boolean }) {
  return (
    <span className="level-pip" aria-label={`Level ${level + 1} of ${LEVEL_COUNT}`}>
      {label && <span className="level-pip-label">Lv {level + 1}</span>}
      <span className="level-pip-notches" aria-hidden>
        {Array.from({ length: LEVEL_COUNT }, (_, i) => (
          <i key={i} className={i <= level ? "on" : ""} />
        ))}
      </span>
    </span>
  );
}
