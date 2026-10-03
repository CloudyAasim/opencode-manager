import { useLayer } from '@/framework/layer/useLayer'
import { FileBrowserSheet } from '@/features/file-browser/FileBrowserSheet'
import { SourceControlPanel } from '@/features/source-control'
import { RepoMcpDialog } from './RepoMcpDialog'
import { RepoSkillsDialog } from './RepoSkillsDialog'
import type { SkillFileInfo } from '@opencode-manager/shared'
import type { FileInfo } from '@/types/files'

// The overlays a page sitting on one repository mounts. Three of them were
// being mounted by two pages each, with the same open/close plumbing wired by
// hand every time - which is how the file browser ended up with three subtly
// different prop sets.
//
// Layer state lives in the provider, keyed by name, so the page still opens
// these with its own useLayer calls and this component reads the same layers.
// Nothing has to be threaded through props except the context that differs
// per page: which repo, which directory, which branch.
interface RepoOverlaysProps {
  repoId: number
  opcodeUrl: string | null | undefined
  directory: string | undefined
  basePath: string | undefined
  repoName: string
  currentBranch: string
  sessionId?: string
  initialSelectedFile?: string
  onFileBrowserClosed?: () => void
  /** Set when the page wants the picked file rather than just browsing. */
  onFileSelect?: (file: FileInfo) => void
  onSkillLoaded?: (skill: SkillFileInfo) => void
}

export function RepoOverlays({
  repoId,
  opcodeUrl,
  directory,
  basePath,
  repoName,
  currentBranch,
  sessionId,
  initialSelectedFile,
  onFileBrowserClosed,
  onFileSelect,
  onSkillLoaded,
}: RepoOverlaysProps) {
  const [filesOpen, setFilesOpen] = useLayer('files')
  const [skillsOpen, setSkillsOpen] = useLayer('skills')
  const [mcpOpen, setMcpOpen] = useLayer('mcp')
  const [sourceControlOpen, setSourceControlOpen] = useLayer('sourceControl')

  return (
    <>
      <FileBrowserSheet
        isOpen={filesOpen}
        onClose={() => {
          setFilesOpen(false)
          onFileBrowserClosed?.()
        }}
        basePath={basePath}
        repoName={repoName}
        repoId={repoId}
        initialSelectedFile={initialSelectedFile}
        onFileSelect={onFileSelect}
      />
      {sessionId && opcodeUrl ? (
        <RepoSkillsDialog
          open={skillsOpen}
          onOpenChange={setSkillsOpen}
          repoId={repoId}
          sessionId={sessionId}
          opcodeUrl={opcodeUrl}
          directory={directory}
          onSkillLoaded={onSkillLoaded}
        />
      ) : (
        <RepoSkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} repoId={repoId} />
      )}
      {directory ? (
        <RepoMcpDialog open={mcpOpen} onOpenChange={setMcpOpen} directory={directory} />
      ) : null}
      <SourceControlPanel
        repoId={repoId}
        isOpen={sourceControlOpen}
        onClose={() => setSourceControlOpen(false)}
        currentBranch={currentBranch}
        repoName={repoName}
      />
    </>
  )
}
