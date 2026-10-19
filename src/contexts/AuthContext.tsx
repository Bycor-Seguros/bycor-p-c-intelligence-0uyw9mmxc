import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import pb from '@/lib/pocketbase/client'
import type { RecordModel } from 'pocketbase'

export interface UserProfile extends RecordModel {
  email: string
  name?: string
  role?: 'analista' | 'corretor' | 'admin' | string
  avatar?: string
}

interface AuthContextType {
  user: UserProfile | null
  token: string | null
  isLoading: boolean
  login: (email: string, pass: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => {
    return (pb.authStore.record as UserProfile) || null
  })
  const [token, setToken] = useState<string | null>(() => pb.authStore.token)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const unsub = pb.authStore.onChange((newToken, record) => {
      setToken(newToken)
      setUser((record as UserProfile) || null)
    })

    // Check if token is valid on start
    if (pb.authStore.isValid) {
      pb.collection('users')
        .authRefresh()
        .then(() => {
          setUser((pb.authStore.record as UserProfile) || null)
          setToken(pb.authStore.token)
        })
        .catch(() => {
          pb.authStore.clear()
          setUser(null)
          setToken(null)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      setIsLoading(false)
    }

    return () => {
      unsub()
    }
  }, [])

  const login = async (email: string, pass: string) => {
    const authData = await pb.collection('users').authWithPassword(email, pass)
    setUser((authData.record as UserProfile) || null)
    setToken(authData.token)
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
    setToken(null)
  }

  const refreshUser = async () => {
    if (pb.authStore.isValid) {
      try {
        const refreshed = await pb.collection('users').authRefresh()
        setUser((refreshed.record as UserProfile) || null)
      } catch {
        // ignore
      }
    }
  }

  const value = useMemo(
    () => ({ user, token, isLoading, login, logout, refreshUser }),
    [user, token, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}
