import type { ParsedTransactionCandidate, TransactionRule, TransactionType } from '../types'

function normalize(value?: string) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/đ/g, 'd')
    .trim()
}

export interface RuleCandidate {
  type: TransactionType
  amount?: number
  merchant?: string
  description?: string
}

export function matchesTransactionRule(candidate: RuleCandidate, rule: TransactionRule) {
  if (!rule.enabled) return false
  if (rule.transactionType && rule.transactionType !== candidate.type) return false
  if (rule.amountEquals !== undefined) {
    if (candidate.amount === undefined || Math.abs(candidate.amount - rule.amountEquals) > 0.005) return false
  }
  if (rule.merchantContains) {
    const needle = normalize(rule.merchantContains)
    if (!needle || !normalize(candidate.merchant).includes(needle)) return false
  }
  if (rule.descriptionContains) {
    const needle = normalize(rule.descriptionContains)
    if (!needle || !normalize(candidate.description).includes(needle)) return false
  }
  return Boolean(rule.merchantContains || rule.descriptionContains || rule.amountEquals !== undefined || rule.transactionType)
}

export function findMatchingTransactionRule(candidate: RuleCandidate, rules: TransactionRule[] = []) {
  return rules.find((rule) => matchesTransactionRule(candidate, rule))
}

export function applyRuleToParsedCandidate(parsed: ParsedTransactionCandidate, rules: TransactionRule[] = []) {
  const rule = findMatchingTransactionRule({
    type: parsed.type,
    amount: parsed.amount,
    merchant: parsed.merchant,
    description: parsed.description,
  }, rules)
  return { rule, categoryId: rule?.categoryId, accountId: rule?.accountId }
}
