import { useCallback, useEffect, useRef, useState } from 'react';
import { applyBoardAction, applyBoardEvent, emptyBoard } from '../../shared/whiteboard/model';
import type { BoardAction, BoardImage, BoardSnapshot, BoardWindowOptions, BoardBackdrop } from '../../shared/whiteboard/types';
import { WhiteboardStateReader } from '../services/whiteboard-state-reader';
import { useWhiteboardViewReady } from './useWhiteboardViewReady';

export function useWhiteboard() {
  const [state, setState] = useState<Omit<BoardSnapshot, 'events'>>();
  const [scene, setScene] = useState(emptyBoard);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const session = useRef('');
  useEffect(() => {
    const api = window.whiteboard;
    if (!api) return;
    let active = true;
    const reader = new WhiteboardStateReader(() => api.snapshot());
    const refresh = async () => {
      try {
        const result = await reader.read();
        if (!active || !result) return;
        const { snapshot } = result;
        session.current = snapshot.session; setState(result.state); setError(undefined);
        setScene({ ...snapshot.events.reduce(applyBoardEvent, emptyBoard()), reveals: undefined }); setReady(true);
      } catch (cause) { if (active) setError(String(cause)); }
    };
    const unsubscribe = api.onState(next => {
      if (!active) return;
      reader.observe(next);
      setState(next);
      if (next.session !== session.current) { setReady(false); setScene(emptyBoard()); void refresh(); }
    });
    void refresh();
    return () => { active = false; reader.dispose(); unsubscribe(); };
  }, []);
  useWhiteboardViewReady(ready, state);
  const act = useCallback((action: BoardAction) => {
    if (!window.whiteboard || !ready || !state?.available || !state.visible || state.sceneBusy || error) return;
    const event = { t: performance.now() / 1000, action };
    const owner = session.current;
    setScene(previous => applyBoardEvent(previous, event));
    void window.whiteboard.act(owner, action).catch(cause => {
      if (session.current === owner) setError(`白板保存失败：${String(cause)}`);
    });
  }, [ready, state?.available, state?.visible, state?.sceneBusy, error]);
  const setVisible = useCallback(async (visible: boolean) => {
    try { await window.whiteboard?.setVisible(visible); setError(undefined); }
    catch (cause) { setError(String(cause)); }
  }, []);
  const chooseMode = useCallback(async () => {
    try {
      const api = window.whiteboard;
      if (api?.chooseMode) await api.chooseMode(); else await api?.setVisible(true);
      setError(undefined);
    } catch (cause) { setError(String(cause)); }
  }, []);
  const setMaximized = useCallback(async (value: boolean) => {
    try { await window.whiteboard?.setMaximized(session.current, value); }
    catch (cause) { setError(String(cause)); }
  }, []);
  const acceptImported = useCallback((image: BoardImage) => {
    setScene(previous => applyBoardAction(previous, image));
  }, []);
  const setWindowOptions = useCallback(async (value: Partial<BoardWindowOptions>) => {
    try { await window.whiteboard?.setWindowOptions(session.current, value); }
    catch (cause) { setError(String(cause)); }
  }, []);
  const setBackdrop = useCallback(async (value: BoardBackdrop, shade?: number) => {
    try { await window.whiteboard?.setBackdrop(session.current, value, shade); setError(undefined); }
    catch (cause) { setError(String(cause)); }
  }, []);
  return { state, scene, error: error ?? state?.error, ready, act, setVisible, chooseMode, setMaximized, setWindowOptions, setBackdrop, acceptImported };
}
