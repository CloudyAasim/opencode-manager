import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { listRepos, deleteRepo, updateRepoOrder } from "@/api/repos"
import { fetchReposGitStatus } from "@/api/git"
import { DeleteDialog } from "@/components/ui/delete-dialog"
import { GitBranch, Search, GripVertical } from "lucide-react"
import type { Repo } from "@/api/types"
import type { GitStatusResponse } from "@/types/git"
import { RepoCard } from "./RepoCard"
import { RepoCardSkeleton } from "./RepoCardSkeleton"
import { useMobile } from "@/hooks/useMobile"
import { useSettings } from "@/hooks/useSettings"
import {
  buildRepoViewModels,
  filterReposBySearch,
  filterReposByMode,
  sortRepos,
  countAttentionItems,
  type RepoFilterMode,
  type RepoSortMode,
} from "./repo-list-state"
import { RepoListControls } from "./RepoListControls"
import { invalidateRepoListCaches, stopQueries } from "@/lib/queryInvalidation"
import { ASSISTANT_REPO_ID } from "@opencode-manager/shared/utils"
import { useI18n } from '@/lib/i18n'

interface RepoCardWrapperProps {
  repo: Repo
  onDelete: (id: number) => void
  isDeleting: boolean
  isSelected: boolean
  onSelect: (id: number, selected: boolean) => void
  gitStatus?: GitStatusResponse
  manageMode: boolean
  isMobile: boolean
  activityLabel?: string
  hasSelectedRepos?: boolean
  selectionMode?: boolean
}

function SortableRepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected,
  onSelect,
  gitStatus,
  manageMode,
  isMobile,
  activityLabel,
  hasSelectedRepos,
  selectionMode,
  isManualSort,
}: RepoCardWrapperProps & { isManualSort: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: repo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="relative">
        {isManualSort && (
          <div
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-accent/80"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className={isManualSort ? 'pl-8' : ''}>
          <RepoCard
            repo={repo}
            onDelete={onDelete}
            isDeleting={isDeleting}
            isSelected={isSelected}
            onSelect={onSelect}
            gitStatus={gitStatus}
            manageMode={manageMode}
            isMobile={isMobile}
            activityLabel={activityLabel}
            hasSelectedRepos={hasSelectedRepos}
            selectionMode={selectionMode}
          />
        </div>
      </div>
    </div>
  )
}

function StaticRepoCard({
  repo,
  onDelete,
  isDeleting,
  isSelected,
  onSelect,
  gitStatus,
  manageMode,
  isMobile,
  activityLabel,
  hasSelectedRepos,
  selectionMode,
}: RepoCardWrapperProps) {
  return (
    <RepoCard
      repo={repo}
      onDelete={onDelete}
      isDeleting={isDeleting}
      isSelected={isSelected}
      onSelect={onSelect}
      gitStatus={gitStatus}
      manageMode={manageMode}
      isMobile={isMobile}
      activityLabel={activityLabel}
      hasSelectedRepos={hasSelectedRepos}
      selectionMode={selectionMode}
    />
  )
}

export function RepoList() {
  const { t } = useI18n()
  const formatActivityLabel = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return t('repo.list.activity.daysAgo', { n: days })
    }
    if (hours > 0) {
      return t('repo.list.activity.hoursAgo', { n: hours })
    }
    if (minutes > 0) {
      return t('repo.list.activity.minutesAgo', { n: minutes })
    }
    return t('repo.list.activity.justNow')
  }
  const queryClient = useQueryClient()
  const isMobile = useMobile()
  const { preferences, updateSettings } = useSettings()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [repoToDelete, setRepoToDelete] = useState<number | null>(null)
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterMode, setFilterMode] = useState<RepoFilterMode>('recent')
  const isSelectionActive = selectionMode || selectedRepos.size > 0

  const sortMode = (preferences?.repoSortMode as RepoSortMode) || 'recent'
  const repoOrder = preferences?.repoOrder

  const handleSortModeChange = (newSortMode: RepoSortMode) => {
    updateSettings({ repoSortMode: newSortMode })
  }

  const isManualSort = sortMode === 'manual'
  const isDragEnabled = !isMobile || (isManualSort && selectedRepos.size === 0)

  const {
    data: repos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repos"],
    queryFn: listRepos,
  })

  const regularRepos = useMemo(
    () => repos?.filter((r) => r.id !== ASSISTANT_REPO_ID) ?? null,
    [repos],
  )

  const repoForDelete = useMemo(() => {
    return repoToDelete ? repos?.find(r => r.id === repoToDelete) : null
  }, [repoToDelete, repos])

  const { hasLocalRepos, hasClonedRepos } = useMemo(() => {
    if (!repos) return { hasLocalRepos: false, hasClonedRepos: false }
    const selectedRepoObjects = repos.filter(r => selectedRepos.has(r.id))
    return {
      hasLocalRepos: selectedRepoObjects.some(r => r.isLocal),
      hasClonedRepos: selectedRepoObjects.some(r => !r.isLocal),
    }
  }, [selectedRepos, repos])

  const repoIds = regularRepos?.map((repo) => repo.id) || []

  const { data: gitStatuses } = useQuery({
    queryKey: ["reposGitStatus", repoIds],
    queryFn: () => fetchReposGitStatus(repoIds),
    enabled: repoIds.length > 0,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  const viewModels = useMemo(() => {
    if (!regularRepos) return []
    return buildRepoViewModels(regularRepos, gitStatuses)
  }, [regularRepos, gitStatuses])

  const filteredViewModels = useMemo(() => {
    const searched = filterReposBySearch(viewModels, searchQuery)
    return filterReposByMode(searched, filterMode)
  }, [viewModels, searchQuery, filterMode])

  const sortedViewModels = useMemo(() => {
    return sortRepos(filteredViewModels, sortMode, repoOrder)
  }, [filteredViewModels, sortMode, repoOrder])

  const emptyMessage = useMemo(() => {
    if (searchQuery) {
      return t('repo.list.emptyFilteredQuery', { query: searchQuery })
    }
    if (filterMode === 'attention') {
      return t('repo.list.emptyAttention')
    }
    if (filterMode === 'recent') {
      return t('repo.list.emptyRecent')
    }
    return t('repo.list.emptyFiltered')
  }, [searchQuery, filterMode, t])

  const attentionCount = useMemo(() => {
    return countAttentionItems(viewModels)
  }, [viewModels])

  const deleteMutation = useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => {
      invalidateRepoListCaches(queryClient)
      setDeleteDialogOpen(false)
      setRepoToDelete(null)
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: async (repoIds: number[]) => {
      await Promise.all(repoIds.map((id) => deleteRepo(id)))
    },
    onSuccess: () => {
      invalidateRepoListCaches(queryClient)
      setDeleteDialogOpen(false)
      setSelectedRepos(new Set())
      setSelectionMode(false)
    },
  })

  const updateOrderMutation = useMutation({
    mutationFn: updateRepoOrder,
    onMutate: async (newOrder) => {
      await stopQueries(queryClient, { queryKey: ["repos"] })

      const previousRepos = queryClient.getQueryData<Repo[]>(["repos"])

      queryClient.setQueryData<Repo[]>(["repos"], (old) => {
        if (!old) return old
        const repoMap = new Map(old.map((repo) => [repo.id, repo]))
        const reorderedRepos = newOrder.map((id) => repoMap.get(id)).filter((repo): repo is Repo => repo !== undefined)
        const newRepos = old.filter((repo) => !newOrder.includes(repo.id))
        return [...reorderedRepos, ...newRepos]
      })

      return { previousRepos }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["repos"], context?.previousRepos)
    },
    onSettled: () => {
      invalidateRepoListCaches(queryClient)
    },
  })

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!repos || !over) return

    if (active.id !== over.id) {
      const oldIndex = repos.findIndex((repo) => repo.id === Number(active.id))
      const newIndex = repos.findIndex((repo) => repo.id === Number(over.id))

      if (oldIndex === -1 || newIndex === -1) return

      const newOrder = arrayMove(repos, oldIndex, newIndex).map((repo) => repo.id)
      updateOrderMutation.mutate(newOrder)
    }

  }

  const renderContent = () => {
    switch (true) {
      case isLoading && !repos:
        return (
          <div className="px-0 md:p-4 h-full flex flex-col">
            <div className="px-2 md:px-0">
              <div className="h-10 bg-muted/50 animate-pulse rounded w-full" />
            </div>
            <div className="mx-2 md:mx-0 flex-1 min-h-0">
              <div className="h-full overflow-y-auto pt-4 pb-2 md:pb-0">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="md:pl-8">
                      <RepoCardSkeleton />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )

      case !!error:
        return (
          <div className="text-center p-8 text-destructive">
            {t('repo.list.failedToLoad')}{" "}
            {error instanceof Error ? error.message : t('repo.list.unknownError')}
          </div>
        )

      case !repos || repos.length === 0:
        return (
          <div className="text-center p-12">
            <GitBranch className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
            <p className="text-zinc-500">
              {t('repo.list.empty')}
            </p>
          </div>
        )

      default:
        return null
    }
  }

  const content = renderContent()
  if (content) return content

  const handleSelectRepo = (id: number, selected: boolean) => {
    const newSelected = new Set(selectedRepos)
    if (selected) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedRepos(newSelected)
  }

  const handleSelectAll = () => {
    const visibleIds = sortedViewModels.map(r => r.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedRepos.has(id))
    
    if (allVisibleSelected) {
      const newSelected = new Set(selectedRepos)
      visibleIds.forEach(id => newSelected.delete(id))
      setSelectedRepos(newSelected)
    } else {
      const newSelected = new Set(selectedRepos)
      visibleIds.forEach(id => newSelected.add(id))
      setSelectedRepos(newSelected)
    }
  }

  const handleSelectionModeChange = (enabled: boolean) => {
    setSelectionMode(enabled)
    if (!enabled) {
      setSelectedRepos(new Set())
    }
  }

  return (
    <>
      <div className="px-0 md:p-4 h-full flex flex-col">
        <RepoListControls
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          sortMode={sortMode}
          onSortModeChange={handleSortModeChange}
          filteredCount={sortedViewModels.length}
          attentionCount={attentionCount}
          selectedCount={selectedRepos.size}
          allVisibleSelected={sortedViewModels.length > 0 && sortedViewModels.every(r => selectedRepos.has(r.id))}
          onSelectAll={handleSelectAll}
          onClearSelection={() => {
            setSelectedRepos(new Set())
            setSelectionMode(false)
          }}
          onDelete={() => {
            setRepoToDelete(null)
            setDeleteDialogOpen(true)
          }}
          hasLocalRepos={hasLocalRepos}
          hasClonedRepos={hasClonedRepos}
          selectionMode={selectionMode}
          onSelectionModeChange={handleSelectionModeChange}
        />

        <div className="mx-2 md:mx-0 flex-1 min-h-0">
          <div className="h-full overflow-y-auto pt-4 md:pb-0 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            {(() => {
              switch (true) {
                case sortedViewModels.length === 0:
                  return (
                    <div className="text-center p-12">
                      <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                      <p className="text-zinc-500">
                        {emptyMessage}
                      </p>
                    </div>
                  )

                case isDragEnabled:
                  return (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext items={sortedViewModels.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full md:pb-0">
                          {sortedViewModels.map((repo) => (
                            <SortableRepoCard
                              key={repo.id}
                              repo={repo}
                              onDelete={(id) => {
                                setRepoToDelete(id)
                                setDeleteDialogOpen(true)
                              }}
                              isDeleting={
                                deleteMutation.isPending && repoToDelete === repo.id
                              }
                              isSelected={selectedRepos.has(repo.id)}
                              onSelect={handleSelectRepo}
                              gitStatus={gitStatuses?.get(repo.id)}
                              manageMode={isSelectionActive}
                              isMobile={isMobile}
                              isManualSort={isManualSort}
                              activityLabel={formatActivityLabel(repo.activityTimestamp)}
                              hasSelectedRepos={selectedRepos.size > 0}
                              selectionMode={selectionMode}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )

                default:
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4 w-full md:pb-0">
                      {sortedViewModels.map((repo) => (
                        <StaticRepoCard
                          key={repo.id}
                          repo={repo}
                          onDelete={(id) => {
                            setRepoToDelete(id)
                            setDeleteDialogOpen(true)
                          }}
                          isDeleting={
                            deleteMutation.isPending && repoToDelete === repo.id
                          }
                          isSelected={selectedRepos.has(repo.id)}
                          onSelect={handleSelectRepo}
                          gitStatus={gitStatuses?.get(repo.id)}
                          manageMode={isSelectionActive}
                          isMobile={isMobile}
                          activityLabel={formatActivityLabel(repo.activityTimestamp)}
                          hasSelectedRepos={selectedRepos.size > 0}
                          selectionMode={selectionMode}
                        />
                      ))}
                    </div>
                  )
              }
            })()}
          </div>
        </div>
      </div>

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => {
          if (selectedRepos.size > 0) {
            batchDeleteMutation.mutate(Array.from(selectedRepos))
          } else if (repoToDelete) {
            deleteMutation.mutate(repoToDelete)
          }
        }}
        onCancel={() => {
          setDeleteDialogOpen(false)
          setRepoToDelete(null)
          if (selectedRepos.size > 0) {
            setSelectedRepos(new Set())
            setSelectionMode(false)
          }
        }}
        title={
          selectedRepos.size > 0
            ? hasLocalRepos && !hasClonedRepos
              ? t("repo.deleteDialog.unlinkMultiple")
              : t("repo.deleteDialog.deleteMultiple")
            : repoForDelete
              ? repoForDelete.isLocal
                ? t("repo.actions.unlinkRepository")
                : t("repo.actions.deleteRepository")
              : t("repo.actions.deleteRepository")
        }
        description={
          selectedRepos.size > 0
            ? hasClonedRepos && !hasLocalRepos
              ? t("repo.deleteDialog.deleteMultipleDescription", { count: selectedRepos.size })
              : hasLocalRepos && !hasClonedRepos
                ? t("repo.deleteDialog.unlinkMultipleDescription", { count: selectedRepos.size })
                : t("repo.deleteDialog.deleteMixedDescription", { count: selectedRepos.size })
            : repoForDelete?.isLocal
              ? (
                <>
                  {t("repo.deleteDialog.unlinkDescription")}
                  {repoForDelete.sourcePath && (
                    <>
                      {" "}{t("repo.deleteDialog.unlinkDescriptionPathPrefix")}{" "}
                      <span className="font-mono text-xs">{repoForDelete.sourcePath}</span>{" "}
                      {t("repo.deleteDialog.unlinkDescriptionPathSuffix")}
                    </>
                  )}
                </>
              )
              : t("repo.deleteDialog.deleteDescription")
        }
        isDeleting={deleteMutation.isPending || batchDeleteMutation.isPending}
      />
    </>
  )
}
