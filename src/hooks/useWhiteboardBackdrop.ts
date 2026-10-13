import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BoardScene } from '../../shared/whiteboard/model';
import type { BoardSnapshot } from '../../shared/whiteboard/types';
import { boardSceneForBackdrop } from '../../shared/whiteboard/camera-scene';

export function useWhiteboardBackdrop(scene: BoardScene, state: Omit<BoardSnapshot, 'events'> | undefined,
  setShape: Dispatch<SetStateAction<string>>, setLine: Dispatch<SetStateAction<string>>) {
  const camera = state?.backdrop === 'camera' || !!state?.cameraTransition;
  const previous = useRef<{ shape?: string; line?: string }>({});
  const active = useRef(false);
  useEffect(() => {
    if (camera === active.current) return;
    active.current = camera;
    if (camera) {
      setShape(value => { previous.current.shape ??= value; return '#fffaf4'; });
      setLine(value => { previous.current.line ??= value; return '#ffe28a'; });
    } else {
      const saved = previous.current; previous.current = {};
      setShape(value => saved.shape ?? value);
      setLine(value => saved.line ?? value);
    }
  }, [camera, setShape, setLine]);
  return { camera, scene: useMemo(() => boardSceneForBackdrop(scene, camera), [scene, camera]) };
}
