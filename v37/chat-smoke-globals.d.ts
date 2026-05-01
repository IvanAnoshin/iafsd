declare module 'react' {
  export function useState(initial?: any): any;
  export function useEffect(effect?: any, deps?: any): any;
  export function useMemo(factory?: any, deps?: any): any;
  export function useRef(initial?: any): any;
  export function useCallback(fn?: any, deps?: any): any;
  export function useReducer(reducer?: any, initialArg?: any, init?: any): any;
  export function useLayoutEffect(effect?: any, deps?: any): any;
}
declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}
declare module 'next/link' { const Link: any; export default Link; }
declare module 'next/navigation' {
  export function useRouter(): any;
  export function usePathname(): any;
  export function useSearchParams(): any;
}
declare module '@prisma/client' { export const PrismaClient: any; }
declare module '@prisma/adapter-pg' { export const PrismaPg: any; }
declare module 'pg' { export class Pool { constructor(...args:any[]) } }
declare module 'bcryptjs' { const x:any; export default x; }
declare module 'next/headers' { export function cookies(): any; export function headers(): any; }
declare module 'node:crypto' { const x:any; export = x; }
declare module 'node:fs/promises' { export const mkdir:any; export const writeFile:any; export const unlink:any; }
declare module 'node:path' { const x:any; export = x; }
declare var process: any;
declare var Buffer: any;
declare namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }

interface Error { status?: any; }

interface Window {
  webkitAudioContext?: any;
  __chatVoiceWaveCache?: Map<string, any>;
  __chatActiveVoiceAudio?: HTMLAudioElement | null;
  __chatActiveVideoNoteVideo?: HTMLVideoElement | null;
}
