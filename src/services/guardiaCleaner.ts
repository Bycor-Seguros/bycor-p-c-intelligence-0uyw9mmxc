import pb from '@/lib/pocketbase/client'
import { executeWithRetry } from './guardiaImporter'

export interface ClearDatabaseResult {
  success: boolean
  counts: {
    matriz: number
    coberturas: number
    sinistros: number
    notas_base: number
    apolices: number
    empreendimentos: number
    divergencias: number
    rastreabilidade: number
  }
  errors: string[]
}

/**
 * Clear all imported records from Guardia base collections respecting foreign key dependencies:
 * 1. matriz
 * 2. coberturas
 * 3. sinistros
 * 4. notas_base
 * 5. divergencias (points to empreendimentos)
 * 6. rastreabilidade
 * 7. apolices (points to empreendimentos)
 * 8. empreendimentos
 *
 * Does NOT touch: users, contas, rfq, propostas, documentos, historico, auditoria, seguradoras, etc.
 */
export async function clearGuardiaImportedData(): Promise<ClearDatabaseResult> {
  const result: ClearDatabaseResult = {
    success: true,
    counts: {
      matriz: 0,
      coberturas: 0,
      sinistros: 0,
      notas_base: 0,
      apolices: 0,
      empreendimentos: 0,
      divergencias: 0,
      rastreabilidade: 0,
    },
    errors: [],
  }

  // Deletion order respecting foreign keys
  const collectionsToDelete: (keyof ClearDatabaseResult['counts'])[] = [
    'matriz',
    'coberturas',
    'sinistros',
    'notas_base',
    'divergencias',
    'rastreabilidade',
    'apolices',
    'empreendimentos',
  ]

  for (const colName of collectionsToDelete) {
    try {
      const records = await executeWithRetry(
        () =>
          pb.collection(colName).getFullList({
            fields: 'id',
            batch: 200,
          }),
        { throttleMs: 50 },
      )

      for (const r of records) {
        try {
          await executeWithRetry(() => pb.collection(colName).delete(r.id), {
            throttleMs: 60,
          })
          result.counts[colName]++
        } catch (err: unknown) {
          result.errors.push(`Erro ao deletar de ${colName} (${r.id}): ${(err as Error).message}`)
          result.success = false
        }
      }
    } catch (err: unknown) {
      result.errors.push(`Erro ao buscar registros de ${colName}: ${(err as Error).message}`)
      result.success = false
    }
  }

  return result
}
