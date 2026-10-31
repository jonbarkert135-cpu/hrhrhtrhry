/**
 * The board surface: one canvas, one absolutely-positioned DOM overlay for near-zoom node hosts,
 * the navigation dock and the empty-board teaching state (20_ROADMAP P2 §6).
 *
 * The engine owns frame geometry; React updates the navigation readout on camera changes.
 */

import {
  ChevronDownIcon,
  EnterFullScreenIcon,
  MinusIcon,
  PlusIcon,
  Share1Icon,
  ViewGridIcon,
} from '@radix-ui/react-icons';
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './canvas-navigation.css';

import { useCanvasEngine } from './useCanvasEngine';
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, useMinimap } from './useMinimap';
import type { Engine, Intent, SceneSnapshot } from '@nexus/canvas-engine';

const ZOOM_STOPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export interface CanvasHostProps {
  scene?: SceneSnapshot;
  /** Rendered above the canvas; receives the overlay slot lookup for the node card portals. */
  children?:
    | ((api: {
        slotOf: (id: string) => HTMLElement | undefined;
        screenOf: (world: { x: number; y: number }) => { x: number; y: number };
      }) => React.ReactNode)
    | undefined;
  /** Engine intents, forwarded to the document binding (P3 §5.14). */
  onIntent?: ((intent: Intent) => void) | undefined;
  /** Called once the engine exists, so the page can push scene patches into it. */
  onEngine?: ((engine: Engine | null) => void) | undefined;
  /**
   * Authoritative node count from the document. The host tracks the engine's own count, but a page
   * that pushes scene patches (the board) knows the truth first — without this the teaching hint
   * stays on top of the first note the user creates.
   */
  nodeCount?: number | undefined;
  /** True while a non-canvas view mode covers the canvas: hide it from focus and assistive tech. */
  inert?: boolean | undefined;
}

