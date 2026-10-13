import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { BACKGROUNDS } from '../../../shared/constants';
import type { BackgroundAsset } from '../../../shared/types';
import { Section } from './Controls';

export interface CanvasBackgroundProps {
  backgrounds?: BackgroundAsset[];
  onChooseBackground?: () => void;
  importingBackground?: boolean;
}

export function CanvasBackgroundPanel({ selected, onSelect, backgrounds, onChooseBackground, importingBackground }: CanvasBackgroundProps & {
  selected: string; onSelect: (background: string) => void;
}) {
  return <Section title="背景" help="支持 PNG、JPEG、WebP，最大 20 MB。图片随项目保存，下次新建项目沿用最近选择。">
    <div className="background-grid" role="group" aria-label="画布背景">
      {BACKGROUNDS.map(background => <button key={background.id} type="button"
        className={`background-swatch ${selected === background.id ? 'selected' : ''}`}
        style={{ background: `linear-gradient(135deg, ${background.colors.join(', ')})` }} title={background.name}
        aria-label={background.name} aria-pressed={selected === background.id} onClick={() => onSelect(background.id)}>
        {selected === background.id && <Check size={17} />}
      </button>)}
      {backgrounds?.map(asset => <button key={asset.id} type="button"
        className={`background-swatch background-image-swatch ${selected === `asset:${asset.id}` ? 'selected' : ''}`}
        title={asset.name} aria-label={`背景图片：${asset.name}`} aria-pressed={selected === `asset:${asset.id}`}
        onClick={() => onSelect(`asset:${asset.id}`)}>
        <img src={asset.src} alt="" loading="lazy" />{selected === `asset:${asset.id}` && <Check size={17} />}
      </button>)}
    </div>
    <button type="button" className="canvas-background-upload" onClick={onChooseBackground} disabled={!onChooseBackground || importingBackground}>
      {importingBackground ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}
      {importingBackground ? '正在上传' : '上传图片'}
    </button>
  </Section>;
}
