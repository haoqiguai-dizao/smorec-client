import { ArrowDownToLine, ArrowRight, Monitor } from 'lucide-react';

export function EmptyCanvas({ onRecord, onImport }: { onRecord: () => void; onImport: () => void }) {
  return <div className="empty-canvas studio-home">
    <img className="home-app-icon" src={new URL('../assets/xiaolu-icon.png', import.meta.url).href} alt="" />
    <h1>开始一段新录制</h1>
    <p>把屏幕里的想法，清楚地分享出去。</p>
    <div className="home-start-actions"><button className="home-record-card" onClick={onRecord}><Monitor size={20} /><span><strong>新建录制</strong><small>屏幕、摄像头与声音</small></span><ArrowRight size={16} /></button><button className="home-import-card" onClick={onImport}><ArrowDownToLine size={20} /><span><strong>导入视频</strong><small>继续编辑已有素材</small></span><ArrowRight size={16} /></button></div>
    <span className="home-shortcut">录制完成后，会自动回到这里编辑。</span>
  </div>;
}
