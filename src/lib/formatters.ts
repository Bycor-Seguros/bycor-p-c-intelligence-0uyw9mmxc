// Formatting and utility functions for Bycor P&C Intelligence

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const num =
    typeof value === 'string' ? parseFloat(value.replace(/\./g, '').replace(',', '.')) : value
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const clean = dateStr.slice(0, 10)
    const parts = clean.split('-')
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return dateStr
  } catch {
    return dateStr
  }
}

export function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return '—'
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return cnpj
}

export function getDaysRemaining(dateFimStr: string | null | undefined): number | null {
  if (!dateFimStr) return null
  try {
    const end = new Date(dateFimStr.slice(0, 10) + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diffTime = end.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

export function getStatusBadgeInfo(status: string | null | undefined) {
  const norm = (status || '').toLowerCase().trim()
  switch (norm) {
    case 'ativa':
      return {
        label: 'Ativa',
        bg: 'bg-[#DCFCE7] text-[#16A34A] border-[#86EFAC]',
        color: '#16A34A',
      }
    case 'a vencer':
      return {
        label: 'A Vencer',
        bg: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
        color: '#D97706',
      }
    case 'vencida':
      return {
        label: 'Vencida',
        bg: 'bg-[#FEE2E2] text-[#DC2626] border-[#FCA5A5]',
        color: '#DC2626',
      }
    case 'renovada':
      return {
        label: 'Renovada',
        bg: 'bg-[#DBEAFE] text-[#1E40AF] border-[#93C5FD]',
        color: '#1E40AF',
      }
    case 'não renovada':
    case 'nao renovada':
      return {
        label: 'Não Renovada',
        bg: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
        color: '#4B5563',
      }
    case 'prospect':
      return {
        label: 'Prospect',
        bg: 'bg-[#EDE9FE] text-[#6D28D9] border-[#DDD6FE]',
        color: '#6D28D9',
      }
    default:
      return {
        label: status || 'Desconhecido',
        bg: 'bg-gray-100 text-gray-700 border-gray-200',
        color: '#6B7280',
      }
  }
}

export const CATEGORIAS_48 = [
  'Alagamento/Inundação',
  'Anúncios/Letreiros Luminosos',
  'Assistência 24h',
  'Bens de Terceiros em Poder do Segurado',
  'Danos Elétricos',
  'Danos por Água / Sprinklers',
  'Demolição e Desentulho',
  'Desmoronamento',
  'Despesas Extraordinárias',
  'Despesas com Instalação em Novo Local',
  'Despesas de Salvamento e Contenção',
  'Deterioração de Mercadorias (Frigorificados)',
  'Equipamentos Arrendados/Cedidos a Terceiros',
  'Equipamentos Eletrônicos',
  'Equipamentos Estacionários',
  'Equipamentos Móveis',
  'Equipamentos Portáteis',
  'Fidelidade de Funcionários',
  'Fornecedores/Compradores Especificados (Lucros Cessantes Contingente)',
  'Honorários de Peritos',
  'Impacto de Veículos',
  'Incêndio Básica (Danos Materiais)',
  'Incêndio Decorrente de Queimadas em Zonas Rurais',
  'Linhas de Transmissão',
  'Lucros Cessantes / Perda de Receita',
  'Mercadorias em Exposição',
  'Obras Civis/Pequenas Obras de Engenharia',
  'Obras de Arte',
  'Perda/Pagamento de Aluguel',
  'Quebra de Máquinas',
  'Quebra de Vidros/Espelhos/Mármores',
  'RC Condomínio',
  'RC Custos de Defesa',
  'RC Danos Morais',
  'RC Empregador',
  'RC Guarda de Veículos de Terceiros',
  'RC Hospedagem/Restaurantes/Bares',
  'RC Operações (Estabelecimentos Comerciais/Industriais)',
  'RC Poluição Súbita e Acidental',
  'RC Portões Automáticos',
  'RC Síndico',
  'Recomposição de Registros/Documentos',
  'Roubo/Furto de Bens do Segurado',
  'Roubo/Furto de Bens/Valores de Hóspedes',
  'Roubo/Furto de Valores (Interior/Trânsito)',
  'Tumultos/Greves/Lock-out/Vandalismo',
  'Vazamento/Rompimento de Tanques e Tubulações',
  'Vendaval/Granizo/Ciclone/Fumaça',
] as const