export function CanvasHost({
  scene,
  onIntent,
  onEngine,
  children,
  nodeCount: nodeCountProp,
  inert = false,
}: CanvasHostProps) {
  const {
    canvasRef,
    overlayRef,
    engineRef,
    zoom,
    nodeCount: engineNodeCount,
    slotOf,
    screenOf,
    setBundleDensity,
  } = useCanvasEngine({
    ...(scene === undefined ? {} : { scene }),
    ...(onIntent === undefined ? {} : { onIntent }),
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const minimapId = useId();
  const bundlingId = useId();
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  // Called after useCanvasEngine so the engine already exists when this effect runs.
  useMinimap(engineRef, minimapRef);
  // Bundling is off at 0, which is where it starts: a fan of parallel relationships is information,
  // and collapsing it is a choice the analyst makes (07 §7.6, P5 part 4 §4).
  const [bundleDensity, setDensity] = useState(0);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const nodeCount = nodeCountProp ?? engineNodeCount;

  // The engine is created in an effect inside the hook, so it exists on the first commit.
  useEffect(() => {
    onEngine?.(engineRef.current);
    return () => onEngine?.(null);
  }, [engineRef, onEngine]);

  // `M` hides and shows the minimap. Typing must never reach it, so a focused field wins (§7.6).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'm' && event.key !== 'M') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return;
      setMinimapVisible((visible) => !visible);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const centre = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    return { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
  }, [canvasRef]);

  const zoomTo = useCallback(
    (value: number) => engineRef.current?.camera.zoomTo(value, centre(), { animate: true }),
    [engineRef, centre],
  );

  return (
    <div ref={rootRef} className="nx-canvas-host" data-testid="canvas-host" inert={inert}>
      <div
        role="application"
        aria-roledescription="Research canvas"
        aria-label="Board canvas. Drag to pan, scroll to zoom, drag on empty space to select"
        className="nx-canvas-stack"
      >
        <canvas
          ref={canvasRef}
          data-testid="canvas-surface"
          tabIndex={0}
          aria-label="Board canvas. Drag to pan, scroll to zoom, drag on empty space to select"
          className="nx-canvas-surface"
        />
        {/* Node hosts are mounted here by the engine's overlay; React never touches its children. */}
        <div ref={overlayRef} data-testid="canvas-overlay" className="nx-canvas-overlay" />
        {children?.({ slotOf, screenOf })}
        {nodeCount === 0 ? (
          <div className="nx-canvas-empty" data-testid="canvas-empty">
            <span className="nx-empty-emblem" aria-hidden="true">
              <Share1Icon />
            </span>
            <strong>Make the first connection</strong>
            <p>Paste a link, drop a file, or press N for a note</p>
          </div>
        ) : null}
      </div>

      <section className="nx-canvas-navigator" aria-label="Canvas navigation">
        <button
          type="button"
          className="nx-map-toggle"
          aria-label="Toggle minimap"
          aria-expanded={minimapVisible}
          aria-controls={minimapId}
          aria-keyshortcuts="M"
          onClick={() => setMinimapVisible((visible) => !visible)}
        >
          <span>
            <ViewGridIcon aria-hidden="true" />
            Overview
          </span>
          <ChevronDownIcon className="nx-map-chevron" aria-hidden="true" />
        </button>
        <div
          id={minimapId}
          className="nx-map-panel"
          data-expanded={minimapVisible}
          aria-hidden={!minimapVisible}
          inert={!minimapVisible}
        >
          <div className="nx-map-clip">
            <div className="nx-map-frame">
              <canvas
                ref={minimapRef}
                data-testid="canvas-minimap"
                className="nx-minimap"
                width={MINIMAP_WIDTH}
                height={MINIMAP_HEIGHT}
                aria-label="Board minimap. Click or drag to move the view, scroll to zoom"
              />
              {nodeCount === 0 ? (
                <span className="nx-map-empty">Your graph appears here</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="nx-line-grouping" role="group" aria-label="Edge bundling">
          <div className="nx-navigation-label">
            <label htmlFor={bundlingId}>Line grouping</label>
            <output htmlFor={bundlingId} aria-live="off">
              {bundleDensity === 0 ? 'Off' : `${String(Math.round(bundleDensity * 100))}%`}
            </output>
          </div>
          <input
            id={bundlingId}
            className="nx-grouping-range"
            type="range"
            min={0}
            max={100}
            step={10}
            value={bundleDensity * 100}
            aria-valuetext={
              bundleDensity === 0 ? 'Off' : `${String(Math.round(bundleDensity * 100))}%`
            }
            style={{ '--nx-range-fill': `${String(bundleDensity * 100)}%` } as CSSProperties}
            onChange={(event) => {
              const next = Number(event.target.value) / 100;
              setDensity(next);
              setBundleDensity(next);
            }}
          />
        </div>
        <div className="nx-navigation-zoom" role="group" aria-label="Zoom controls">
          <button
            type="button"
            className="nx-navigation-button"
            disabled={zoom <= ZOOM_STOPS[0] + 0.001}
            onClick={() => {
              const current = engineRef.current?.camera.state.zoom ?? zoom;
              zoomTo(ZOOM_STOPS.findLast((stop) => stop < current - 0.001) ?? ZOOM_STOPS[0]);
            }}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <MinusIcon aria-hidden="true" />
          </button>
          <div className="nx-zoom-picker">
            <select
              aria-label="Zoom level"
              value={ZOOM_STOPS.find((stop) => Math.abs(stop - zoom) < 0.001) ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'fit') engineRef.current?.camera.fitAll();
                else zoomTo(Number(value));
              }}
            >
              {!ZOOM_STOPS.some((stop) => Math.abs(stop - zoom) < 0.001) ? (
                <option value="" disabled>
                  {Math.round(zoom * 100)}%
                </option>
              ) : null}
              {ZOOM_STOPS.map((stop) => (
                <option key={stop} value={stop}>
                  {stop * 100}%
                </option>
              ))}
              <option value="fit">Fit to view</option>
            </select>
            <ChevronDownIcon aria-hidden="true" />
          </div>
          <button
            type="button"
            className="nx-navigation-button"
            disabled={zoom >= 4 - 0.001}
            onClick={() => {
              const current = engineRef.current?.camera.state.zoom ?? zoom;
              zoomTo(ZOOM_STOPS.find((stop) => stop > current + 0.001) ?? 4);
            }}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <PlusIcon aria-hidden="true" />
          </button>
          <span className="nx-navigation-divider" aria-hidden="true" />
          <button
            type="button"
            className="nx-navigation-button"
            onClick={() => engineRef.current?.camera.fitAll()}
            aria-label="Fit board to view"
            title="Fit board to view"
          >
            <EnterFullScreenIcon aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
