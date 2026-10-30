import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountRaven } from './ravenRenderer';

function asset() {
  const buffer = new ArrayBuffer(86);
  new DataView(buffer).setUint32(0, 3, true);
  new DataView(buffer).setUint32(4, 3, true);
  new Uint16Array(buffer, 80).set([0, 1, 2]);
  return buffer;
}
function setup() {
  const gl = Object.fromEntries(
    [
      'attachShader',
      'shaderSource',
      'compileShader',
      'deleteShader',
      'deleteBuffer',
      'deleteProgram',
      'linkProgram',
      'useProgram',
      'bindBuffer',
      'bufferData',
      'enableVertexAttribArray',
      'vertexAttribPointer',
      'enable',
      'uniform3f',
      'clearColor',
      'viewport',
      'clear',
      'uniform1f',
      'uniform2f',
      'drawElements',
    ].map((key) => [key, vi.fn()]),
  );
  Object.assign(gl, {
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    getUniformLocation: vi.fn(() => ({})),
    getAttribLocation: vi.fn(() => 0),
    getProgramParameter: vi.fn(() => true),
    getShaderParameter: vi.fn(() => true),
    isContextLost: vi.fn(() => false),
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    DEPTH_TEST: 8,
    FLOAT: 9,
    COLOR_BUFFER_BIT: 16,
    DEPTH_BUFFER_BIT: 32,
    TRIANGLES: 10,
    UNSIGNED_SHORT: 11,
  });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 2000 });
  const contextSpy = vi
    .spyOn(canvas, 'getContext')
    .mockReturnValue(gl as unknown as WebGLRenderingContext);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      frames.set(++next, fn);
      return next;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  const disconnect = vi.fn();
  let resized = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(fn: () => void) {
        resized = fn;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(asset()) })),
  );
  vi.stubGlobal('devicePixelRatio', 3);
  function advance(ms: number) {
    for (const [id, fn] of [...frames]) {
      frames.delete(id);
      fn(performance.now() + ms);
    }
  }
  return {
    canvas,
    contextSpy,
    gl: gl as Record<string, ReturnType<typeof vi.fn>>,
    frames,
    advance,
    disconnect,
    resize: () => resized(),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('bounded sculpture renderer', () => {
  it('uploads once, caps resolution and stops drawing when paused, hidden, lost or disposed', async () => {
    const { canvas, gl, frames, advance, disconnect, resize } = setup();
    const abort = new AbortController();
    const controller = await mountRaven(canvas, abort.signal);
    expect(canvas.width).toBe(768);
    expect(gl.bufferData).toHaveBeenCalledTimes(2);
    expect(gl.drawElements).toHaveBeenCalledTimes(1);
    controller.setActive(true);
    advance(10);
    expect(gl.drawElements).toHaveBeenCalledTimes(1);
    advance(50);
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    controller.setPaused(true);
    expect(frames.size).toBe(0);
    controller.setPaused(false);
    expect(frames.size).toBe(1);
    controller.setActive(false);
    expect(frames.size).toBe(0);
    resize();
    expect(gl.drawElements).toHaveBeenCalledTimes(3);
    controller.setActive(true);
    gl.isContextLost!.mockReturnValue(true);
    advance(50);
    expect(frames.size).toBe(0);
    abort.abort();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalled();
    controller.dispose();
    controller.setActive(true);
    expect(frames.size).toBe(0);
  });
  it('cleans shader resources if compilation or linking fails', async () => {
    let fixture = setup();
    fixture.gl.getShaderParameter!.mockReturnValue(false);
    await expect(mountRaven(fixture.canvas, new AbortController().signal)).rejects.toThrow(
      'Shader',
    );
    expect(fixture.gl.deleteProgram).toHaveBeenCalled();
    fixture = setup();
    fixture.gl.getProgramParameter!.mockReturnValue(false);
    await expect(mountRaven(fixture.canvas, new AbortController().signal)).rejects.toThrow('link');
    expect(fixture.gl.deleteShader).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable resources to the static fallback', async () => {
    const { canvas, gl, contextSpy } = setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await expect(mountRaven(canvas, new AbortController().signal)).rejects.toThrow('unavailable');
    contextSpy.mockReturnValueOnce(null);
    await expect(mountRaven(canvas, new AbortController().signal)).rejects.toThrow('WebGL');
    gl.createBuffer!.mockReturnValue(null);
    await expect(mountRaven(canvas, new AbortController().signal)).rejects.toThrow('buffer');
    expect(gl.deleteProgram).toHaveBeenCalled();
  });
});
