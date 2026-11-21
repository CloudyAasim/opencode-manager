import { applyEdits, findNodeAtLocation, modify, parseTree, type JSONPath, type Node } from 'jsonc-parser'

/**
 * The names a credential hides behind.
 *
 * The agent's configuration says the keys its providers and tool servers need
 * under names that say what they are: an api key, a client secret, a token, a
 * password. A name that ends with one of those is a credential, whatever it
 * happens to be called.
 *
 * The rule is deliberately blunt, and it leans towards hiding. A name that
 * only happens to end with one of these words - `monkey`, `turkey` - is
 * hidden too, and the cost of that is a `***` where a harmless value was. The
 * cost of the other mistake is a key in the browser, and one key in the
 * browser is a key that everybody who has the browser has.
 */
const CREDENTIAL_NAME_SUFFIXES: readonly string[] = [
  'key',
  'secret',
  'token',
  'password',
  'passphrase',
  'credential',
  'credentials',
  'authorization',
]

/**
 * The word that stands where a credential was.
 *
 * It is short enough to read in a document a person is editing, and it says
 * what it is: there is something here, and it is not for you.
 */
export const CREDENTIAL_PLACEHOLDER = '***'

/**
 * A credential, and where it is.
 */
export interface CredentialSite {
  /** Where in the document it is. */
  path: JSONPath
  /** What it is. Never travels anywhere but the server. */
  value: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Does this name say that the value under it is a credential?
 */
export function isCredentialName(name: string): boolean {
  const lowered = name.toLowerCase()
  return CREDENTIAL_NAME_SUFFIXES.some((suffix) => lowered.endsWith(suffix))
}

/**
 * Every credential in a document, and where it is.
 *
 * Only strings are credentials. A number or an object under a name that says
 * "key" is not a key, and a document that says so is not one to hide.
 */
export function credentialSites(content: unknown): CredentialSite[] {
  const sites: CredentialSite[] = []

  const walk = (value: unknown, path: JSONPath): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, [...path, index]))
      return
    }
    if (!isPlainObject(value)) return
    for (const [name, entry] of Object.entries(value)) {
      const here = [...path, name]
      if (typeof entry === 'string' && isCredentialName(name)) {
        sites.push({ path: here, value: entry })
        continue
      }
      walk(entry, here)
    }
  }

  walk(content, [])
  return sites
}

/**
 * The document with every credential replaced by the word that stands for one.
 *
 * The paths are kept, so that the server can put its own values back where
 * its own values were.
 */
export function maskCredentials<T>(content: T): T {
  const sites = credentialSites(content)
  if (sites.length === 0) return content

  const masked = structuredClone(content)
  for (const site of sites) {
    setAt(masked, site.path, CREDENTIAL_PLACEHOLDER)
  }
  return masked
}

/**
 * The text with every credential replaced by the word that stands for one.
 *
 * The text is edited where it lies, so the formatting and the comments stay
 * the way the person wrote them - a document that is re-serialized to hide one
 * value is a document that comes back different.
 */
export function maskCredentialsInText(text: string, content: unknown): string {
  const sites = credentialSites(content)
  if (sites.length === 0) return text

  const tree = treeOf(text)
  if (!tree) return text

  let masked = text
  for (const site of sites) {
    // Only where the path is. `modify` is an editor and not a reader: it
    // writes a path that is not there. Masking must never put a credential
    // into a document that had none.
    if (!findNodeAtLocation(tree, site.path)) continue
    masked = replaceAt(masked, site.path, CREDENTIAL_PLACEHOLDER)
  }
  return masked
}

/**
 * What a restore did to the client's document.
 */
export interface RestoreOutcome {
  /**
   * The paths where the client tried to change a credential and the server's
   * own value went back there instead.
   *
   * They are named so that the person can be told which of their edits did
   * not happen. A credential that was left as the placeholder is not one of
   * these: the client never saw the value, so it never wrote one, and there
   * is nothing to tell anybody about.
   */
  overridden: string[]
}

/**
 * The document the client sent back, with the server's own credentials put
 * back where its own credentials were.
 *
 * The server's value wins at every credential path: this layer manages the
 * configuration, not the credentials. A client that sends a different value
 * there is not changing a key - and a key is changed where the keys are
 * changed, which is not here.
 *
 * What is being overridden is named, because an edit that quietly does not
 * happen is worse than one that is refused: the person believes they changed
 * something, and they did not.
 *
 * What the client *can* do is take the thing a credential belonged to away:
 * delete the provider, and its key goes with it. That is why the rule is
 * about the container rather than about the credential: the container is the
 * provider, and as long as the provider is there, so is its key - whether the
 * client wrote a different value or none at all.
 */
