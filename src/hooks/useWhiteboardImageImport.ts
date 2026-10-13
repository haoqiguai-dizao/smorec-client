import { useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { type BoardImage, type BoardPoint, type BoardView } from '../../shared/whiteboard/types';
import { boardViewport } from '../services/whiteboard-renderer';
import { boardCoordinate, DEFAULT_BOARD_VIEW } from '../../shared/whiteboard/viewport';
import { whiteboardImageBytes } from '../services/whiteboard-import';

interface Options {
  session?: string; enabled: boolean; canvas: RefObject<HTMLCanvasElement | null>; view?: BoardView;
  accept: (image: BoardImage) => void; select: (id: string) => void;
}

export function useWhiteboardImageImport({ session, enabled, canvas, view: camera, accept, select }: Options) {
  const current = useRef(session); current.current = session;
  const [activity, setActivity] = useState<{ session?: string; error?: string; busy: boolean }>({ busy: false });
  const error = activity.session === session ? activity.error : undefined;
  const busy = activity.session === session && activity.busy;
  const setError = (error: string | undefined) => { if (current.current === session) setActivity(value => ({ ...value, session, error })); };
  const setBusy = (busy: boolean) => { if (current.current === session) setActivity(value => ({ ...value, session, busy })); };
  const importFile = async (file: File, point: BoardPoint) => {
    if (!enabled || !session || !window.whiteboard) return;
    setError(undefined); setBusy(true);
    try {
      const image = await window.whiteboard.importImage(session, await whiteboardImageBytes(file), point);
      if (current.current !== session) return;
      accept(image); select(image.id); canvas.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const pasteClipboard = async () => {
    if (!enabled || !session || !window.whiteboard) return;
    setError(undefined); setBusy(true);
    try {
      const image = await window.whiteboard.pasteImage(session, { x: (camera ?? DEFAULT_BOARD_VIEW).x, y: (camera ?? DEFAULT_BOARD_VIEW).y });
      if (!image) { setError('剪贴板中没有图片'); return; }
      if (current.current !== session) return;
      accept(image); select(image.id); canvas.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const pasted = (event: ClipboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || !enabled) return;
    if (window.whiteboard?.pasteImage) {
      event.preventDefault(); void pasteClipboard(); return;
    }
    const file = [...event.clipboardData.items].find(item => item.type.startsWith('image/'))?.getAsFile()
      ?? [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void importFile(file, { x: (camera ?? DEFAULT_BOARD_VIEW).x, y: (camera ?? DEFAULT_BOARD_VIEW).y });
  };
  const dropped = (event: DragEvent<HTMLElement>) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    if (!enabled || !canvas.current) return;
    const bounds = canvas.current.getBoundingClientRect(), view = boardViewport(bounds.width, bounds.height, camera);
    const point = { x: boardCoordinate((event.clientX - bounds.left - view.left) / view.scale),
      y: boardCoordinate((event.clientY - bounds.top - view.top) / view.scale) };
    void importFile(file, point);
  };
  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (enabled && [...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault();
  };
  return { pasted, pasteClipboard, dropped, dragOver, error, busy };
}
