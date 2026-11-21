import { useMemo } from 'react'
import { useModelSelection } from './useModelSelection'
import { useModelStore } from '@/stores/modelStore'
import { findSelectedModel, getProviders, providersQueryKey } from '@/api/providers'

import { useQuery } from '@tanstack/react-query'

export interface UseVariantsResult {
  availableVariants: string[]
  currentVariant: string | undefined
  setVariant: (variant: string | undefined) => void
  cycleVariant: () => void
  clearVariant: () => void
  hasVariants: boolean
}

export function useVariants(
  serverUrl: string | null | undefined,
  directory?: string
): UseVariantsResult {
  const { model } = useModelSelection(serverUrl, directory)
  const { setVariant: setStoreVariant, clearVariant: clearStoreVariant } = useModelStore()

   const { data: providersData, isLoading } = useQuery({
     queryKey: providersQueryKey(directory),
     queryFn: () => getProviders(directory),
     enabled: serverUrl !== undefined && serverUrl !== null,
     staleTime: 30000,
   })

   const currentModel = useMemo(() => {
     if (!model || isLoading || !providersData?.providers || providersData.providers.length === 0) return null
     const selected = findSelectedModel(providersData.providers, model.providerID, model.modelID)
     return selected?.model ?? null
   }, [model, providersData, isLoading])

  const availableVariants = useMemo(() => {
    if (!currentModel?.variants) return []
    return Object.keys(currentModel.variants)
  }, [currentModel])

  const currentVariant = useModelStore((state) =>
    model ? state.variants[`${model.providerID}/${model.modelID}`] : undefined
  )

  const setVariant = useMemo(
    () => (variant: string | undefined) => {
      if (!model) return
      setStoreVariant(model, variant)
    },
    [model, setStoreVariant],
  )

  const cycleVariant = useMemo(() => {
    return () => {
      if (!model || availableVariants.length === 0) return

      if (!currentVariant) {
        setStoreVariant(model, availableVariants[0])
      } else {
        const currentIndex = availableVariants.indexOf(currentVariant)
        if (currentIndex === availableVariants.length - 1) {
          clearStoreVariant(model)
        } else {
          setStoreVariant(model, availableVariants[currentIndex + 1])
        }
      }
    }
  }, [model, availableVariants, currentVariant, setStoreVariant, clearStoreVariant])

  const clearVariant = useMemo(
    () => () => {
      if (!model) return
      clearStoreVariant(model)
    },
    [model, clearStoreVariant],
  )

  return {
    availableVariants,
    currentVariant,
    setVariant,
    cycleVariant,
    clearVariant,
    hasVariants: availableVariants.length > 0,
  }
}
