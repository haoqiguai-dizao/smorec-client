import type { BeautyField } from '../../../shared/beauty';

export type BeautyTab = 'skin' | 'face' | 'features' | 'filter';
export interface BeautyControl { key: BeautyField | 'smoothing' | 'brightness'; label: string; help: string; signed?: boolean }
export const BEAUTY_TABS: { id: BeautyTab; label: string }[] = [
  { id: 'skin', label: '肤质' }, { id: 'face', label: '脸型' }, { id: 'features', label: '五官' }, { id: 'filter', label: '滤镜' },
];
export const BEAUTY_CONTROLS: Record<Exclude<BeautyTab, 'filter'>, BeautyControl[]> = {
  skin: [
    { key: 'smoothing', label: '磨皮', help: '平滑肤色与细小瑕疵，保留纹理和轮廓' },
    { key: 'skinWhitening', label: '美白', help: '仅调整面部肤色，保留明暗层次' },
    { key: 'brightness', label: '提亮', help: '调整整体暗部与中间调，保护高光' },
    { key: 'rosiness', label: '红润', help: '轻柔增加面部气色' },
  ],
  face: [
    { key: 'faceSlim', label: '瘦脸', help: '向内轻收两侧脸颊' },
    { key: 'faceSize', label: '小脸', help: '轻微收小面部，边缘平滑过渡' },
    { key: 'jaw', label: '下颌', help: '柔和收窄下颌两侧' },
    { key: 'chin', label: '下巴', help: '向左缩短，向右延长', signed: true },
  ],
  features: [
    { key: 'eyeEnlarge', label: '大眼', help: '轻微放大双眼，闭眼时自动减弱' },
    { key: 'eyeDistance', label: '眼距', help: '向左靠近，向右拉开', signed: true },
    { key: 'noseSlim', label: '瘦鼻', help: '轻收鼻翼，保留鼻梁轮廓' },
    { key: 'mouthSize', label: '嘴型', help: '向左缩小，向右放大', signed: true },
    { key: 'eyeBrightening', label: '亮眼', help: '轻提眼白，保护虹膜和睫毛' },
    { key: 'teethWhitening', label: '白牙', help: '张嘴露齿时减少牙齿黄色，保护嘴唇与舌头' },
  ],
};
