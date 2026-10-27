const fallbackMessage = 'Não foi possível concluir a operação. Tente novamente.'

// Only locally authored messages should use this path. Server text needs an allowlist.
export function userMessage(value: unknown, fallback = fallbackMessage): string {
  const message = typeof value === 'string' ? value : value instanceof Error ? value.message : ''
  if (!message.trim()) return fallback
  if (/\b(?:prisma\w*|bcrypt|jwt|sql|select\s|insert\s|update\s|delete\s|postgres\w*|TypeError|ReferenceError|SyntaxError|stack\s*trace|ECONN\w*|ENOTFOUND)\b|\n\s*at\s|https?:\/\/|[A-Z]:\\|node_modules|^\w*Error:/i.test(message)) return fallback
  if (/\bbytes?\b/i.test(message)) return /senha|password/i.test(message) ? 'A senha informada é muito longa.' : 'O valor informado é muito longo.'
  if (/caracteres nulos/i.test(message)) return 'Revise o texto informado e remova caracteres inválidos.'
  return message
}

const eligibilityMessages = new Map([
  ['Leilão LEGACY ou sem geração temporal válida: operação bloqueada. Histórico disponível para consulta.', 'Este leilão está disponível apenas para consulta do histórico e não recebe lances.'],
  ['Não é permitido dar lance no próprio leilão ou veículo.', 'Você não pode dar lances no seu próprio leilão ou veículo.'],
  ['Saldo disponível insuficiente para o próximo lance.', 'Saldo disponível insuficiente para o próximo lance.'],
  ['Lance abaixo do valor inicial ou do incremento mínimo.', 'O lance está abaixo do mínimo atual. Atualize e revise o valor.'],
  ['Lote com configuração financeira inconsistente.', 'Este lote precisa ser revisado pelo leiloeiro antes de receber lances.'],
  ['Limite monetário atingido.', 'Este lote atingiu o limite de valor permitido para lances.'],
  ['Leilão e lote devem estar abertos e dentro do período de lances.', 'Este lote não está disponível para lances neste momento.'],
  ['Somente participantes podem enviar lances.', 'Somente contas de participante podem enviar lances.'],
  ['Lote não encontrado.', 'Lote não encontrado.'],
])

export function eligibilityMessage(value: string): string {
  return eligibilityMessages.get(value) ?? 'Não é possível participar deste lote agora. Atualize os dados para verificar a disponibilidade.'
}
