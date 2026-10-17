import { betterAuth } from 'better-auth'
import { passkey } from '@better-auth/passkey'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { isInternalSignupAllowed } from './internal-signup'
import { applyUsernameToNewUser } from './username'
import { canCreateAccount } from './access-policy'

export type AuthInstance = ReturnType<typeof createAuth>

export function createAuth(db: Database) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}

  if (ENV.AUTH.GITHUB_CLIENT_ID && ENV.AUTH.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: ENV.AUTH.GITHUB_CLIENT_ID,
      clientSecret: ENV.AUTH.GITHUB_CLIENT_SECRET,
    }
  }

  if (ENV.AUTH.GOOGLE_CLIENT_ID && ENV.AUTH.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: ENV.AUTH.GOOGLE_CLIENT_ID,
      clientSecret: ENV.AUTH.GOOGLE_CLIENT_SECRET,
    }
  }

  if (ENV.AUTH.DISCORD_CLIENT_ID && ENV.AUTH.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = {
      clientId: ENV.AUTH.DISCORD_CLIENT_ID,
      clientSecret: ENV.AUTH.DISCORD_CLIENT_SECRET,
    }
  }

  const baseURL = ENV.AUTH.TRUSTED_ORIGINS.split(',')[0]?.trim() || `http://localhost:${ENV.SERVER.PORT}`

  const auth = betterAuth({
    baseURL,
    basePath: '/api/auth',
    database: db,
    secret: ENV.AUTH.SECRET,
    trustedOrigins: ENV.AUTH.TRUSTED_ORIGINS.split(',').map((o: string) => o.trim()),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = typeof user.email === 'string' ? user.email : undefined

            // Assign the username before the row is written. `username` is
            // declared `input: false` below, so a client cannot supply one, and
            // the only place it used to be set was the one-off backfill in
            // migration 023 - which meant every account created since landed
            // with `NULL`. Everything keyed on it is per-user storage: the
            // workspace, the settings directory, the assistant workspace, the
            // model provider credentials. With a null username the first three
            // resolved to a server-global directory shared by every such user,
            // and the last one refused with a 401.
            //
            // Deriving it here rather than after the insert means the row is
            // never observable without one, and the unique index is satisfied
            // at write time.
            applyUsernameToNewUser(db, user as { email?: unknown; id?: unknown; username?: unknown })

            if (isInternalSignupAllowed()) return true
            if (canCreateAccount(email)) return true
            logger.warn('Blocked account creation: self-signup disabled', { email: email ?? 'unknown' })
            return false
          },
        },
      },
    },
    rateLimit: ENV.AUTH.RATE_LIMIT_ENABLED
      ? {
          enabled: true,
          window: 60,
          max: 100,
          storage: 'memory',
          customRules: {
            '/sign-in/email': { window: 60, max: 5 },
            '/sign-in/passkey': { window: 60, max: 10 },
            '/sign-in/social': { window: 60, max: 10 },
            '/sign-up/email': { window: 60, max: 3 },
            '/forget-password': { window: 60, max: 3 },
            '/reset-password': { window: 60, max: 5 },
          },
        }
      : { enabled: false },
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    plugins: [
      passkey({
        rpID: ENV.AUTH.PASSKEY_RP_ID,
        rpName: ENV.AUTH.PASSKEY_RP_NAME,
        origin: ENV.AUTH.PASSKEY_ORIGIN,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      }),
    ],
    session: {
      expiresIn: ENV.AUTH.SESSION_EXPIRES_IN_DAYS * 60 * 60 * 24,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
        username: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    advanced: {
      cookiePrefix: 'opencode',
      useSecureCookies: ENV.AUTH.SECURE_COOKIES,
      ipAddress: {
        ipAddressHeaders: ENV.AUTH.TRUST_PROXY
          ? ['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for']
          : [],
      },
    },
  })

  return auth
}

export type Session = {
  session: {
    id: string
    userId: string
    token: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
    ipAddress?: string | null
    userAgent?: string | null
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image?: string | null
    createdAt: Date
    updatedAt: Date
    role?: string
    username?: string | null
  }
}
