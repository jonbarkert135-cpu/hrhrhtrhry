import { decodeSculpture } from './sculptureGeometry';

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
uniform float yaw;
uniform vec2 scale;
varying vec3 n;
void main() {
  float c=cos(yaw), s=sin(yaw);
  mat3 turn=mat3(c,0.,-s, 0.,1.,0., s,0.,c);
  vec3 p=turn*position;
  n=turn*normal;
  gl_Position=vec4(p.x*scale.x,p.y*scale.y,p.z*.22,1.);
}`;
const FRAGMENT = `
precision mediump float;
varying vec3 n;
uniform vec3 silver;
void main() {
  vec3 N=normalize(n);
  vec3 L=normalize(vec3(-.7,1.,1.4));
  vec3 R=normalize(vec3(1.,.3,-.4));
  float key=max(dot(N,L),0.);
  float rim=pow(1.-abs(N.z),3.);
  float spec=pow(max(dot(reflect(-L,N),vec3(0.,0.,1.)),0.),24.);
  float edge=pow(max(dot(N,R),0.),12.);
  float light=.035+key*.12+rim*.17+spec*.48+edge*.18;
  gl_FragColor=vec4(silver*light,1.);
}`;

export interface SculptureController {
  setActive(active: boolean): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** No React work per frame, one reusable buffer pair, bounded resolution and at most 30 draws/s. */
export async function mountRaven(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<SculptureController> {
  const response = await fetch(`${import.meta.env.BASE_URL}brand/raven-sculpture.bin`, { signal });
  if (!response.ok) throw new Error('Sculpture unavailable');
  const mesh = decodeSculpture(await response.arrayBuffer());
  signal.throwIfAborted();
  const context = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  if (context === null) throw new Error('WebGL unavailable');
  const gl: WebGLRenderingContext = context;
  const shaders: WebGLShader[] = [];
  const buffers: WebGLBuffer[] = [];
  const program = gl.createProgram();
  if (program === null) throw new Error('GPU unavailable');
  let frame = 0;
  let active = false;
  let paused = false;
  let disposed = false;
  let last = 0;
  let angle = -0.3;
  const observer = new ResizeObserver(() => draw());
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    signal.removeEventListener('abort', dispose);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteProgram(program);
  };
  function shader(kind: number, source: string): WebGLShader {
    const value = gl.createShader(kind);
    if (value === null) throw new Error('Shader unavailable');
    shaders.push(value);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('Shader unavailable');
    return value;
  }
  let yaw: WebGLUniformLocation | null = null;
  let scale: WebGLUniformLocation | null = null;
  let silver: WebGLUniformLocation | null = null;
  function draw(): void {
    if (disposed || signal.aborted || gl.isContextLost()) return;
    const size = Math.min(
      768,
      Math.max(1, Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 1.5))),
    );
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    gl.viewport(0, 0, size, size);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(yaw, angle);
    gl.uniform2f(scale, 0.61, 0.61);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  function tick(now: number): void {
    frame = 0;
    if (disposed || !active || paused || signal.aborted || gl.isContextLost()) return;
    const elapsed = now - last;
    if (elapsed >= 1000 / 30) {
      angle += (Math.min(elapsed, 80) * Math.PI) / 12_000;
      last = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = performance.now();
    if (active && !paused && !disposed) frame = requestAnimationFrame(tick);
  };
  try {
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    gl.useProgram(program);
    yaw = gl.getUniformLocation(program, 'yaw');
    scale = gl.getUniformLocation(program, 'scale');
    silver = gl.getUniformLocation(program, 'silver');
    const bind = (target: number, data: ArrayBufferView): void => {
      const buffer = gl.createBuffer();
      if (buffer === null) throw new Error('GPU buffer unavailable');
      buffers.push(buffer);
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, data, gl.STATIC_DRAW);
    };
    bind(gl.ARRAY_BUFFER, mesh.data);
    bind(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    for (const [name, offset] of [
      ['position', 0],
      ['normal', 12],
    ] as const) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 24, offset);
    }
    gl.enable(gl.DEPTH_TEST);
    const tone = getComputedStyle(canvas)
      .color.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number) ?? [237, 240, 245];
    gl.uniform3f(silver, (tone[0] ?? 237) / 255, (tone[1] ?? 240) / 255, (tone[2] ?? 245) / 255);
    gl.clearColor(0, 0, 0, 0);
    observer.observe(canvas);
    signal.addEventListener('abort', dispose, { once: true });
    draw();
    return {
      setActive(value) {
        active = value;
        schedule();
      },
      setPaused(value) {
        paused = value;
        schedule();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
