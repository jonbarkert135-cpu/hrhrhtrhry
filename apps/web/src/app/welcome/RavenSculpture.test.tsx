import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RavenSculpture } from './RavenSculpture';
import { mountRaven } from './ravenRenderer';
vi.mock('./ravenRenderer', () => ({ mountRaven: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup(reduce = false) {
  let intersect: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof intersect) {
        intersect = cb;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const controller = { setActive: vi.fn(), setPaused: vi.fn(), dispose: vi.fn() };
  vi.mocked(mountRaven).mockResolvedValue(controller);
  return {
    controller,
    disconnect,
    visible: async (value: boolean) => {
      await act(async () => {
        intersect([{ isIntersecting: value }]);
        await Promise.resolve();
      });
    },
  };
}
describe('Raven motion lifecycle', () => {
  it('starts only when visible, offers pause, stops offscreen and releases on unmount', async () => {
    const { controller, visible, disconnect } = setup();
    const { unmount, container } = render(<RavenSculpture />);
    expect(mountRaven).not.toHaveBeenCalled();
    await visible(true);
    await screen.findByRole('button', { name: 'Pause rotation' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause rotation' }));
    expect(controller.setPaused).toHaveBeenLastCalledWith(true);
    await visible(false);
    expect(controller.setActive).toHaveBeenLastCalledWith(false);
    const canvas = container.querySelector('canvas')!;
    fireEvent(canvas, new Event('webglcontextlost'));
    expect(container.querySelector('figure')).toHaveAttribute('data-renderer', 'static');
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(controller.dispose).toHaveBeenCalled();
  });
  it('keeps a static image with reduced motion and on renderer failure', async () => {
    const reduced = setup(true);
    const view = render(<RavenSculpture />);
    await reduced.visible(true);
    expect(mountRaven).not.toHaveBeenCalled();
    view.unmount();
    const next = setup();
    vi.mocked(mountRaven).mockRejectedValueOnce(new Error('No GPU'));
    const { container } = render(<RavenSculpture />);
    await next.visible(true);
    await waitFor(() =>
      expect(container.querySelector('figure')).toHaveAttribute('data-renderer', 'static'),
    );
  });
});
