/**
 * The name to offer a download under, and the header that carries it.
 *
 * Two different things have to be right here, and they are usually confused
 * with each other:
 *
 * - The name has to be the *last segment* of the path. The separator is not
 *   always a slash - on Windows it is a backslash - so splitting on '/'
 *   alone leaves the whole path in the name, and the client is offered
 *   something like `C:\Users\me\notes.zip`.
 * - The name has to be safe to put in a header. It comes from a path, and a
 *   path can hold a quote, a newline, or any other control character. A
 *   quote ends the name early and leaves the rest of it in the header; a
 *   newline is rejected outright, which fails the whole response instead of
 *   the download.
 */
export function downloadFileName(rawPath: string, fallback = 'download'): string {
  const last = rawPath.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const cleaned = last.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim()
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * A `Content-Disposition` that carries the name safely.
 *
 * RFC 6266 has two forms: the quoted one is for ASCII, and the extended one
 * (`filename*`) carries the real name. Both are sent - a client that reads
 * only the first still gets a usable name, and the second is percent
 * encoded, which is what keeps a quote from ending the name early. The
 * extended form is also what makes a name in a non-ASCII script survive.
 */
export function contentDispositionAttachment(fileName: string): string {
  const ascii = fileName.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeExtValue(fileName)}`
}

/**
 * Percent-encode a value for the extended form of `Content-Disposition`.
 *
 * `encodeURIComponent` is not enough: it leaves `'`, `*`, `(` and `)` alone,
 * and the character set that form allows excludes all four - `'` above all,
 * because it is the delimiter that ends the parameter.
 */
function encodeExtValue(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const char = String.fromCharCode(byte)
      return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char)
        ? char
        : '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    })
    .join('')
}
