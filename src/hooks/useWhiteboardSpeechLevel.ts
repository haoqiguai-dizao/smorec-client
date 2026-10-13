import { useEffect, useState } from 'react';

const quiet = () => Array<number>(18).fill(0);
export function useWhiteboardSpeechLevel(session: string | undefined, id: string | undefined, recording: boolean) {
  const [levels, setLevels] = useState(quiet);
  useEffect(() => {
    setLevels(quiet());
    if (!recording || !session || !id || !window.whiteboard) return;
    let lastInput = Date.now();
    const unsubscribe = window.whiteboard.onSpeechLevel(event => {
      if (event.session !== session || event.id !== id) return;
      lastInput = Date.now();
      setLevels(values => [...values.slice(1), event.level]);
    });
    // A disconnected or stopped source must never leave a frozen speaking waveform.
    const timer = setInterval(() => {
      if (Date.now() - lastInput > 200) setLevels(values => [...values.slice(1), 0]);
    }, 60);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [session, id, recording]);
  return levels;
}
