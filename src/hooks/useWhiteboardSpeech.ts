import { useEffect, useRef, useState } from 'react';
import type { BoardScene } from '../../shared/whiteboard/model';
import type { BoardAction, BoardPoint, BoardShape, BoardSpeechModelState } from '../../shared/whiteboard/types';
import { missingSpeechModel } from '../services/whiteboard-speech-state';
import { placedRectangle } from './whiteboard-gestures';

export type SpeechPhase = 'idle' | 'needs-model' | 'installing' | 'preparing' | 'recording' | 'recognizing' | 'error';
interface Target { point: BoardPoint; shapeId?: string; shape: BoardShape['shape']; color: string; size: number;
  begin: Promise<string>; session: string; cancelled: boolean;
  started?: boolean; ended?: boolean;
  focusTimer?: ReturnType<typeof setInterval> }
interface Options {
  session?: string; enabled: boolean; selected: boolean; scene: BoardScene;
  model?: BoardSpeechModelState;
  color: string; size: number; shape: BoardShape['shape']; act: (action: BoardAction) => void; select: (id: string) => void;
}

export function useWhiteboardSpeech(options: Options) {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [clipId, setClipId] = useState<string>();
  const [error, setError] = useState<string>();
  const active = useRef<Target | undefined>(undefined);
  const installing = useRef(false);
  const current = useRef(options); current.current = options;
  useEffect(() => {
    if (!options.selected || !options.enabled || !options.session) return;
    const api = window.whiteboard;
    if (!api) return;
    if (options.model?.phase === 'downloading') { setPhase('installing'); return; }
    if (options.model?.phase === 'error') { setError(options.model.error); setPhase('needs-model'); return; }
    let valid = true;
    void api.speechReady(options.session).then(ready => {
      if (valid && !active.current && !installing.current) setPhase(ready ? 'idle' : 'needs-model');
    }).catch(cause => { if (valid) { setError(String(cause)); setPhase('error'); } });
    return () => { valid = false; };
  }, [options.session, options.selected, options.enabled, options.model?.phase, options.model?.error]);
  useEffect(() => {
    if (options.enabled && options.selected) return;
    const target = active.current; active.current = undefined;
    if (target) {
      target.cancelled = true;
      clearInterval(target.focusTimer);
      void window.whiteboard?.speechCancel(target.session).catch(() => {});
    }
    setPhase('idle');
  }, [options.enabled, options.selected]);
  useEffect(() => () => {
    const target = active.current; active.current = undefined;
    if (!target) return;
    target.cancelled = true;
    clearInterval(target.focusTimer);
    void window.whiteboard?.speechCancel(target.session).catch(() => {});
  }, []);
  const install = async () => {
    const session = current.current.session;
    const api = window.whiteboard;
    if (!session || !current.current.enabled || !api) return;
    if (installing.current) return;
    installing.current = true; setPhase('installing'); setError(undefined);
    try { await api.speechInstall(session);
      if (current.current.session === session && current.current.selected && current.current.enabled) setPhase('idle'); }
    catch (cause) { if (current.current.session === session) { setError(String(cause)); setPhase('needs-model'); } }
    finally { installing.current = false; }
  };
  const start = (point: BoardPoint, shape?: BoardShape) => {
    const { session, enabled, shape: shapeKind, color, size } = current.current;
    const api = window.whiteboard;
    if (!session || !enabled || !api || active.current || phase === 'installing') return;
    const focus = shape ? { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 } : point;
    const target: Target = { point: focus, shapeId: shape?.id, shape: shapeKind, color, size, session, cancelled: false,
      begin: api.speechStart(session) };
    active.current = target; setClipId(undefined); setPhase('preparing'); setError(undefined);
    current.current.act({ kind: 'focus', point: focus });
    target.focusTimer = setInterval(() => current.current.act({ kind: 'focus', point: focus }), 1200);
    void target.begin.then(id => {
      if (active.current !== target || target.cancelled) return;
      target.started = true; setClipId(id);
      if (!target.ended) {
        setPhase('recording');
      }
    })
      .catch(cause => {
        if (active.current === target) {
          clearInterval(target.focusTimer);
          active.current = undefined;
          setError(String(cause)); setPhase(missingSpeechModel(cause) ? 'needs-model' : 'error');
        }
      });
  };
  const end = async () => {
    const target = active.current;
    const api = window.whiteboard;
    if (!target || !api) return;
    target.ended = true;
    if (!target.cancelled) current.current.act({ kind: 'focus', point: target.point });
    try {
      const id = await target.begin;
      if (target.cancelled || active.current !== target) return;
      setPhase('recognizing');
      const value = await api.speechStop(target.session, id);
      const { scene, enabled, session, act, select } = current.current;
      if (!enabled || session !== target.session || active.current !== target) return;
      if (target.shapeId) {
        const shape = scene.items.find(item => item.kind === 'shape' && item.id === target.shapeId);
        if (!shape || shape.kind !== 'shape') throw new Error('原来的节点已被删除，请重新说话');
        act({ kind: 'replace', gesture: crypto.randomUUID(), element: { ...shape, text: value }, reveal: 'text' });
      } else {
        const shape = { ...placedRectangle(crypto.randomUUID(), target.point, target.color, target.size), shape: target.shape, text: value };
        act({ kind: 'reveal', element: shape }); select(shape.id);
      }
      setPhase('idle'); setError(undefined);
    } catch (cause) {
      if (active.current === target) {
        setError(String(cause)); setPhase(missingSpeechModel(cause) ? 'needs-model' : 'error');
      }
    } finally {
      clearInterval(target.focusTimer);
      if (active.current === target) active.current = undefined;
    }
  };
  const cancel = () => {
    const target = active.current; active.current = undefined;
    if (!target) return;
    clearInterval(target.focusTimer);
    target.cancelled = true; setPhase('idle');
    void window.whiteboard?.speechCancel(target.session).catch(() => {});
  };
  return { phase, clipId, session: options.session, error, install, start, end, cancel };
}
