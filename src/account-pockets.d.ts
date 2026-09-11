import './types'

declare module './types' {
  interface Account {
    /** Multi-currency pockets. Missing on legacy accounts, which fall back to `currency`. */
    currencies?: string[]
    /** Opening balance per currency pocket. Missing on legacy accounts, which fall back to `openingBalance`. */
    openingBalances?: Record<string, number>
  }

  interface Transaction {
    /** Destination-side amount for transfers. Missing on legacy same-currency transfers. */
    destinationAmount?: number
    /** Destination-side currency for transfers. Missing on legacy same-currency transfers. */
    destinationCurrency?: string
  }
}
