'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hot: boolean;
  px: number;
  py: number;
}

const DENSITY = 11000;
const MAX_NODES = 82;
const LINK = 168;
const DRIFT = 0.06;
const REACH = 200;
const PUSH = 26;

export function GraphField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let nodes: Node[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    const pointer = { x: 0, y: 0, on: false };

    const ink = () =>
      getComputedStyle(canvas).getPropertyValue('--field-ink').trim() || '148,158,170';
    const hot = () =>
      getComputedStyle(canvas).getPropertyValue('--field-hot').trim() || '216,119,87';

    function seed() {
      const count = Math.min(MAX_NODES, Math.round((width * height) / DENSITY));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * DRIFT,
        vy: (Math.random() - 0.5) * DRIFT,
        r: Math.random() < 0.18 ? 2.1 : 1.3,
        hot: i % 9 === 0,
        px: 0,
        py: 0,
      }));
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw();
    }

    function draw() {
      const base = ink();
      const accent = hot();
      ctx!.clearRect(0, 0, width, height);

      for (const node of nodes) {
        node.px = node.x;
        node.py = node.y;
        if (!pointer.on) continue;
        const dx = node.x - pointer.x;
        const dy = node.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist > REACH || dist < 0.01) continue;
        const push = (1 - dist / REACH) * PUSH;
        node.px += (dx / dist) * push;
        node.py += (dy / dist) * push;
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]!;
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK) continue;
          const strength = 1 - dist / LINK;
          ctx!.strokeStyle = `rgba(${a.hot || b.hot ? accent : base}, ${strength * 0.22})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(a.px, a.py);
          ctx!.lineTo(b.px, b.py);
          ctx!.stroke();
        }
      }

      if (pointer.on) {
        for (const node of nodes) {
          const dist = Math.hypot(node.px - pointer.x, node.py - pointer.y);
          if (dist > REACH) continue;
          ctx!.strokeStyle = `rgba(${accent}, ${(1 - dist / REACH) * 0.4})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(pointer.x, pointer.y);
          ctx!.lineTo(node.px, node.py);
          ctx!.stroke();
        }
      }

      for (const node of nodes) {
        ctx!.fillStyle = `rgba(${node.hot ? accent : base}, ${node.hot ? 0.55 : 0.32})`;
        ctx!.beginPath();
        ctx!.arc(node.px, node.py, node.r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function step() {
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;
      }
      draw();
      frame = requestAnimationFrame(step);
    }

    function start() {
      cancelAnimationFrame(frame);
      if (reduced.matches || !visible) {
        draw();
        return;
      }
      frame = requestAnimationFrame(step);
    }

    function onMove(event: MouseEvent) {
      if (reduced.matches) return;
      const rect = canvas!.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.on =
        pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height;
    }

    function onLeave() {
      pointer.on = false;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting;
          start();
        }
      },
      { threshold: 0 },
    );

    resize();
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    reduced.addEventListener('change', start);
    start();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      reduced.removeEventListener('change', start);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="field pointer-events-none absolute inset-0 -z-10 h-full w-full"
    />
  );
}
