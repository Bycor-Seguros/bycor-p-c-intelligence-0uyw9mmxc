import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const assetPath = path.resolve(process.cwd(), 'src/assets/porto-v120-58a27.pdf')
const fileBuf = fs.readFileSync(assetPath)

const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
const header = `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="porto.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
const footer = `\r\n--${boundary}--\r\n`

const payload = Buffer.concat([Buffer.from(header, 'utf8'), fileBuf, Buffer.from(footer, 'utf8')])

const req = https.request(
  'https://bycor-pc-intelligence-e3365.shrd01.internal.goskip.dev/backend/v1/debug/run-test',
  {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    },
  },
  (res) => {
    let body = ''
    res.on('data', (c) => (body += c))
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        console.log('STATUS:', res.statusCode)
        console.log('LENGTH:', data.length)
        console.log('TRUNCATED:', data.truncated)
        if (data.markdown) {
          fs.writeFileSync(
            path.resolve(process.cwd(), '.cache/porto_doc_markdown.md'),
            data.markdown,
          )
          console.log('MARKDOWN SALVO COM SUCESSO EM .cache/porto_doc_markdown.md')
        } else {
          console.log('RESPOSTA:', data)
        }
      } catch (e) {
        console.log('RESPOSTA RAW:', body)
      }
    })
  },
)

req.on('error', console.error)
req.write(payload)
req.end()
