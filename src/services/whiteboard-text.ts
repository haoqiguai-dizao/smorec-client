import { boardGraphemes } from '../../shared/whiteboard/motion';

function widthUnits(value: string): number {
  return [...value].reduce((total, char) => total + (char.codePointAt(0)! > 0xff ? 1 : .56), 0);
}

function wrap(value: string, capacity: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const char of boardGraphemes(paragraph)) {
      if (line && widthUnits(line + char) > capacity) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

/** Keep recorded text unchanged; only fit its visible label inside the node. */
export function shapeLabel(value: string, width: number, height: number): { lines: string[]; size: number } {
  for (const size of [26, 24, 22, 20, 18, 16]) {
    const lines = wrap(value, Math.max(1, (width - 24) / size));
    if (lines.length <= Math.max(1, Math.floor((height - 16) / (size * 1.25)))) return { lines, size };
  }
  const size = 16, count = Math.max(1, Math.floor((height - 16) / (size * 1.25)));
  const lines = wrap(value, Math.max(1, (width - 24) / size)).slice(0, count);
  let last = lines[count - 1] ?? '';
  while (last && widthUnits(`${last}…`) > (width - 24) / size) last = last.slice(0, -1);
  lines[count - 1] = `${last}…`;
  return { lines, size };
}
