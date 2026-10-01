import { FileCode2 } from 'lucide-react'
import { FileBrowserView } from '@/features/file-browser/FileBrowserView'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'

const TAB: InspectorTabDefinition = {
  id: 'files',
  labelKey: 'navigation.files',
  icon: FileCode2,
  render: () => <FileBrowserView embedded showPath={false} showHeader={false} />,
}

export function FileBrowserInspectorTab() {
  useRegisterInspectorTab(TAB)
  return null
}
