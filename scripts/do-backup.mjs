import fs from 'node:fs'
import path from 'node:path'

const src = path.resolve(process.cwd(), 'src/services/apoliceReader.ts')
const dst = path.resolve(process.cwd(), 'scripts/apoliceReader.v0.0.79.bak')
fs.copyFileSync(src, dst)
console.log('Backup v0.0.79 salvo com sucesso! Bytes:', fs.statSync(dst).size)
