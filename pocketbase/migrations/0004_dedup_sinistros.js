migrate(
  (app) => {
    // Normalizador de texto compatível com runtime JS goja do PocketBase (sem dependências externas)
    function normalizeMatchText(val) {
      if (val === null || val === undefined) return ''
      // Goja suporta replace com regex básica; não usamos NFD se não disponível ou removemos acentos comuns
      var str = String(val).trim().toLowerCase()
      // Mapeamento manual de acentos frequentes em português para garantir portabilidade em qualquer engine
      var map = {
        á: 'a',
        à: 'a',
        ã: 'a',
        â: 'a',
        ä: 'a',
        é: 'e',
        è: 'e',
        ê: 'e',
        ë: 'e',
        í: 'i',
        ì: 'i',
        î: 'i',
        ï: 'i',
        ó: 'o',
        ò: 'o',
        õ: 'o',
        ô: 'o',
        ö: 'o',
        ú: 'u',
        ù: 'u',
        û: 'u',
        ü: 'u',
        ç: 'c',
        ñ: 'n',
      }
      for (var k in map) {
        str = str.split(k).join(map[k])
      }
      // Se normalize NFD existir no goja:
      try {
        if (typeof str.normalize === 'function') {
          str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        }
      } catch (_) {}

      // Substituir pontuações e símbolos por espaço e condensar
      str = str.replace(/[()[\]{}|\\/\-_:;.,+~^`"'*?!]+/g, ' ')
      str = str.replace(/\s+/g, ' ').trim()
      return str
    }

    function buildSinistroKey(record) {
      var emp = String(record.getString('id_empreendimento') || '').trim()
      var num = String(record.getString('numero_sinistro') || '')
        .trim()
        .toLowerCase()
      var dt = String(record.getString('data_sinistro') || '')
        .trim()
        .slice(0, 10)
      var cob = normalizeMatchText(record.getString('cobertura_acionada'))
      var desc = normalizeMatchText(record.getString('descricao'))
      var valNum = record.getFloat('valor_indenizado_rs') || 0
      var valNorm = Number(valNum).toFixed(2)

      return (
        emp + '::num:' + num + '::dt:' + dt + '::cob:' + cob + '::desc:' + desc + '::val:' + valNorm
      )
    }

    try {
      // Buscar todos os sinistros ordenados por created ascendente (mais antigo primeiro)
      var allSinistros = app.findRecordsByFilter('sinistros', '1=1', 'created', 5000, 0)
      console.log(
        '[dedup_sinistros] Total de sinistros no banco antes da limpeza: ' + allSinistros.length,
      )

      var groups = {}
      for (var i = 0; i < allSinistros.length; i++) {
        var rec = allSinistros[i]
        var key = buildSinistroKey(rec)
        if (!groups[key]) {
          groups[key] = []
        }
        groups[key].push(rec)
      }

      var duplicateGroupCount = 0
      var recordsToDeleteCount = 0
      var recordsToDelete = []

      for (var gKey in groups) {
        var groupRecords = groups[gKey]
        if (groupRecords.length > 1) {
          duplicateGroupCount++
          // Manter exatamente o primeiro registro (o mais antigo, pois ordenado por created asc)
          for (var j = 1; j < groupRecords.length; j++) {
            recordsToDeleteCount++
            recordsToDelete.push(groupRecords[j])
          }
        }
      }

      console.log(
        '[dedup_sinistros] Grupos duplicados identificados: ' +
          duplicateGroupCount +
          ', registros a excluir: ' +
          recordsToDeleteCount,
      )

      // Exclusão em lote segura
      for (var d = 0; d < recordsToDelete.length; d++) {
        var toDelete = recordsToDelete[d]
        app.delete(toDelete)
      }

      var remainingCount = app.countRecords('sinistros')
      console.log(
        '[dedup_sinistros] Limpeza concluída com sucesso. Sinistros restantes no banco: ' +
          remainingCount,
      )
    } catch (err) {
      console.log('[dedup_sinistros] Erro ao executar dedup de sinistros: ' + err)
      throw err
    }
  },
  (app) => {
    // Reversão no-op: registros excluídos por deduplicação não são recriados.
  },
)
