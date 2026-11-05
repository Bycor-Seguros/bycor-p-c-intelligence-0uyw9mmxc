import logoBycorAssetUrl from '@/assets/logo-bycor-3c53f.jpg'

/**
 * Acesso defensivo ao `process` do Node SEM depender dos tipos de Node
 * (@types/node não está disponível no tsconfig do app — o bundle do navegador
 * não deve conhecê-los). Em runtime de Node o global `process` existe em
 * `globalThis`; no navegador/SSR simplesmente é undefined.
 */
type NodeProcessGlobal = {
  versions?: { node?: string }
  env?: Record<string, string | undefined>
  cwd?: () => string
}

function getNodeProcess(): NodeProcessGlobal | undefined {
  if (typeof globalThis === 'undefined') return undefined
  const candidate = (globalThis as Record<string, unknown>).process
  if (!candidate || typeof candidate !== 'object') return undefined
  return candidate as NodeProcessGlobal
}

function isNodeRuntime(): boolean {
  const proc = getNodeProcess()
  return !!proc && !!proc.versions && !!proc.versions.node
}

/**
 * URL compilado pelo Vite para uso em browsers / tags de imagem.
 * Em Node (harness de testes golden — `npm run test:golden` via scripts/run-tests.js),
 * o Vite em modo SSR devolve o caminho de dev-server "/src/assets/...", que NÃO existe
 * no sistema de arquivos — o PptxGenJS tenta lê-lo do disco e aborta com ENOENT
 * ("Unable to read media"). Nesse contexto resolvemos o caminho absoluto real no disco:
 * 1. process.env.BYCOR_LOGO_DISK_PATH — definido pelo harness (run-tests.js) com o caminho
 *    absoluto resolvido a partir da raiz do projeto (fonte da verdade);
 * 2. fallback: process.cwd() + caminho do dev-server (o `npm run` executa na raiz do projeto).
 * No navegador/SSR de produção nada muda: segue a URL do asset compilado pelo Vite.
 */
function resolverCaminhoLogoBycor(): string {
  const proc = getNodeProcess()

  if (isNodeRuntime() && proc?.env) {
    const envDiskPath = proc.env.BYCOR_LOGO_DISK_PATH
    if (envDiskPath && envDiskPath.length > 0) return envDiskPath

    if (typeof logoBycorAssetUrl === 'string' && logoBycorAssetUrl.startsWith('/src/')) {
      return `${typeof proc.cwd === 'function' ? proc.cwd() : ''}${logoBycorAssetUrl}`
    }
  }

  return logoBycorAssetUrl
}

export const LOGO_BYCOR_PATH = resolverCaminhoLogoBycor()

/**
 * Indica se o logotipo resolvível está disponível como mídia real (arquivo em disco ou
 * URL http(s) acessível). No harness Node sem mídia, os geradores PPTX devem omitir o
 * logo (includeLogo=false) em vez de abortar com ENOENT.
 */
export function isLogoMediaAvailable(): boolean {
  if (typeof LOGO_BYCOR_PATH === 'string' && /^https?:\/\//i.test(LOGO_BYCOR_PATH)) {
    return true
  }
  if (isNodeRuntime()) {
    return !!getNodeProcess()?.env?.BYCOR_LOGO_DISK_PATH
  }
  // Navegador/SSR com asset compilado pelo Vite: sempre disponível.
  return true
}
