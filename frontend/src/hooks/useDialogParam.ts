import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export function useDialogParam(name: string): [boolean, (open: boolean) => void] {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const isOpen = new URLSearchParams(location.search).get('dialog') === name

  const setOpen = useCallback((open: boolean) => {
    const p = new URLSearchParams(searchRef.current)
    if (open) {
      p.set('dialog', name)
      p.delete('mobileTab')
    } else if (p.get('dialog') === name) {
      p.delete('dialog')
    }
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate, name])

  return [isOpen, setOpen]
}
