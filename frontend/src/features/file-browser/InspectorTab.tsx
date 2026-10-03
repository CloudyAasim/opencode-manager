import { lazy, Suspense } from 'react'
import { FileCode2 } from 'lucide-react'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'

// This one pulls in react-markdown with remark, rehype and highlight.js.
const FileBrowserView = lazy(() =>
  import('@/features/file-browser/FileBrowserView').then((m) => ({ default: m.FileBrowserView })),
)

const TAB: InspectorTabDefinition = {
  id: 'files',
  labelKey: 'navigation.files',
  icon: FileCode2,
  render: () => (
    <Suspense fallback={null}>
      <FileBrowserView embedded showPath={false} showHeader={false} />
    </Suspense>
  ),
}

export function FileBrowserInspectorTab() {
  useRegisterInspectorTab(TAB)
  return null
}
