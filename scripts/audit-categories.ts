import { pb } from '@/lib/pocketbase/client'

async function check() {
  const propostas = await pb.collection('propostas').getFullList()
  for (const p of propostas) {
    console.log(`=== PROPOSTA ${p.id} (RFQ: ${p.rfq}) ===`)
    const cobs = p.coberturas || []
    for (const c of cobs) {
      console.log(
        `- Nome: "${c.cobertura || c.nome}" | Cat: "${c.categoriaNormalizada || c.categoria_normalizada}"`,
      )
    }
  }
}
check()
