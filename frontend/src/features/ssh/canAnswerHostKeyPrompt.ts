/**
 * Whether this account may be offered the SSH host-key prompt.
 *
 * Accepting a key writes it into `known_hosts` under the config directory, and
 * every git operation on the host then trusts it - including the ones belonging
 * to accounts that were never asked. So it is a server-wide trust decision and
 * the route is admin-only.
 *
 * The prompt itself is broadcast to every connected client, so without this
 * check an ordinary account is shown a dialog whose only two buttons both
 * answer 403.
 */
export function canAnswerHostKeyPrompt(user: { role?: string } | null | undefined): boolean {
  return user?.role === 'admin'
}
