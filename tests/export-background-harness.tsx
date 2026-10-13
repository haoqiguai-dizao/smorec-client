import { useCallback, useState } from 'react';
import { useExport } from '../src/hooks/useExport';
import { ExportDialog } from '../src/components/ExportDialog';
import type { Project } from '../shared/types';
import '../src/styles/index.css';

export function ExportBackground({ project }: { project: Project }) {
  const [error, setError] = useState('');
  const report = useCallback((message: string) => setError(message), []);
  const exporting = useExport(report);
  return <><button id="export-video-action" onClick={() => void exporting.start(project)}>导出视频</button>
    {exporting.progress && <ExportDialog state={exporting.progress} onCancel={exporting.cancel} />}
    <output data-export-path={exporting.exportPath ?? ''} data-export-error={error} />
  </>;
}
