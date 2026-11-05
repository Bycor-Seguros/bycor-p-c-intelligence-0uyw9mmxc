import logoBycorAssetUrl from '@/assets/logo-bycor-3c53f.jpg'

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
  const isNode = typeof process !== 'undefined' && !!process.versions && !!process.versions.node

  if (isNode && typeof process.env !== 'undefined') {
    const envDiskPath = process.env.BYCOR_LOGO_DISK_PATH
    if (envDiskPath && envDiskPath.length > 0) return envDiskPath

    if (typeof logoBycorAssetUrl === 'string' && logoBycorAssetUrl.startsWith('/src/')) {
      return `${process.cwd()}${logoBycorAssetUrl}`
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
  if (typeof process !== 'undefined' && !!process.versions && !!process.versions.node) {
    return !!process.env?.BYCOR_LOGO_DISK_PATH
  }
  // Navegador/SSR com asset compilado pelo Vite: sempre disponível.
  return true
}
