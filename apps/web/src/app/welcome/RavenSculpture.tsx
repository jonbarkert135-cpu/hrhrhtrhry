import { useEffect, useRef, useState } from 'react';
import { PauseIcon, PlayIcon } from '@radix-ui/react-icons';
import type { SculptureController } from './ravenRenderer';

export function RavenSculpture() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const figure = useRef<HTMLElement>(null);
  const controller = useRef<SculptureController | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== 'function' || typeof IntersectionObserver !== 'function')
      return undefined;
    const target = canvas.current;
    if (target === null) return undefined;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const abort = new AbortController();
    let visible = false;
    let starting = false;
    const update = (): void => {
      controller.current?.setActive(visible && !document.hidden && !motion.matches);
      if (visible && !document.hidden && !motion.matches && !starting && canvas.current !== null) {
        starting = true;
        void import('./ravenRenderer')
          .then(({ mountRaven }) => mountRaven(target, abort.signal))
          .then((instance) => {
            if (abort.signal.aborted) {
              instance.dispose();
              return;
            }
            controller.current = instance;
            setReady(true);
            update();
          })
          .catch(() => {
            /* A static self-hosted emblem remains available */
          });
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      update();
    });
    if (figure.current !== null) observer.observe(figure.current);
    const lost = (): void => {
      controller.current?.dispose();
      setReady(false);
    };
    target.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', update);
    motion.addEventListener('change', update);
    return () => {
      observer.disconnect();
      target.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', update);
      motion.removeEventListener('change', update);
      abort.abort();
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.setPaused(paused);
  }, [paused, ready]);
  return (
    <figure ref={figure} className="rvn-sculpture" data-renderer={ready ? 'webgl' : 'static'}>
      <img
        className="rvn-sculpture-fallback"
        src={`${import.meta.env.BASE_URL}brand/raven-silver-hero.webp`}
        width={768}
        height={768}
        alt=""
        fetchPriority="high"
      />
      <canvas ref={canvas} aria-hidden="true" />
      {ready ? (
        <button
          type="button"
          className="rvn-sculpture-pause"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
          {paused ? 'Resume rotation' : 'Pause rotation'}
        </button>
      ) : null}
    </figure>
  );
}
