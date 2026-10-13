import type { CameraEffects } from '../../../shared/types';
import { makeCanvas, resizeCanvas, sourceSize, type EffectsCanvas } from './canvas';
import { cameraBrightnessGain, EFFECTS_KERNEL as K } from './parameters';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';
import { GpuTexturePass, type GpuPass } from './gpu-pass';

/** One private context/texture/program per renderer. No per-frame shader or GPU allocation. */
export class EffectsGpu {
  readonly canvas: EffectsCanvas = makeCanvas();
  private gl: WebGLRenderingContext;
  private program?: WebGLProgram;
  private texture?: WebGLTexture;
  private buffer?: WebGLBuffer;
  private step?: WebGLUniformLocation;
  private settings?: WebGLUniformLocation;
  private width = 0;
  private height = 0;
  private lost = false;
  private failed = false;
  private disposed = false;
  private firstPass?: GpuTexturePass;
  private firstPassShader?: string;

  constructor(private fragment = FRAGMENT_SHADER,
    private configure?: (gl: WebGLRenderingContext, program: WebGLProgram, width: number, height: number, effects: CameraEffects) => void) {
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false,
      antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    try { this.initialize(); } catch (error) { this.dispose(); throw error; }
  }
  private contextLost = (event: Event): void => { event.preventDefault(); this.lost = true; };
  private contextRestored = (): void => {
    if (this.disposed) return;
    this.lost = false;
    try { this.initialize(); } catch { this.failed = true; }
  };
  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl, shader = gl.createShader(type);
    if (!shader) throw new Error('无法分配摄像头着色器');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error(`摄像头着色器编译失败：${message ?? ''}`);
    }
    return shader;
  }
  private createProgram(fragment: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram(); if (!program) throw new Error('无法创建摄像头处理程序');
    const shaders: WebGLShader[] = [];
    try {
      shaders.push(this.shader(gl.VERTEX_SHADER, VERTEX_SHADER));
      shaders.push(this.shader(gl.FRAGMENT_SHADER, fragment));
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.bindAttribLocation(program, 0, 'aPosition'); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`摄像头着色器链接失败：${gl.getProgramInfoLog(program) ?? ''}`);
    } catch (error) { gl.deleteProgram(program); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
    return program;
  }
  private initialize(): void {
    const gl = this.gl;
    this.width = 0; this.height = 0;
    // Restoration invalidates old handles; deleting them in the restored context creates GL errors.
    this.firstPass = undefined; this.firstPassShader = undefined;
    this.program = undefined; this.texture = undefined; this.buffer = undefined;
    if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) throw new Error('WebGL 高精度颜色处理不可用');
    const program = this.program = this.createProgram(this.fragment);
    const texture = gl.createTexture(), buffer = gl.createBuffer();
    if (texture) this.texture = texture;
    if (buffer) this.buffer = buffer;
    if (!texture || !buffer) throw new Error('无法分配摄像头纹理');
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    const step = gl.getUniformLocation(program, 'sampleStep'), settings = gl.getUniformLocation(program, 'settings');
    this.step = step ?? undefined; this.settings = settings ?? undefined;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.DITHER);
  }
  /** null means CPU must render this frame, including the first frame during context loss. */
  render(source: CanvasImageSource, effects: CameraEffects, pass?: GpuPass): EffectsCanvas | null {
    const gl = this.gl;
    if (this.disposed || this.failed || this.lost || gl.isContextLost()) return null;
    if (typeof SVGImageElement !== 'undefined' && source instanceof SVGImageElement) return null;
    try {
      const { width, height } = sourceSize(source);
      if (pass && this.firstPassShader !== pass.shader) {
        this.firstPass?.dispose(); this.firstPass = undefined; this.firstPassShader = undefined;
        this.firstPass = new GpuTexturePass(gl, this.createProgram(pass.shader)); this.firstPassShader = pass.shader;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texture!);
      if (width !== this.width || height !== this.height) {
        resizeCanvas(this.canvas, width, height); gl.viewport(0, 0, width, height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        // Only synchronize after allocation, not after every frame upload/draw.
        if (gl.getError() !== gl.NO_ERROR || gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) throw new Error('摄像头纹理分配失败');
        this.width = width; this.height = height;
      }
      // CanvasSink and live video objects are reused: upload pixels on EVERY render.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source as Exclude<CanvasImageSource, SVGImageElement>);
      const input = pass ? this.firstPass!.render(this.texture!, width, height, effects, pass.configure) : this.texture!;
      gl.useProgram(this.program!); gl.bindTexture(gl.TEXTURE_2D, input);
      const size = Math.max(width, height);
      const micro = Math.max(1, size * K.microRadiusScale), tone = Math.max(1, size * K.toneRadiusScale);
      gl.uniform4f(this.step ?? null, micro / width, micro / height, tone / width, tone / height);
      gl.uniform4f(this.settings ?? null, effects.smoothing, cameraBrightnessGain(effects.brightness),
        effects.filter === 'warm' ? 1 : effects.filter === 'cool' ? 2 : effects.filter === 'mono' ? 3 : 0, effects.intensity);
      this.configure?.(gl, this.program!, width, height, effects);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return gl.isContextLost() ? null : this.canvas;
    } catch (error) {
      if (!gl.isContextLost()) this.failed = true;
      throw error;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    const gl = this.gl;
    this.firstPass?.dispose(); this.firstPass = undefined;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = 1; this.canvas.height = 1;
  }
}
