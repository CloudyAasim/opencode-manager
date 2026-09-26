import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

export type UserRole = 'admin' | 'user'

export interface ManagedUser {
  id: string
  name: string
  email: string
  username: string | null
  role: UserRole
  emailVerified: boolean
  createdAt: number | string
  updatedAt: number | string
}

export interface CreateManagedUserInput {
  email: string
  name: string
  username?: string
  password: string
  role: UserRole
}

export const adminUsersApi = {
  list: async (): Promise<ManagedUser[]> => {
    const data = await fetchWrapper<{ users: ManagedUser[] }>(`${API_BASE_URL}/api/admin/users`)
    return data.users
  },

  create: async (input: CreateManagedUserInput): Promise<ManagedUser> => {
    const data = await fetchWrapper<{ user: ManagedUser }>(`${API_BASE_URL}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return data.user
  },

  setRole: async (id: string, role: UserRole): Promise<ManagedUser> => {
    const data = await fetchWrapper<{ user: ManagedUser }>(`${API_BASE_URL}/api/admin/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    return data.user
  },

  resetPassword: async (id: string, password: string): Promise<void> => {
    await fetchWrapperVoid(`${API_BASE_URL}/api/admin/users/${id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  },

  remove: async (id: string): Promise<void> => {
    await fetchWrapperVoid(`${API_BASE_URL}/api/admin/users/${id}`, { method: 'DELETE' })
  },
}
