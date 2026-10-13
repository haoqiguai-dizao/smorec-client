import type { CameraEffects } from '../../../shared/types';

export type ConfigureGpuPass = (gl: WebGLRenderingContext, program: WebGLProgram,
  width: number, height: number, effects: CameraEffects) => void;
export interface GpuPass { shader: string; configure: ConfigureGpuPass }

/** Intermediate RGBA8 stays in the same WebGL context; no canvas roundtrip. */
export class GpuTexturePass {
  private texture: WebGLTexture;
  private target: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  constructor(private gl: WebGLRenderingContext, private program: WebGLProgram) {
    const texture = gl.createTexture(), target = gl.createFramebuffer();
    if (!texture || !target) {
      if (texture) gl.deleteTexture(texture);
      if (target) gl.deleteFramebuffer(target);
      gl.deleteProgram(program);
      throw new Error('无法分配美颜中间纹理');
    }
    this.texture = texture; this.target = target;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  render(input: WebGLTexture, width: number, height: number, effects: CameraEffects, configure: ConfigureGpuPass): WebGLTexture {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
    try {
      if (width !== this.width || height !== this.height) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE || gl.getError() !== gl.NO_ERROR)
          throw new Error('美颜中间纹理不可用');
        this.width = width; this.height = height;
      }
      gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D, input);
      configure(gl, this.program, width, height, effects);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.texture;
    } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  }
  dispose(): void {
    this.gl.deleteFramebuffer(this.target); this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program);
  }
}
