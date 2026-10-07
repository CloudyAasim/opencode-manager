export { createProxy, InvalidTargetError, toUpstreamUrl } from './proxy.ts'
export type { Proxy, ProxyOptions } from './proxy.ts'
export {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  rewriteCsp,
  rewriteLocation,
  rewriteReferer,
  rewriteSetCookie,
  targetOrigin,
} from './proxy-headers.ts'
export { contentTypeFor, serveStaticFile } from './static-files.ts'
export { candidateTargets, detectServer } from './detect.ts'