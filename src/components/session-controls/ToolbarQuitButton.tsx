import { LoaderCircle, Power } from 'lucide-react';
import { useState } from 'react';
import { recordingErrorMessage } from '../../services/recording-error-message';

export function ToolbarQuitButton({ disabled = false, label = '退出' }: { disabled?: boolean; label?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const quit = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!window.toolbarPresentation?.quit) throw new Error('退出服务暂不可用，请从系统菜单退出');
      await window.toolbarPresentation.quit();
    } catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { setPending(false); }
  };
  const name = label === '退出' ? '退出小录' : label;
  return <button type="button" className={`session-quit${error ? ' has-error' : ''}`} aria-label={error ? `${name}：${error}` : name}
    title={error || '退出小录'} aria-busy={pending} disabled={disabled || pending} onClick={() => void quit()}>
    {pending ? <LoaderCircle size={17} className="launcher-spinning" /> : <Power size={17} />}<span>{label}</span>
  </button>;
}
