import type { Category } from './types'

export const APP_NAME = 'O-Wallet'
export const DRIVE_ROOT_NAME = 'O-Wallet'
export const VAULT_FILE_NAME = 'vault.json'
export const RECORDS_FOLDER_NAME = 'records'
export const IMAGES_FOLDER_NAME = 'images'

export const SECURITY_QUESTIONS = [
  { id: 'first-game' },
  { id: 'childhood-nickname' },
  { id: 'first-pet' },
  { id: 'favorite-teacher' },
  { id: 'first-trip' },
  { id: 'custom-object' },
] as const

const now = () => new Date().toISOString()

export const DEFAULT_CATEGORIES: Category[] = [
  ['food', 'Ăn uống', 'Utensils', 'expense'],
  ['shopping', 'Mua sắm', 'ShoppingBag', 'expense'],
  ['transport', 'Di chuyển', 'Car', 'expense'],
  ['bills', 'Hóa đơn', 'ReceiptText', 'expense'],
  ['entertainment', 'Giải trí', 'Gamepad2', 'expense'],
  ['health', 'Sức khỏe', 'HeartPulse', 'expense'],
  ['salary', 'Thu nhập', 'WalletCards', 'income'],
  ['other', 'Khác', 'Shapes', 'both'],
].map(([id, name, icon, kind]) => ({
  id: id as string,
  name: name as string,
  icon: icon as string,
  kind: kind as Category['kind'],
  archived: false,
  createdAt: now(),
  updatedAt: now(),
  deleted: false,
}))
