const fixed = letter => ({ letter, type: 3, available: 1, flags: 0 });
export const driveCases = [
  { name: 'prefer-d', system: 'C:', drives: [fixed('C'), fixed('D'), fixed('E')], expected: 'D' },
  { name: 'without-d', system: 'C:', drives: [fixed('C'), fixed('E')], expected: 'E' },
  { name: 'd-read-only', system: 'C:', drives: [{ ...fixed('D'), flags: 0x80000 }, fixed('E')], expected: 'E' },
  { name: 'd-removable', system: 'C:', drives: [{ ...fixed('D'), type: 2 }, fixed('E')], expected: 'E' },
  { name: 'd-network', system: 'C:', drives: [{ ...fixed('D'), type: 4 }, fixed('E')], expected: 'E' },
  { name: 'd-offline', system: 'C:', drives: [{ ...fixed('D'), available: 0 }, fixed('E')], expected: 'E' },
  { name: 'd-optical', system: 'C:', drives: [{ ...fixed('D'), type: 5 }, fixed('E')], expected: 'E' },
  { name: 'system-only', system: 'C:', drives: [fixed('C')], expected: '' },
  { name: 'no-volumes', system: 'C:', drives: [], expected: '' },
  { name: 'windows-on-d', system: 'D:', drives: [fixed('D'), fixed('C'), fixed('E')], expected: 'C' },
  { name: 'case-insensitive-system', system: 'e:', drives: [fixed('E'), fixed('F')], expected: 'F' },
  { name: 'alphabetical-fallback', system: 'C:', drives: [fixed('G'), fixed('F'), fixed('E')], expected: 'E' },
  { name: 'no-fixed-writable-volume', system: 'C:', drives: [{ ...fixed('D'), flags: 0x80000 }, { ...fixed('E'), type: 2 }, { ...fixed('F'), type: 4 }], expected: '' },
];
