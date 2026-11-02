/**
 * Gerador de apresentações comerciais (.pptx) em formato Microsoft Office OpenXML PresentationML rigorosamente compatível.
 * Produz um pacote ZIP válido com todos os componentes obrigatórios pelo Microsoft PowerPoint para evitar telas de aviso/reparo:
 * 1. [Content_Types].xml (defaults + overrides canônicos)
 * 2. _rels/.rels (officeDocument, core-properties, extended-properties)
 * 3. docProps/core.xml e docProps/app.xml
 * 4. ppt/presentation.xml (com sldMasterIdLst, sldIdLst, sldSz 16:9, notesSz e defaultTextStyle completo)
 * 5. ppt/_rels/presentation.xml.rels (slideMaster, theme, slides, presProps, viewProps, tableStyles)
 * 6. ppt/presProps.xml (Presentation Properties part - p:presentationPr)
 * 7. ppt/viewProps.xml (View Properties part - p:viewPr com normalViewPr)
 * 8. ppt/tableStyles.xml (Table Styles part - a:tblStyleLst)
 * 9. ppt/theme/theme1.xml (DrawingML Theme canônico)
 * 10. ppt/slideMasters/slideMaster1.xml (com p:txStyles com p:titleStyle, p:bodyStyle e p:otherStyle completos)
 * 11. ppt/slideMasters/_rels/slideMaster1.xml.rels
 * 12. ppt/slideLayouts/slideLayout1.xml (Blank layout)
 * 13. ppt/slideLayouts/_rels/slideLayout1.xml.rels
 * 14. ppt/slides/slide{N}.xml e ppt/slides/_rels/slide{N}.xml.rels
 */
import { createZipArchive, SimpleZipFile } from './zipArchiveService'
import { formatCurrency, formatDate } from '@/lib/formatters'

export interface PptxCoverageItem {
  nome: string
  lmi: number | null
  franquia: string
}

export interface PptxPresentationData {
  clienteNome: string
  razaoSocial?: string
  cidade?: string
  uf?: string
  areaConstruida?: number
  seguradoraNome: string
  premioBruto: number
  lmiLmg: number
  recomendacao: string
  coberturas: PptxCoverageItem[]
}

