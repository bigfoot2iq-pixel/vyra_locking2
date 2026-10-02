"use client";

import { useEffect, useRef } from "react";

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  gold: boolean;
  shard: boolean;
  rot: number;
  vr: number;
}

/** Rising violet motes, gold embers and crystal shards. Pauses when hidden; off for reduced motion. */
export function Embers({ density = 60, goldRatio = 0.22, className }: { density?: number; goldRatio?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const spawn = (anywhere: boolean): Mote => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      vx: (Math.random() - 0.5) * 0.15,
      vy: -(0.15 + Math.random() * 0.45),
      r: 0.6 + Math.random() * 1.8,
      life: 0,
      max: 400 + Math.random() * 500,
      gold: Math.random() < goldRatio,
      shard: Math.random() < 0.25,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.02,
    });
    const motes = Array.from({ length: density }, () => spawn(true));

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.life++;
        m.x += m.vx + Math.sin((m.life + m.max) * 0.01) * 0.12;
        m.y += m.vy;
        m.rot += m.vr;
        const t = m.life / m.max;
        if (t >= 1 || m.y < -10) {
          Object.assign(m, spawn(false));
          continue;
        }
        const alpha = Math.sin(Math.PI * t) * 0.9;
        const color = m.gold ? `rgba(242,194,91,${alpha})` : `rgba(185,161,255,${alpha})`;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rot);
        ctx.shadowBlur = 8;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        if (m.shard) {
          const s = m.r * 2.2;
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.55, 0);
          ctx.lineTo(0, s);
          ctx.lineTo(-s * 0.55, 0);
          ctx.closePath();
        } else {
          ctx.arc(0, 0, m.r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [density, goldRatio]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
