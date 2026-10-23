routerAdd('POST', '/backend/v1/debug/convert-pdf', (e) => {
  const files = e.findUploadedFiles('arquivo')
  if (!files || files.length === 0) {
    return e.json(400, { error: 'Nenhum arquivo enviado' })
  }
  try {
    const { markdown, truncated } = $documents.toMarkdown({ file: files[0] })
    return e.json(200, {
      markdown,
      truncated,
      length: markdown.length,
    })
  } catch (err) {
    return e.json(err.status || 500, { error: err.message })
  }
})
