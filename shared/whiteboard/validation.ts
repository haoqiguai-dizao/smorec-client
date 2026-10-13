import { BOARD_WORLD_LIMIT, IMAGE_CAPTION_HEIGHT,
  type BoardAction, type BoardElement, type BoardEndpoint, type BoardEvent, type BoardRecording } from './types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('白板数据无效');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('白板坐标或尺寸无效');
  return value;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error('白板文字无效');
  return value;
}
function point(value: unknown) {
  const v = object(value);
  return { x: number(v.x, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT), y: number(v.y, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT) };
}
function bounds(value: unknown) {
  const v = object(value), x = number(v.x, 0, 1), y = number(v.y, 0, 1);
  const width = number(v.width, .001, 1), height = number(v.height, .001, 1);
  if (x + width > 1.001 || y + height > 1.001) throw new Error('白板超出录制区域');
  return { x, y, width, height };
}
function endpoint(value: unknown): BoardEndpoint {
  const v = object(value), parsed = point(v);
  if (v.port !== undefined && v.shapeId === undefined) throw new Error('白板连接点缺少图形');
  if (v.port !== undefined && v.port !== 'top' && v.port !== 'right'
    && v.port !== 'bottom' && v.port !== 'left') throw new Error('白板连接点无效');
  return v.shapeId === undefined ? parsed : { ...parsed, shapeId: string(v.shapeId, 64),
    ...(v.port === undefined ? {} : { port: v.port }) };
}
function element(value: unknown): BoardElement {
  const v = object(value);
  const id = string(v.id, 64), color = string(v.color, 7), size = number(v.size, 1, 96);
  if (!/^#[a-f0-9]{6}$/i.test(color)) throw new Error('白板颜色无效');
  if (v.kind === 'stroke') {
    if (!Array.isArray(v.points) || v.points.length < 1 || v.points.length > 256) throw new Error('白板笔迹过长');
    const points = v.points.map(point);
    return { kind: 'stroke', id, color, size, points };
  }
  if (v.kind === 'text') {
    if (typeof v.text !== 'string' || v.text.length > 1000) throw new Error('白板文字过长');
    return { kind: 'text', id, color, size,
      x: number(v.x, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT), y: number(v.y, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT), text: v.text };
  }
  if (v.kind === 'shape') {
    if (v.shape !== 'rectangle' && v.shape !== 'ellipse' && v.shape !== 'diamond' && v.shape !== 'text') throw new Error('白板图形无效');
    if (typeof v.text !== 'string' || v.text.length > 1000) throw new Error('白板图形文字过长');
    const x = number(v.x, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT), y = number(v.y, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT);
    const width = number(v.width, 8, BOARD_WORLD_LIMIT), height = number(v.height, 8, BOARD_WORLD_LIMIT);
    if (x + width > BOARD_WORLD_LIMIT + .001 || y + height > BOARD_WORLD_LIMIT + .001) throw new Error('白板图形超出画布');
    return { kind: 'shape', id, shape: v.shape, color, size, x, y, width, height, text: v.text };
  }
  if (v.kind === 'image') {
    if (typeof v.caption !== 'string' || v.caption.length > 1000) throw new Error('白板图片注释过长');
    if (typeof v.asset !== 'string' || !/^[a-f0-9-]{36}$/.test(v.asset)) throw new Error('白板图片标识无效');
    const x = number(v.x, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT), y = number(v.y, -BOARD_WORLD_LIMIT, BOARD_WORLD_LIMIT);
    const width = number(v.width, 48, BOARD_WORLD_LIMIT), height = number(v.height, 48, BOARD_WORLD_LIMIT);
    if (x + width > BOARD_WORLD_LIMIT + .001 || y + height + IMAGE_CAPTION_HEIGHT > BOARD_WORLD_LIMIT + .001) throw new Error('白板图片超出画布');
    return { kind: 'image', id, asset: v.asset, color, size, x, y, width, height, caption: v.caption };
  }
  if (v.kind === 'line') {
    if (typeof v.arrow !== 'boolean') throw new Error('白板连线类型无效');
    return { kind: 'line', id, color, size, start: endpoint(v.start), end: endpoint(v.end), arrow: v.arrow };
  }
  throw new Error('白板操作无效');
}
export function parseBoardAction(value: unknown): BoardAction {
  const v = object(value);
  if (v.kind === 'undo' || v.kind === 'redo' || v.kind === 'clear' || v.kind === 'reset') return { kind: v.kind };
  if (v.kind === 'focus') {
    if (v.space !== undefined && v.space !== 'window') throw new Error('白板焦点坐标类型无效');
    const focus = v.space === 'window' ? object(v.point) : undefined;
    return { kind: 'focus', point: focus
      ? { x: number(focus.x, 0, 1), y: number(focus.y, 0, 1) } : point(v.point),
    ...(v.space === 'window' ? { space: 'window' as const } : {}) };
  }
  if (v.kind === 'viewport') {
    const view = object(v.view);
    return { kind: 'viewport', view: { ...point(view), zoom: number(view.zoom, .1, 8) } };
  }
  if (v.kind === 'delete') return { kind: 'delete', id: string(v.id, 64) };
  if (v.kind === 'replace') {
    const item = element(v.element);
    if (v.reveal !== undefined && (v.reveal !== 'text' || item.kind !== 'shape')) throw new Error('白板文字动效无效');
    return { kind: 'replace', gesture: string(v.gesture, 64), element: item,
      ...(v.reveal === 'text' ? { reveal: 'text' } : {}) };
  }
  if (v.kind === 'reveal') {
    const item = element(v.element);
    if (item.kind !== 'shape' && item.kind !== 'line') throw new Error('白板动效只支持图形与连线');
    return { kind: 'reveal', element: item };
  }
  if (v.kind === 'connect-node') {
    const line = element(v.line), node = element(v.node);
    if (line.kind !== 'line' || node.kind !== 'shape' || !line.start.shapeId
      || line.end.shapeId !== node.id || line.id === node.id) throw new Error('白板新节点连线无效');
    if (v.reveal !== undefined && v.reveal !== true) throw new Error('白板新节点动效无效');
    return { kind: 'connect-node', line, node, ...(v.reveal === true ? { reveal: true } : {}) };
  }
  if (v.kind === 'erase') {
    if (!Array.isArray(v.points) || !v.points.length || v.points.length > 256) throw new Error('白板橡皮轨迹无效');
    return { kind: 'erase', id: string(v.id, 64), gesture: string(v.gesture, 64),
      radius: number(v.radius, 1, 20_000), points: v.points.map(point) };
  }
  return element(v);
}
export function parseBoardRecording(value: unknown, duration: number): BoardRecording {
  const { events, video, interfaceCapture, separateCanvas } = object(value);
  if (!Array.isArray(events) || events.length > 100_000) throw new Error('白板记录过长');
  let previous = 0, points = 0;
  const recording: BoardRecording = { events: events.map(value => {
    const v = object(value), t = number(v.t, previous, duration + .1), a = object(v.action);
    previous = t;
    let action: BoardEvent['action'];
    if (a.kind === 'layout') {
      if (typeof a.visible !== 'boolean') throw new Error('白板显示状态无效');
      if (a.presentation !== undefined && a.presentation !== 'canvas' && a.presentation !== 'interface') throw new Error('白板录制模式无效');
      if (a.presentation === 'interface' && a.windowBounds === undefined) throw new Error('完整白板缺少窗口位置');
      if (a.passthrough !== undefined && typeof a.passthrough !== 'boolean') throw new Error('白板鼠标穿透状态无效');
      if (a.backdrop !== undefined && a.backdrop !== 'white' && a.backdrop !== 'camera') throw new Error('白板背景模式无效');
      const transition = a.cameraTransition === undefined ? undefined : object(a.cameraTransition);
      if (transition && transition.direction !== 'enter' && transition.direction !== 'exit') throw new Error('白板过渡方向无效');
      action = { kind: 'layout', visible: a.visible, bounds: bounds(a.bounds),
        ...(a.presentation === undefined ? {} : { presentation: a.presentation }),
        ...(a.windowBounds === undefined ? {} : { windowBounds: bounds(a.windowBounds) }),
        ...(a.passthrough === undefined ? {} : { passthrough: a.passthrough }),
        ...(a.backdrop === undefined ? {} : { backdrop: a.backdrop }),
        ...(a.shade === undefined ? {} : { shade: number(a.shade, 0, .85) }),
        ...(transition ? { cameraTransition: { direction: transition.direction as 'enter' | 'exit',
          duration: number(transition.duration, .1, 3), camera: bounds(transition.camera) } } : {}) };
    } else action = parseBoardAction(a);
    if (action.kind === 'stroke' || action.kind === 'erase') points += action.points.length;
    if (points > 1_000_000) throw new Error('白板笔迹超过容量');
    return { t, action };
  }) };
  if (separateCanvas !== undefined) {
    if (separateCanvas !== true) throw new Error('白板画布来源无效');
    recording.separateCanvas = true;
  }
  if (interfaceCapture !== undefined) {
    if (interfaceCapture !== 'screen' || video !== undefined) throw new Error('白板画面来源无效');
    recording.interfaceCapture = 'screen';
  }
  if (video !== undefined) {
    const v = object(video);
    recording.video = { offset: number(v.offset, -24 * 3600, 0) };
    if (v.crops !== undefined) {
      if (!Array.isArray(v.crops) || v.crops.length > 20_000) throw new Error('白板窗口尺寸记录过长');
      let previous = 0;
      recording.video.crops = v.crops.map(value => {
        const crop = object(value), t = number(crop.t, previous, duration + .1); previous = t;
        return { t, bounds: bounds(crop.bounds) };
      });
    }
  }
  return recording;
}
