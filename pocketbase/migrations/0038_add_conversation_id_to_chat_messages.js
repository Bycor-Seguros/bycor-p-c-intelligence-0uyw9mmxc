/**
 * Migration 0038 — Persistência do histórico de chat.
 *
 * A coleção chat_messages (já existente) passa a guardar também o
 * conversation_id do thread do agente nativo 'assistente-bycor', para que o
 * frontend possa retomar a mesma conversa após F5/navegação. Cada registro
 * guarda uma mensagem (role user|assistant) vinculada ao usuário logado; o
 * conversation_id é repetido nas mensagens do thread.
 */
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('chat_messages')

    if (!col.fields.getByName('conversation_id')) {
      col.fields.add(new TextField({ name: 'conversation_id', max: 255 }))
    }

    // Índice para carregar o histórico do usuário em ordem cronológica.
    col.addIndex('idx_chat_messages_user_created', false, 'user', 'created')

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('chat_messages')
    col.removeIndex('idx_chat_messages_user_created')
    const field = col.fields.getByName('conversation_id')
    if (field) {
      col.fields.removeByName('conversation_id')
    }
    app.save(col)
  },
)