function escapeXml(unsafe: string | number | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return ''
  // Remove caracteres de controle proibidos em XML 1.0 (exceto \t, \n, \r)
  const str = String(unsafe)
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      if (code === 0x09 || code === 0x0a || code === 0x0d) return true
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Constrói o pacote PPTX completo com os slides:
 * 1. Capa Institucional Bycor (Apresentação Comercial ao Segurado)
 * 2. Perfil Operacional & Estrutura Financeira da Apólice Recomendada
 * 3..N. Tabela de Coberturas e Limites Tabulados (paginados até 7 linhas por slide)
 * Final. Parecer Técnico da Corretora & Recomendação de Contratação
 */
export function generatePresentationPptx(data: PptxPresentationData): Uint8Array {
  const files: SimpleZipFile[] = []

  // Paginação das coberturas: blocos de no máx. 7 linhas por slide
  // Cap máximo de 20 slides por segurança no arquivo total (capa + perfil + N coberturas + parecer <= 20)
  const LINES_PER_SLIDE = 7
  const MAX_TOTAL_SLIDES = 20
  const FIXED_NON_COVERAGE_SLIDES = 3 // Slide 1 (capa), Slide 2 (perfil), Slide Final (parecer)
  const MAX_COVERAGE_SLIDES = Math.max(1, MAX_TOTAL_SLIDES - FIXED_NON_COVERAGE_SLIDES) // 17 slides máx de coberturas

  const coverageChunks: PptxCoverageItem[][] = []
  if (data.coberturas && data.coberturas.length > 0) {
    for (let i = 0; i < data.coberturas.length; i += LINES_PER_SLIDE) {
      if (coverageChunks.length >= MAX_COVERAGE_SLIDES) break
      coverageChunks.push(data.coberturas.slice(i, i + LINES_PER_SLIDE))
    }
  } else {
    // Bloco vazio com item padrão
    coverageChunks.push([])
  }

  const numCoverageSlides = coverageChunks.length
  // Total de slides: Slide 1 (capa) + Slide 2 (perfil) + N slides de cobertura + Slide final (parecer)
  const totalSlides = Math.min(MAX_TOTAL_SLIDES, 2 + numCoverageSlides + 1)
  const parecerSlideNum = totalSlides

  // 1. [Content_Types].xml
  const contentTypesOverrides: string[] = []
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
  )
  for (let s = 1; s <= totalSlides; s++) {
    contentTypesOverrides.push(
      `  <Override PartName="/ppt/slides/slide${s}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
  }
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  )
  contentTypesOverrides.push(
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  )

  files.push({
    name: '[Content_Types].xml',
    content:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\r\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\r\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\r\n' +
      contentTypesOverrides.join('\r\n') +
      '\r\n' +
      '</Types>',
  })

  // 2. _rels/.rels
  files.push({
    name: '_rels/.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  })

  // 3. docProps/core.xml
  const nowIso = new Date().toISOString()
  files.push({
    name: 'docProps/core.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(data.clienteNome)} - Apresentação Comercial Bycor</dc:title>
  <dc:creator>Bycor P&amp;C Intelligence</dc:creator>
  <cp:lastModifiedBy>Bycor P&amp;C Intelligence</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`,
  })

  // 4. docProps/app.xml
  files.push({
    name: 'docProps/app.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <TotalTime>0</TotalTime>
  <Words>0</Words>
  <Application>Bycor P&amp;C Intelligence</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Paragraphs>0</Paragraphs>
  <Slides>${totalSlides}</Slides>
  <Notes>0</Notes>
  <HiddenSlides>0</HiddenSlides>
  <MMClips>0</MMClips>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Tema</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>Bycor Theme</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>Bycor Consultoria e Corretora de Seguros</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>`,
  })

  // 5. ppt/_rels/presentation.xml.rels
  const presRelsList: string[] = [
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
  ]
  for (let s = 1; s <= totalSlides; s++) {
    presRelsList.push(
      `  <Relationship Id="rId${s + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${s}.xml"/>`,
    )
  }
  const presPropsRelId = `rId${totalSlides + 3}`
  const viewPropsRelId = `rId${totalSlides + 4}`
  const tableStylesRelId = `rId${totalSlides + 5}`

  presRelsList.push(
    `  <Relationship Id="${presPropsRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>`,
  )
  presRelsList.push(
    `  <Relationship Id="${viewPropsRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>`,
  )
  presRelsList.push(
    `  <Relationship Id="${tableStylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>`,
  )

  files.push({
    name: 'ppt/_rels/presentation.xml.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${presRelsList.join('\r\n')}
</Relationships>`,
  })

  // 6. ppt/presentation.xml (16:9 widescreen: 12192000 x 6858000)
  const sldIdListXml: string[] = []
  for (let s = 1; s <= totalSlides; s++) {
    // id começa em 256, r:id começa em rId3
    sldIdListXml.push(`    <p:sldId id="${255 + s}" r:id="rId${s + 2}"/>`)
  }

  files.push({
    name: 'ppt/presentation.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
${sldIdListXml.join('\r\n')}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr>
      <a:defRPr lang="pt-BR"/>
    </a:defPPr>
  </p:defaultTextStyle>
</p:presentation>`,
  })

  // 7. ppt/presProps.xml (Presentation Properties obrigatório para compatibilidade)
  files.push({
    name: 'ppt/presProps.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  })

  // 8. ppt/viewProps.xml (View Properties com modo Normal e visualização de slide)
  files.push({
    name: 'ppt/viewProps.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:normalViewPr>
    <p:restoredLeft sz="15620"/>
    <p:restoredTop sz="94660"/>
  </p:normalViewPr>
  <p:slideViewPr>
    <p:cSldViewPr>
      <p:cViewPr varScale="1">
        <p:scale>
          <a:sx n="100" d="100"/>
          <a:sy n="100" d="100"/>
        </p:scale>
        <p:origin x="0" y="0"/>
      </p:cViewPr>
      <p:guideLst/>
    </p:cSldViewPr>
  </p:slideViewPr>
</p:viewPr>`,
  })

  // 9. ppt/tableStyles.xml (Table Styles obrigatório quando há tabelas DrawingML no documento)
  files.push({
    name: 'ppt/tableStyles.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  })

  // 10. ppt/theme/theme1.xml
  files.push({
    name: 'ppt/theme/theme1.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Bycor Theme">
  <a:themeElements>
    <a:clrScheme name="Bycor Palette">
      <a:dk1><a:srgbClr val="0F2B46"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="16578B"/></a:dk2>
      <a:lt2><a:srgbClr val="F5F7FA"/></a:lt2>
      <a:accent1><a:srgbClr val="0F2B46"/></a:accent1>
      <a:accent2><a:srgbClr val="16578B"/></a:accent2>
      <a:accent3><a:srgbClr val="0D9488"/></a:accent3>
      <a:accent4><a:srgbClr val="D97706"/></a:accent4>
      <a:accent5><a:srgbClr val="16A34A"/></a:accent5>
      <a:accent6><a:srgbClr val="64748B"/></a:accent6>
      <a:hlink><a:srgbClr val="16578B"/></a:hlink>
      <a:folHlink><a:srgbClr val="0F2B46"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Bycor Fonts">
      <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Bycor Scheme">
      <a:fillStyleLst><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectLst/></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`,
  })

  // 11. ppt/slideMasters/slideMaster1.xml (com p:txStyles com p:titleStyle, p:bodyStyle e p:otherStyle estruturados)
  files.push({
    name: 'ppt/slideMasters/slideMaster1.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1">
        <a:defRPr sz="4000" kern="1200">
          <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
          <a:latin typeface="Arial"/>
        </a:defRPr>
      </a:lvl1pPr>
    </p:titleStyle>
    <p:bodyStyle>
      <a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1">
        <a:defRPr sz="1800" kern="1200">
          <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
          <a:latin typeface="Arial"/>
        </a:defRPr>
      </a:lvl1pPr>
    </p:bodyStyle>
    <p:otherStyle>
      <a:defPPr>
        <a:defRPr lang="pt-BR"/>
      </a:defPPr>
    </p:otherStyle>
  </p:txStyles>
</p:sldMaster>`,
  })

  // 12. ppt/slideMasters/_rels/slideMaster1.xml.rels
  files.push({
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
  })

  // 13. ppt/slideLayouts/slideLayout1.xml
  files.push({
    name: 'ppt/slideLayouts/slideLayout1.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
  })

  // 14. ppt/slideLayouts/_rels/slideLayout1.xml.rels
  files.push({
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
  })

  // Helper para criar slide rels
  const makeSlideRel = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`

  for (let s = 1; s <= totalSlides; s++) {
    files.push({ name: `ppt/slides/_rels/slide${s}.xml.rels`, content: makeSlideRel() })
  }

  // SLIDE 1: Capa Executiva
  files.push({
    name: 'ppt/slides/slide1.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <!-- Background Header Navy Card -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="BgNavy"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="10363200" cy="5029200"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="16578B"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <!-- Tag Bycor -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Tag"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1371600" y="1463040"/><a:ext cx="3657600" cy="457200"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1400" b="1"><a:solidFill><a:srgbClr val="60A5FA"/></a:solidFill></a:rPr>
              <a:t>BYCOR CONSULTORIA E CORRETORA DE SEGUROS</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Title -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1371600" y="2103120"/><a:ext cx="9144000" cy="1371600"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="3600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>
              <a:t>Apresentação Comercial ao Segurado</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="2000"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill></a:rPr>
              <a:t>Relatório Técnico de Recomendação &amp; Minuta Executiva P&amp;C</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Cliente & Data Box -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="ClientBox"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1371600" y="3840480"/><a:ext cx="9144000" cy="1371600"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1600" b="1"><a:solidFill><a:srgbClr val="93C5FD"/></a:solidFill></a:rPr>
              <a:t>Cliente / Empreendimento: </a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.clienteNome)}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1400"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:rPr>
              <a:t>Data de Emissão: ${escapeXml(formatDate(new Date().toISOString()))} | Versão Executiva 1.0</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`,
  })

  // SLIDE 2: Perfil Operacional & Estrutura da Apólice Recomendada
  files.push({
    name: 'ppt/slides/slide2.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <!-- Slide Title -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="731520" y="548640"/><a:ext cx="10728960" cy="731520"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>1. Perfil Operacional &amp; Estrutura Recomendada</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Box 1: Perfil Segurado -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="CardPerfil"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="731520" y="1463040"/><a:ext cx="10728960" cy="1828800"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1400" b="1"><a:solidFill><a:srgbClr val="16578B"/></a:solidFill></a:rPr>
              <a:t>DADOS OPERACIONAIS DO CLIENTE</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:rPr>
              <a:t>Empreendimento: </a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1300"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.clienteNome)}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:rPr>
              <a:t>Razão Social: </a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1300"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.razaoSocial || 'Não informado')}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:rPr>
              <a:t>Localização: </a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1300"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.cidade || 'São Paulo')} - ${escapeXml(data.uf || 'SP')}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:rPr>
              <a:t>Área Construída: </a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1300"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.areaConstruida ? `${data.areaConstruida} m²` : '—')}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Card 1: Seguradora Líder -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="CardSeguradora"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="731520" y="3566160"/><a:ext cx="3383280" cy="2377440"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="EFF6FF"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="BFDBFE"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr>
              <a:t>SEGURADORA RECOMENDADA</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.seguradoraNome)}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1100"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr>
              <a:t>Avaliação técnica aprovada no comitê de colocação de risco Bycor.</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Card 2: LMI / LMG Consolidado -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="CardLmi"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4404360" y="3566160"/><a:ext cx="3383280" cy="2377440"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr>
              <a:t>LMI / LMG CONSOLIDADO</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(formatCurrency(data.lmiLmg))}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1100"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr>
              <a:t>Garantia patrimonial máxima contratada por evento.</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Card 3: Investimento Prêmio Total -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="6" name="CardPremio"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8077200" y="3566160"/><a:ext cx="3383280" cy="2377440"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="F0FDF4"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="BBF7D0"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="16A34A"/></a:solidFill></a:rPr>
              <a:t>INVESTIMENTO (PRÊMIO TOTAL)</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="14532D"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(formatCurrency(data.premioBruto))}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1100" b="1"><a:solidFill><a:srgbClr val="15803D"/></a:solidFill></a:rPr>
              <a:t>Com IOF de 7,38% incluso · Condições negociadas.</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`,
  })

  // SLIDES DE COBERTURAS: Gerados dinamicamente por bloco paginado (no máx. 7 linhas por slide)
  const buildCellText = (val: string | number | null | undefined, fallback: string): string => {
    if (val === null || val === undefined) return fallback
    const s = String(val).trim()
    return s.length > 0 ? escapeXml(s) : fallback
  }

  // Header row padrão (3 colunas exatas) compartilhado por todos os slides de coberturas
  const headerRowXml =
    '<a:tr h="365760">' +
    '<a:tc>' +
    '<a:txBody>' +
    '<a:bodyPr/>' +
    '<a:lstStyle/>' +
    '<a:p>' +
    '<a:r>' +
    '<a:rPr sz="1200" b="1">' +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    '</a:rPr>' +
    '<a:t>Garantia / Cobertura Contratada</a:t>' +
    '</a:r>' +
    '</a:p>' +
    '</a:txBody>' +
    '<a:tcPr><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:tcPr>' +
    '</a:tc>' +
    '<a:tc>' +
    '<a:txBody>' +
    '<a:bodyPr/>' +
    '<a:lstStyle/>' +
    '<a:p>' +
    '<a:pPr algn="r"/>' +
    '<a:r>' +
    '<a:rPr sz="1200" b="1">' +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    '</a:rPr>' +
    '<a:t>Limite (LMI)</a:t>' +
    '</a:r>' +
    '</a:p>' +
    '</a:txBody>' +
    '<a:tcPr><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:tcPr>' +
    '</a:tc>' +
    '<a:tc>' +
    '<a:txBody>' +
    '<a:bodyPr/>' +
    '<a:lstStyle/>' +
    '<a:p>' +
    '<a:r>' +
    '<a:rPr sz="1200" b="1">' +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    '</a:rPr>' +
    '<a:t>Franquia / POS</a:t>' +
    '</a:r>' +
    '</a:p>' +
    '</a:txBody>' +
    '<a:tcPr><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:tcPr>' +
    '</a:tc>' +
    '</a:tr>'

  coverageChunks.forEach((chunk, chunkIdx) => {
    const slideNumber = 3 + chunkIdx
    const k = chunkIdx + 1
    const n = numCoverageSlides
    const slideTitle =
      k === 1
        ? `2. Resumo de Coberturas Incluídas (Parte 1/${n})`
        : `Continuação — Coberturas (${k}/${n})`

    const tableRowsXml: string[] = [headerRowXml]

    if (chunk.length > 0) {
      chunk.forEach((c, idx) => {
        const bgClr = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC'
        const nomeText = buildCellText(c.nome, 'Cobertura Contratada')
        const lmiText = buildCellText(formatCurrency(c.lmi), 'Consulte Apólice')
        const franqText = buildCellText(c.franquia, 'Padrão da Seguradora')

        tableRowsXml.push(
          '<a:tr h="320040">' +
            '<a:tc>' +
            '<a:txBody>' +
            '<a:bodyPr/>' +
            '<a:lstStyle/>' +
            '<a:p>' +
            '<a:r>' +
            '<a:rPr sz="1100" b="1">' +
            '<a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill>' +
            '</a:rPr>' +
            `<a:t>${nomeText}</a:t>` +
            '</a:r>' +
            '</a:p>' +
            '</a:txBody>' +
            `<a:tcPr><a:solidFill><a:srgbClr val="${bgClr}"/></a:solidFill></a:tcPr>` +
            '</a:tc>' +
            '<a:tc>' +
            '<a:txBody>' +
            '<a:bodyPr/>' +
            '<a:lstStyle/>' +
            '<a:p>' +
            '<a:pPr algn="r"/>' +
            '<a:r>' +
            '<a:rPr sz="1100" b="1">' +
            '<a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill>' +
            '</a:rPr>' +
            `<a:t>${lmiText}</a:t>` +
            '</a:r>' +
            '</a:p>' +
            '</a:txBody>' +
            `<a:tcPr><a:solidFill><a:srgbClr val="${bgClr}"/></a:solidFill></a:tcPr>` +
            '</a:tc>' +
            '<a:tc>' +
            '<a:txBody>' +
            '<a:bodyPr/>' +
            '<a:lstStyle/>' +
            '<a:p>' +
            '<a:r>' +
            '<a:rPr sz="1100">' +
            '<a:solidFill><a:srgbClr val="475569"/></a:solidFill>' +
            '</a:rPr>' +
            `<a:t>${franqText}</a:t>` +
            '</a:r>' +
            '</a:p>' +
            '</a:txBody>' +
            `<a:tcPr><a:solidFill><a:srgbClr val="${bgClr}"/></a:solidFill></a:tcPr>` +
            '</a:tc>' +
            '</a:tr>',
        )
      })
    } else {
      const lmiVal = buildCellText(formatCurrency(data.lmiLmg), 'Consulte Apólice')
      tableRowsXml.push(
        '<a:tr h="320040">' +
          '<a:tc>' +
          '<a:txBody>' +
          '<a:bodyPr/>' +
          '<a:lstStyle/>' +
          '<a:p>' +
          '<a:r>' +
          '<a:rPr sz="1100">' +
          '<a:solidFill><a:srgbClr val="64748B"/></a:solidFill>' +
          '</a:rPr>' +
          '<a:t>Incêndio Básica (Danos Materiais)</a:t>' +
          '</a:r>' +
          '</a:p>' +
          '</a:txBody>' +
          '<a:tcPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr>' +
          '</a:tc>' +
          '<a:tc>' +
          '<a:txBody>' +
          '<a:bodyPr/>' +
          '<a:lstStyle/>' +
          '<a:p>' +
          '<a:pPr algn="r"/>' +
          '<a:r>' +
          '<a:rPr sz="1100" b="1">' +
          '<a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill>' +
          '</a:rPr>' +
          `<a:t>${lmiVal}</a:t>` +
          '</a:r>' +
          '</a:p>' +
          '</a:txBody>' +
          '<a:tcPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr>' +
          '</a:tc>' +
          '<a:tc>' +
          '<a:txBody>' +
          '<a:bodyPr/>' +
          '<a:lstStyle/>' +
          '<a:p>' +
          '<a:r>' +
          '<a:rPr sz="1100">' +
          '<a:solidFill><a:srgbClr val="475569"/></a:solidFill>' +
          '</a:rPr>' +
          '<a:t>Padrão de mercado</a:t>' +
          '</a:r>' +
          '</a:p>' +
          '</a:txBody>' +
          '<a:tcPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr>' +
          '</a:tc>' +
          '</a:tr>',
      )
    }

    files.push({
      name: `ppt/slides/slide${slideNumber}.xml`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <!-- Title -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="731520" y="548640"/><a:ext cx="10728960" cy="731520"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(slideTitle)}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Table Frame: nvGraphicFramePr -> xfrm -> graphic (p:xfrm contem a:off e a:ext) -->
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="3" name="CoberturasTable"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="731520" y="1463040"/><a:ext cx="10728960" cy="4572000"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr/>
              <a:tblGrid>
                <a:gridCol w="5120640"/>
                <a:gridCol w="2743200"/>
                <a:gridCol w="2865120"/>
              </a:tblGrid>
              ${tableRowsXml.join('')}
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`,
    })
  })

  // SLIDE FINAL: Parecer Técnico & Recomendação da Corretora (passa a ser o último do arquivo: slide[parecerSlideNum].xml)
  files.push({
    name: `ppt/slides/slide${parecerSlideNum}.xml`,
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <!-- Title -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="731520" y="548640"/><a:ext cx="10728960" cy="731520"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>3. Parecer Técnico &amp; Recomendação da Corretora</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Parecer Card -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="CardParecer"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="731520" y="1463040"/><a:ext cx="10728960" cy="3200400"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="16578B"/></a:solidFill></a:rPr>
              <a:t>PARECER TÉCNICO BYCOR CONSULTORIA:</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1300"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.recomendacao)}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Assinatura Bycor -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Assinatura1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="731520" y="5029200"/><a:ext cx="4572000" cy="1188720"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>BYCOR Seguros</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1100"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr>
              <a:t>Consultoria Técnica P&amp;C</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <!-- Assinatura Segurado -->
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="Assinatura2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="6888480" y="5029200"/><a:ext cx="4572000" cy="1188720"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="0F2B46"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(data.clienteNome)}</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1100"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr>
              <a:t>Assinatura de Aceite do Segurado</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`,
  })

  return createZipArchive(files)
}
