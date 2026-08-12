import { useEffect, useRef } from 'react';
import styles from './HomeAmbientBackdrop.module.css';

// Adapted into a quieter product-shell treatment from the bundled
// `webgl-aurora-veil` MotionSite example. This version is intentionally
// low-resolution, pointer-passive, and capped near 30fps so the Home composer
// remains the visual and performance priority.
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(41.3, 289.1))) * 43758.5453);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 smoothLocal = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), smoothLocal.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), smoothLocal.x),
    smoothLocal.y
  );
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(point);
    point = point * 1.92 + 3.1;
    amplitude *= 0.54;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 point = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  // Keep the aurora expansive on wide home stages. Without this correction,
  // the field retains a roughly fixed pixel width while the canvas grows.
  float wideScale = max(1.0, (uResolution.x / uResolution.y) / 1.65);
  point.x /= wideScale;
  float time = uTime * 0.08;
  float pointerPull = (uPointer.x - 0.5) * 0.34;
  float field = fbm(vec2(point.y * 1.45 - time, point.x * 0.7 + time));

  float leftCenter = -0.42 + sin(point.y * 1.7 + time) * 0.17 + (field - 0.5) * 0.52 + pointerPull;
  float rightCenter = 0.38 + cos(point.y * 1.3 - time * 0.8) * 0.2 - (field - 0.5) * 0.38 + pointerPull * 0.5;
  float leftRibbon = exp(-pow((point.x - leftCenter) / 0.24, 2.0));
  float rightRibbon = exp(-pow((point.x - rightCenter) / 0.3, 2.0));
  float centerGlow = exp(-dot(point * vec2(0.72, 1.18), point * vec2(0.72, 1.18)) * 1.35);

  vec3 violet = vec3(0.48, 0.17, 0.98);
  vec3 blue = vec3(0.15, 0.38, 0.96);
  vec3 cyan = vec3(0.08, 0.72, 0.76);
  vec3 color = violet * leftRibbon * 0.72 + cyan * rightRibbon * 0.48 + blue * centerGlow * 0.26;
  color *= 0.48 + 0.52 * smoothstep(-0.7, 0.8, point.y);
  color += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.015;

  float alpha = clamp((leftRibbon + rightRibbon) * 0.34 + centerGlow * 0.18, 0.0, 0.62);
  outColor = vec4(max(color, 0.0), alpha);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export function HomeAmbientBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof WebGL2RenderingContext === 'undefined') return;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
    const timeLocation = gl.getUniformLocation(program, 'uTime');
    const pointerLocation = gl.getUniformLocation(program, 'uPointer');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { current: 0.5, target: 0.5 };
    let animationFrame = 0;
    let lastDrawAt = 0;
    const startedAt = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(1, Math.floor(bounds.width * ratio));
      const height = Math.max(1, Math.floor(bounds.height * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    const draw = (now: number) => {
      resize();
      pointer.current += (pointer.target - pointer.current) * 0.04;
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (now - startedAt) / 1000);
      gl.uniform2f(pointerLocation, pointer.current, 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const animate = (now: number) => {
      if (now - lastDrawAt >= 32) {
        draw(now);
        lastDrawAt = now;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    const start = () => {
      window.cancelAnimationFrame(animationFrame);
      if (reducedMotion.matches || document.hidden) {
        draw(performance.now());
        return;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.target = Math.min(
        1,
        Math.max(0, (event.clientX - bounds.left) / Math.max(bounds.width, 1)),
      );
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);

    resizeObserver?.observe(canvas);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('visibilitychange', start);
    reducedMotion.addEventListener('change', start);
    start();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('visibilitychange', start);
      reducedMotion.removeEventListener('change', start);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return (
    <div className={styles.root} aria-hidden="true" data-source="webgl-aurora-veil">
      <canvas ref={canvasRef} className={styles.canvas} data-testid="home-ambient-canvas" />
    </div>
  );
}