export function restoreCredentials<T>(content: T, own: unknown): { value: T; overridden: string[] } {
  const overridden: string[] = []
  if (!isPlainObject(content)) return { value: content, overridden }
  const restored = structuredClone(content)
  for (const site of credentialSites(own)) {
    if (!isPlainObject(getAt(restored, containerOf(site.path)))) continue
    const written = getAt(restored, site.path)
    // Three things can be at a credential path when the client's document
    // comes back: the placeholder it was given, a value of its own, or
    // nothing at all. The first is the client having done nothing, and there
    // is nothing to tell anybody about. The second is the client having
    // written a key, and the third is the client having removed one - and
    // both of them are edits that did not happen, because the server's own
    // value goes back there either way.
    if (written !== CREDENTIAL_PLACEHOLDER && written !== site.value) {
      overridden.push(site.path.join('.'))
    }
    setAt(restored, site.path, site.value)
  }
  return { value: restored, overridden }
}

/**
 * The text the client sent back, with the server's own credentials put back.
 *
 * The same rule as the document above: the container decides. A provider that
 * is still there gets its key back - the one the server has, not the one the
 * client wrote - and a provider that is gone takes its key with it.
 */
export function restoreCredentialsInText(
  text: string,
  own: unknown,
): { value: string; overridden: string[] } {
  const overridden: string[] = []
  const sites = credentialSites(own)
  if (sites.length === 0) return { value: text, overridden }

  const tree = treeOf(text)
  if (!tree) return { value: text, overridden }

  let restored = text
  for (const site of sites) {
    const container = findNodeAtLocation(tree, containerOf(site.path))
    if (!container || container.type !== 'object') continue
    const node = findNodeAtLocation(tree, site.path)
    const written = typeof node?.value === 'string' ? node.value : undefined
    // The same three things as above: the placeholder, a value of the
    // client's own, or nothing at all where the client removed the line.
    if (written !== CREDENTIAL_PLACEHOLDER && written !== site.value) {
      overridden.push(site.path.join('.'))
    }
    restored = replaceAt(restored, site.path, site.value)
  }
  return { value: restored, overridden }
}

/**
 * The thing a credential belongs to.
 *
 * A credential at `provider.acme.options.apiKey` belongs to
 * `provider.acme.options` - and a credential at the top of the document
 * belongs to the document.
 */
function containerOf(path: JSONPath): JSONPath {
  return path.slice(0, -1)
}

function getAt(document: unknown, path: JSONPath): unknown {
  let current: unknown = document
  for (const step of path) {
    if (Array.isArray(current) && typeof step === 'number') {
      current = current[step]
      continue
    }
    if (!isPlainObject(current)) return undefined
    current = current[String(step)]
  }
  return current
}

function setAt(document: unknown, path: JSONPath, value: unknown): void {
  if (path.length === 0) return
  let current: unknown = document
  for (const step of path.slice(0, -1)) {
    if (Array.isArray(current) && typeof step === 'number') {
      current = current[step]
      continue
    }
    if (!isPlainObject(current)) return
    current = current[String(step)]
  }
  const last = path[path.length - 1]!
  if (Array.isArray(current) && typeof last === 'number') {
    current[last] = value
    return
  }
  if (isPlainObject(current)) {
    current[String(last)] = value
  }
}

/**
 * Put a value at a path in the text.
 *
 * The path is edited where it lies, so the formatting and the comments stay
 * the way the person wrote them. A path that is not there is written: that is
 * what an editor does, and the caller has already decided that the thing the
 * value belongs to is still there.
 */
function replaceAt(text: string, path: JSONPath, value: string): string {
  try {
    const edits = modify(text, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    if (edits.length === 0) return text
    return applyEdits(text, edits)
  } catch {
    return text
  }
}

/**
 * The text as a tree, or nothing when the text is not a document at all.
 *
 * A text that cannot be parsed is a text somebody is in the middle of typing,
 * and the answer for that is "leave it alone" rather than "guess".
 */
function treeOf(text: string): Node | undefined {
  try {
    return parseTree(text) ?? undefined
  } catch {
    return undefined
  }
}
