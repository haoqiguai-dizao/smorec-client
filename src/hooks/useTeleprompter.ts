import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveRecordingState } from '../../shared/types';
import { normalizeTeleprompterPreferences, readTeleprompterPreferences, saveTeleprompterPreferences,
  type TeleprompterPreferences } from '../services/teleprompter-preferences';

export function useTeleprompter(state?: LiveRecordingState) {
  const [preferences, setPreferences] = useState(readTeleprompterPreferences);
  const latestPreferences = useRef(preferences);
  const viewport = useRef<HTMLDivElement>(null), position = useRef(0), startPosition = useRef(0), appliedPosition = useRef(0);
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false), [playing, setPlaying] = useState(false);
  const status = state?.status, countdown = state?.countdown;
  const recording = status === 'recording', waiting = countdown !== undefined || status === 'starting';
  const preparing = !!state?.cameraPreviewing && !['starting', 'recording', 'stopping'].includes(status ?? '');
  const canEdit = preparing && !waiting;
  const active = state?.cameraMode === 'presenter' && !!state.cameraAvailable && !!state.cameraVisible && !state.cameraPanel
    && (preparing || waiting || recording);
  const visible = active && open, hasText = !!preferences.text.trim();
  const previous = useRef<{ status?: LiveRecordingState['status']; startedAt?: number; waiting: boolean }>({ waiting: false });
  const writePosition = useCallback((next: number) => {
    position.current = next;
    if (viewport.current) {
      viewport.current.scrollTop = next;
      appliedPosition.current = viewport.current.scrollTop;
    }
  }, []);
  const update = (patch: Partial<TeleprompterPreferences>) => {
    const next = normalizeTeleprompterPreferences({ ...latestPreferences.current, ...patch,
      ...(!canEdit ? { text: latestPreferences.current.text } : {}) });
    latestPreferences.current = next; setPreferences(next); saveTeleprompterPreferences(next);
  };
  useEffect(() => {
    const before = previous.current;
    previous.current = { status, startedAt: state?.startedAtUnixMs, waiting };
    const started = recording && (before.status !== 'recording' || before.startedAt !== state?.startedAtUnixMs);
    if (waiting && !before.waiting || started) {
      writePosition(startPosition.current); setEditing(false);
    }
    if (started) setPlaying(visible && hasText);
    else if (!visible || waiting || editing) setPlaying(false);
  }, [status, state?.startedAtUnixMs, waiting, recording, visible, hasText, editing, writePosition]);
  useEffect(() => {
    if (visible && !(canEdit && editing)) writePosition(position.current);
  }, [visible, canEdit, editing, preferences.fontSize, writePosition]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !visible || waiting || editing || !playing || !hasText) return;
    let frame = 0, previous = performance.now(), running = true;
    const advance = (now: number) => {
      if (!running) return;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      writePosition(Math.min(maximum, position.current + preferences.speed * Math.max(0, now - previous) / 1000));
      previous = now;
      if (position.current >= maximum) { setPlaying(false); return; }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => { running = false; cancelAnimationFrame(frame); };
  }, [visible, waiting, editing, playing, hasText, preferences.speed, writePosition]);
  return { ...preferences, viewport, visible, editing: canEdit && editing, canEdit, recording, waiting, countdown, hasText,
    playing: visible && !waiting && !editing && playing, update,
    toggle: () => { setPlaying(false); if (!open && !hasText && canEdit) setEditing(true); setOpen(!open); },
    show: () => { setPlaying(false); if (!hasText && canEdit) setEditing(true); setOpen(true); },
    edit: () => { if (canEdit) { setPlaying(false); setEditing(true); } },
    finishEditing: () => { if (canEdit) { setPlaying(false); setEditing(false); startPosition.current = 0; writePosition(0); } },
    togglePlaying: () => { if (visible && !waiting && !editing && hasText) setPlaying(!playing); },
    restart: () => { setPlaying(false); if (canEdit) startPosition.current = 0; writePosition(0); },
    onScroll: () => {
      const element = viewport.current;
      // Ignore our own animation/restoration scroll events, including events delivered after pause.
      if (!element || Math.abs(element.scrollTop - appliedPosition.current) <= .5) return;
      if (waiting) { writePosition(startPosition.current); return; }
      position.current = element.scrollTop;
      if (canEdit) startPosition.current = element.scrollTop;
    },
    close: () => { setPlaying(false); setOpen(false); },
  };
}
export type TeleprompterController = ReturnType<typeof useTeleprompter>;
