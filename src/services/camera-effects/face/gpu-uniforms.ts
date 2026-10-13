import { beautyValue as value } from '../../../../shared/beauty';
import type { ConfigureGpuPass } from '../gpu-pass';
import { MAX_WARPS, type FaceGeometry } from './geometry';
import { faceEffectBounds } from './bounds';

export class FaceGpuUniforms {
  geometry?: FaceGeometry;
  private program?: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private warps = new Float32Array(MAX_WARPS * 4);
  private shifts = new Float32Array(MAX_WARPS * 2);
  readonly configure: ConfigureGpuPass = (gl, program, _width, _height, effects) => {
    const face = this.geometry!;
    if (this.program !== program) { this.program = program; this.locations.clear(); }
    const location = (name: string) => {
      if (!this.locations.has(name)) this.locations.set(name, gl.getUniformLocation(program, name));
      return this.locations.get(name)!;
    };
    this.warps.fill(0); this.shifts.fill(0);
    face.warps.forEach((warp, i) => {
      this.warps.set([warp.center.x, warp.center.y, warp.radius, warp.zoom], i * 4);
      this.shifts.set([warp.dx, warp.dy], i * 2);
    });
    gl.uniform4fv(location('warps[0]'), this.warps); gl.uniform2fv(location('shifts[0]'), this.shifts);
    gl.uniform1f(location('aspect'), face.aspect);
    gl.uniform4fv(location('effectBounds'), faceEffectBounds(face));
    gl.uniform4f(location('face'), face.center.x, face.center.y, face.width, face.height);
    gl.uniform2f(location('axis'), face.axis.x, face.axis.y);
    gl.uniform1f(location('mouthOpen'), face.mouthOpen);
    gl.uniform4f(location('amounts'), value(effects.skinWhitening), value(effects.rosiness), value(effects.eyeBrightening), value(effects.teethWhitening));
    for (const [name, points] of [['mouth', face.mouth], ['leftEye', face.eyes[0]], ['rightEye', face.eyes[1]]] as const)
      gl.uniform2fv(location(name + '[0]'), new Float32Array(points.flatMap(point => [point.x, point.y])));
  };
}
