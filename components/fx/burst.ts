/** Throws gold ◆ shards out of an element (claim feedback). Pure DOM, self-cleaning. */
export function burstFrom(el: Element | null, count = 22) {
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 120;
    s.className = "shard-fx";
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist - 50}px`);
    s.style.setProperty("--rot", `${Math.random() * 540 - 270}deg`);
    s.style.setProperty("--dur", `${650 + Math.random() * 550}ms`);
    s.style.setProperty("--size", `${5 + Math.random() * 6}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}
