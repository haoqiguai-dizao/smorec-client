import { Section } from './Controls';

/** Burned-in screen pixels cannot be changed by editing the retained camera track. */
export function CameraEmbeddedNotice({ local = false }: { local?: boolean }) {
  const help = '演示模式已将人物录入屏幕原片，当前画面无法单独调整人物。'
    + '有人物的区间保留完整屏幕，避免镜头放大裁掉人物。'
    + (local ? '将下方桌面画面设为隐藏或替换，可使用独立摄像头素材；这会同时移除原录屏画面。' : '可在局部镜头中隐藏或替换桌面，使用独立摄像头素材。')
    + '新版新录制的演示片段会保留独立摄像头，可分别调整。';
  return <Section title={local ? '人物已合入录屏' : '摄像头已合入录屏'} help={help}>{null}</Section>;
}
