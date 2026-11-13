// FLUXO DE UPLOAD DO QAR (chamado pela UI — espelho do padrão Cartão de Risco)
// Parser puro em qarReader.ts; interface de gravação em qarPersistencia.ts;
// este módulo é só o passo "extraia o texto do PDF e delegue à persistência",
// para que páginas e modais não dupliquem essa lógica.

import { extractTextFromPdf } from '@/services/pdfTextExtractor'
import {
  salvarQarDeclarado,
  type QarUploadParams,
  type QarUploadResultado,
} from '@/services/qarPersistencia'

export interface ProcessarQarPdfParams {
  /** Arquivo PDF do QAR. */
  file: File
  /** Empreendimento do ciclo (obrigatório — vínculo principal). */
  empreendimentoId: string
  /** RFQ do ciclo, quando existir (rastreabilidade). */
  rfqId?: string
  /** E-mail do usuário do ciclo (rastreabilidade). */
  usuarioEmail: string
}

/**
 * Lê o PDF (texto página por página), faz parse do item 21 e grava os dados
 * declarados vinculados ao empreendimento/ciclo informados.
 * Não altera nada quando o PDF não é um QAR reconhecível — nesse caso retorna
 * success=false com o motivo, e quem chama decide o que mostrar.
 */
export async function processarQarPdfVinculado(
  params: ProcessarQarPdfParams,
  onProgress?: (msg: string) => void,
): Promise<QarUploadResultado> {
  onProgress?.('Lendo o PDF (texto página por página)...')
  const paginas = await extractTextFromPdf(params.file)
  const linhasTexto = paginas.flatMap((p) => p.lines)

  onProgress?.('Interpretando o item 21 do QAR...')
  return salvarQarDeclarado(
    {
      empreendimentoId: params.empreendimentoId,
      ...(params.rfqId ? { rfqId: params.rfqId } : {}),
      fonteArquivo: params.file.name,
      usuarioEmail: params.usuarioEmail,
      linhasTexto,
    } satisfies QarUploadParams,
    onProgress,
  )
}
