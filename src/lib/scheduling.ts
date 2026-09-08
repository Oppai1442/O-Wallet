import type { Transaction } from '../types'

export function localDateKeyFromInputDateTime(value: string) {
  return value.slice(0, 10)
}

export function localTimeFromInputDateTime(value: string) {
  return value.slice(11, 16) || '00:00'
}

export function combineLocalDateAndTime(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time || '00:00'}:00`).toISOString()
}

export function localWeekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).getDay()
}

export function recurringDateKeys(startDate: string, endDate: string, weekdays: number[]) {
  if (!startDate || !endDate || endDate < startDate || weekdays.length === 0) return []
  const wanted = new Set(weekdays)
  const cursor = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  const result: string[] = []

  while (cursor.getTime() <= end.getTime()) {
    if (wanted.has(cursor.getDay())) {
      const year = cursor.getFullYear()
      const month = String(cursor.getMonth() + 1).padStart(2, '0')
      const day = String(cursor.getDate()).padStart(2, '0')
      result.push(`${year}-${month}-${day}`)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

export function isFutureTransaction(transaction: Transaction, now = Date.now()) {
  return new Date(transaction.occurredAt).getTime() > now
}

export function effectiveTransactions(transactions: Transaction[], now = Date.now()) {
  return transactions.filter((transaction) => !transaction.deleted && !isFutureTransaction(transaction, now))
}
