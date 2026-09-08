import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account, Category } from './types'

export type Language = 'vi' | 'en'

type Vars = Record<string, string | number>
type Translator = (key: string, vars?: Vars) => string

const STORAGE_KEY = 'owallet.language'

const vi: Record<string, string> = {
  'app.loading': 'Đang tải kho dữ liệu mã hóa…',
  'common.add': 'Thêm',
  'common.cancel': 'Hủy',
  'common.save': 'Lưu',
  'common.copy': 'Sao chép',
  'common.copied': 'Đã sao chép',
  'common.file': 'Tệp',
  'common.all': 'Tất cả',
  'common.other': 'Khác',
  'common.none': 'Không có',
  'common.forever': 'Vĩnh viễn',
  'common.days': '{count} ngày',
  'common.on': 'Bật',
  'common.off': 'Tắt',
  'common.system': 'Theo hệ thống',
  'common.light': 'Sáng',
  'common.dark': 'Tối',
  'common.connected': 'Đã kết nối',
  'common.disconnected': 'Chưa kết nối',
  'common.language': 'Ngôn ngữ',
  'language.vi': 'Tiếng Việt',
  'language.en': 'English',

  'nav.home': 'Tổng quan',
  'nav.transactions': 'Giao dịch',
  'nav.analytics': 'Thống kê',
  'nav.settings': 'Cài đặt',
  'nav.addTransaction': 'Thêm giao dịch',
  'nav.lock': 'Khóa',
  'nav.driveConnected': 'Drive: {email}',
  'nav.driveDisconnected': 'Drive chưa kết nối',
  'nav.sync': 'Đồng bộ',

  'range.7d': '7 ngày',
  'range.30d': '30 ngày',
  'range.3m': '3 tháng',
  'range.6m': '6 tháng',
  'range.1y': '1 năm',
  'range.all': 'Tất cả',

  'transaction.expense': 'Chi',
  'transaction.income': 'Thu',
  'transaction.transfer': 'Chuyển khoản',
  'transaction.noDescription': 'Không có mô tả',

  'category.food': 'Ăn uống',
  'category.shopping': 'Mua sắm',
  'category.transport': 'Di chuyển',
  'category.bills': 'Hóa đơn',
  'category.entertainment': 'Giải trí',
  'category.health': 'Sức khỏe',
  'category.salary': 'Thu nhập',
  'category.other': 'Khác',
  'account.main': 'Ví chính',

  'securityQuestion.first-game': 'Tên trò chơi đầu tiên còn nhớ?',
  'securityQuestion.childhood-nickname': 'Biệt danh thời nhỏ còn nhớ rõ nhất?',
  'securityQuestion.first-pet': 'Tên thú cưng đầu tiên?',
  'securityQuestion.favorite-teacher': 'Tên giáo viên đáng nhớ nhất thời đi học?',
  'securityQuestion.first-trip': 'Nơi đầu tiên còn nhớ đã từng đi du lịch?',
  'securityQuestion.custom-object': 'Tên một món đồ cũ dễ ghi nhớ?',

  'onboarding.tagline': 'Trình quản lý thu chi local-first. Giao dịch, ảnh và bộ nhớ đệm được mã hóa ngay trên thiết bị; Google Drive chỉ lưu ciphertext trong dung lượng của tài khoản người dùng.',
  'onboarding.noBackend': 'Không có backend dữ liệu trung tâm.',
  'onboarding.passwordLocal': 'Mật khẩu không được tải lên máy chủ O-Wallet.',
  'onboarding.crossDevice': 'Đồng bộ nhiều thiết bị qua Google Drive của người dùng.',
  'onboarding.restore': 'Khôi phục kho dữ liệu từ Google Drive',
  'onboarding.googleClientMissing': 'Cần cấu hình VITE_GOOGLE_CLIENT_ID trước khi khôi phục hoặc đồng bộ Drive.',
  'onboarding.createTitle': 'Tạo kho dữ liệu mã hóa',
  'onboarding.createHint': 'Recovery key là bí mật khôi phục thực sự. Câu hỏi bảo mật chỉ là lớp xác minh phụ.',
  'onboarding.password': 'Mật khẩu',
  'onboarding.passwordPlaceholder': 'Ít nhất 8 ký tự',
  'onboarding.confirmPassword': 'Nhập lại mật khẩu',
  'onboarding.recoveryKey': 'Recovery key',
  'onboarding.recoveryWarning': 'Nếu mất cả mật khẩu lẫn recovery key thì dữ liệu không thể được giải mã lại.',
  'onboarding.recoverySaved': 'Đã lưu recovery key ở nơi an toàn.',
  'onboarding.securityQuestion1': 'Câu hỏi bảo mật 1',
  'onboarding.securityQuestion2': 'Câu hỏi bảo mật 2',
  'onboarding.answer': 'Câu trả lời',
  'onboarding.passwordMismatch': 'Hai mật khẩu không khớp.',
  'onboarding.questionsMustDiffer': 'Cần chọn hai câu hỏi khác nhau.',
  'onboarding.creating': 'Đang tạo…',
  'onboarding.createButton': 'Tạo kho dữ liệu O-Wallet',
  'onboarding.recoveryFileNote': 'Giữ recovery key ở nơi riêng tư. Người có recovery key và câu trả lời bảo mật có thể mở kho dữ liệu.',

  'unlock.title': 'Mở khóa O-Wallet',
  'unlock.memoryHint': 'DEK chỉ tồn tại trong bộ nhớ của tab sau khi mở khóa.',
  'unlock.unlocking': 'Đang mở…',
  'unlock.button': 'Mở khóa',
  'unlock.forgot': 'Quên mật khẩu?',
  'unlock.recovery': 'Mở bằng recovery key',
  'unlock.back': 'Quay lại mật khẩu',

  'dashboard.title': 'Tổng quan',
  'dashboard.subtitle': 'Dữ liệu được tính trực tiếp trên thiết bị.',
  'dashboard.balance': 'Tổng số dư',
  'dashboard.income': 'Thu',
  'dashboard.expense': 'Chi',
  'dashboard.net': 'Ròng',
  'dashboard.cashflow': 'Thu / chi theo thời gian',
  'dashboard.selectedRange': 'Khoảng đang chọn: {range}',
  'dashboard.noDataTitle': 'Chưa có dữ liệu',
  'dashboard.noDataText': 'Thêm giao dịch để biểu đồ bắt đầu hiển thị dữ liệu.',
  'dashboard.expenseByCategory': 'Chi theo danh mục',
  'dashboard.total': 'Tổng {value}',
  'dashboard.noExpenseTitle': 'Chưa có khoản chi',
  'dashboard.noExpenseText': 'Chưa có dữ liệu để vẽ biểu đồ tròn.',
  'dashboard.recent': 'Giao dịch gần đây',
  'dashboard.noTransactionsTitle': 'Chưa có giao dịch',
  'dashboard.noTransactionsText': 'Có thể thêm giao dịch thủ công hoặc nhập từ ảnh bằng OCR.',
  'dashboard.images': '{count} ảnh',

  'analytics.title': 'Thống kê',
  'analytics.subtitle': 'Biểu đồ được dựng trên thiết bị từ dữ liệu đã giải mã.',
  'analytics.income': 'Thu',
  'analytics.expense': 'Chi',
  'analytics.net': 'Ròng',
  'analytics.cashflow': 'Dòng tiền',
  'analytics.cashflowHint': 'Thu và chi theo từng khoảng thời gian.',
  'analytics.noDataTitle': 'Chưa có dữ liệu',
  'analytics.noDataText': 'Biểu đồ sẽ xuất hiện khi khoảng thời gian này có giao dịch.',
  'analytics.expenseMix': 'Cơ cấu chi',
  'analytics.noExpenseTitle': 'Không có khoản chi',
  'analytics.noExpenseText': 'Chưa có danh mục nào để vẽ biểu đồ tròn.',
  'analytics.topCategories': 'Danh mục chi nhiều nhất',
  'analytics.emptyTitle': 'Trống',
  'analytics.emptyText': 'Chưa có khoản chi.',

  'transactions.title': 'Giao dịch',
  'transactions.subtitle': '{count} bản ghi cục bộ đã được giải mã.',
  'transactions.search': 'Tìm người nhận, ghi chú, danh mục…',
  'transactions.allTypes': 'Tất cả loại',
  'transactions.emptyTitle': 'Không có giao dịch phù hợp',
  'transactions.emptyText': 'Thay đổi bộ lọc hoặc thêm giao dịch mới.',
  'transactions.balanceAfter': 'Sau giao dịch:',
  'transactions.imageTitle': 'Ảnh {index}',
  'transactions.deleteConfirm': 'Xóa giao dịch này? Đồng bộ sẽ tạo tombstone để các thiết bị khác cũng nhận thao tác xóa.',
  'transactions.unknownAccount': 'Tài khoản?',

  'modal.title': 'Thêm giao dịch',
  'modal.imageRetentionHint': 'Ảnh được giữ và mã hóa; thời gian lưu mặc định là vĩnh viễn.',
  'modal.amount': 'Số tiền',
  'modal.currency': 'Tiền tệ',
  'modal.time': 'Thời gian',
  'modal.category': 'Danh mục',
  'modal.account': 'Tài khoản',
  'modal.sourceAccount': 'Tài khoản nguồn',
  'modal.destinationAccount': 'Tài khoản đích',
  'modal.merchant': 'Đơn vị / người nhận',
  'modal.balanceAfter': 'Số dư sau giao dịch',
  'modal.description': 'Mô tả / nội dung chuyển khoản',
  'modal.note': 'Ghi chú',
  'modal.screenshot': 'Ảnh chụp / hóa đơn',
  'modal.ocrHint': 'OCR chạy trong trình duyệt bằng Tesseract.js; ảnh được đưa trực tiếp vào worker trên thiết bị.',
  'modal.chooseImages': 'Chọn ảnh',
  'modal.ocrFirst': 'OCR ảnh đầu tiên',
  'modal.rawOcr': 'Văn bản OCR thô',
  'modal.saving': 'Đang lưu',
  'modal.save': 'Lưu giao dịch',
  'modal.errorOcr': 'OCR thất bại.',
  'modal.errorMissingFields': 'Cần nhập số tiền, tài khoản và danh mục.',
  'modal.errorTransferAccounts': 'Tài khoản đích phải khác tài khoản nguồn.',
  'modal.errorSave': 'Không lưu được giao dịch.',

  'image.saveDecrypted': 'Lưu bản đã giải mã',
  'image.decrypting': 'Đang giải mã ảnh…',
  'image.notFound': 'Không tìm thấy ảnh.',
  'image.openError': 'Không mở được ảnh.',

  'settings.title': 'Cài đặt',
  'settings.subtitle': 'Không có backend dữ liệu riêng; Google access token chỉ được giữ trong bộ nhớ của tab.',
  'settings.driveSync': 'Đồng bộ Google Drive',
  'settings.driveHint': 'O-Wallet tạo một thư mục nhìn thấy được trong My Drive. Giao dịch và ảnh trong thư mục được lưu dưới dạng ciphertext nhị phân.',
  'settings.clientMissing': 'Chưa có VITE_GOOGLE_CLIENT_ID. Xem .env.example.',
  'settings.syncNow': 'Đồng bộ ngay',
  'settings.openDrive': 'Mở Drive',
  'settings.disconnect': 'Ngắt kết nối',
  'settings.connectGoogle': 'Kết nối Google',
  'settings.lastSync': 'Lần đồng bộ cuối: tải về {pulledRecords} bản ghi / {pulledImages} ảnh, tải lên {pushedRecords} bản ghi / {pushedImages} ảnh, xử lý {conflicts} xung đột.',
  'settings.localStorage': 'Lưu trữ mã hóa cục bộ',
  'settings.records': 'Bản ghi',
  'settings.images': 'Ảnh',
  'settings.encryptedImageBytes': 'Dung lượng ảnh mã hóa',
  'settings.theme': 'Giao diện',
  'settings.autoSync': 'Tự động đồng bộ',
  'settings.imageRetention': 'Thời gian lưu ảnh',
  'settings.keepDays': 'Số ngày giữ ảnh',
  'settings.security': 'Bảo mật',
  'settings.securityHint': 'Khóa kho dữ liệu sẽ xóa DEK khỏi React state. Ciphertext vẫn còn trong IndexedDB để mở lại nhanh.',
  'settings.lockVault': 'Khóa kho dữ liệu',
  'settings.securityQuestionsHint': 'Câu hỏi bảo mật không trực tiếp giải mã dữ liệu. Recovery key mới là bí mật dùng để mở DEK; câu hỏi chỉ là lớp xác minh phụ.',
  'settings.accounts': 'Tài khoản',
  'settings.accountsHint': 'Hỗ trợ nhiều tài khoản và chuyển khoản giữa các tài khoản.',
  'settings.accountPlaceholder': 'Tên tài khoản, ví dụ MBBank',
  'settings.openingBalance': 'Số dư ban đầu',
  'settings.categories': 'Danh mục',
  'settings.categoriesHint': 'Có thể tự tạo danh mục; các danh mục mặc định chỉ là dữ liệu khởi tạo.',
  'settings.categoryPlaceholder': 'Tên danh mục',
  'settings.kindExpense': 'Chi',
  'settings.kindIncome': 'Thu',
  'settings.kindBoth': 'Cả hai',
  'settings.deploymentNote': 'Ghi chú triển khai',
  'settings.deploymentText': 'GitHub Pages chỉ phục vụ tài nguyên tĩnh. Node/Vite/Tailwind chỉ dùng lúc build; bản production không chạy Node server.',
  'settings.privacy': 'Chính sách quyền riêng tư',
  'settings.terms': 'Điều khoản sử dụng',

  'sync.prepare': 'Đang chuẩn bị thư mục O-Wallet…',
  'sync.index': 'Đang đọc chỉ mục trên Drive…',
  'sync.records': 'Đang hợp nhất bản ghi…',
  'sync.images': 'Đang hợp nhất ảnh mã hóa…',
  'sync.done': 'Đồng bộ hoàn tất.',

  'error.createVault': 'Không tạo được kho dữ liệu.',
  'error.unlockVault': 'Không mở được kho dữ liệu.',
  'error.recoveryFailed': 'Khôi phục thất bại.',
  'error.googleConnect': 'Không kết nối được Google.',
  'error.restoreVault': 'Không khôi phục được cấu hình kho dữ liệu.',
  'error.tokenExpired': 'Google access token đã hết hạn. Hãy kết nối lại Google rồi đồng bộ.',
  'error.syncFailed': 'Đồng bộ thất bại.',
  'error.vaultLocked': 'Kho dữ liệu đang khóa.',
  'error.passwordTooShort': 'Mật khẩu phải có ít nhất 8 ký tự.',
  'error.securityQuestionsRequired': 'Cần ít nhất 2 câu hỏi bảo mật có câu trả lời.',
  'error.wrongPassword': 'Mật khẩu không đúng.',
  'error.missingSecurityAnswers': 'Thiếu câu trả lời bảo mật.',
  'error.wrongSecurityAnswer': 'Câu trả lời bảo mật không đúng.',
  'error.wrongRecoveryKey': 'Recovery key không đúng.',
  'error.googleScriptLoad': 'Không tải được Google Identity Services.',
  'error.googleProfile': 'Không đọc được hồ sơ Google.',
  'error.googleClientMissing': 'Chưa cấu hình VITE_GOOGLE_CLIENT_ID.',
  'error.googleNotReady': 'Google Identity Services chưa sẵn sàng.',
  'error.googleAuthorization': 'Ủy quyền Google thất bại hoặc đã bị đóng.',
  'error.driveDownload': 'Không tải được tệp từ Google Drive.',
  'error.invalidDriveRecord': 'Dữ liệu đồng bộ trên Drive thiếu metadata O-Wallet hợp lệ.',
  'error.corruptImage': 'Payload ảnh mã hóa bị hỏng hoặc không hợp lệ.',
}

const en: Record<string, string> = {
  'app.loading': 'Loading encrypted vault…',
  'common.add': 'Add',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.file': 'File',
  'common.all': 'All',
  'common.other': 'Other',
  'common.none': 'None',
  'common.forever': 'Forever',
  'common.days': '{count} days',
  'common.on': 'On',
  'common.off': 'Off',
  'common.system': 'System',
  'common.light': 'Light',
  'common.dark': 'Dark',
  'common.connected': 'Connected',
  'common.disconnected': 'Disconnected',
  'common.language': 'Language',
  'language.vi': 'Tiếng Việt',
  'language.en': 'English',

  'nav.home': 'Home',
  'nav.transactions': 'Transactions',
  'nav.analytics': 'Analytics',
  'nav.settings': 'Settings',
  'nav.addTransaction': 'Add transaction',
  'nav.lock': 'Lock',
  'nav.driveConnected': 'Drive: {email}',
  'nav.driveDisconnected': 'Drive not connected',
  'nav.sync': 'Sync',

  'range.7d': '7 days',
  'range.30d': '30 days',
  'range.3m': '3 months',
  'range.6m': '6 months',
  'range.1y': '1 year',
  'range.all': 'All',

  'transaction.expense': 'Expense',
  'transaction.income': 'Income',
  'transaction.transfer': 'Transfer',
  'transaction.noDescription': 'No description',

  'category.food': 'Food',
  'category.shopping': 'Shopping',
  'category.transport': 'Transport',
  'category.bills': 'Bills',
  'category.entertainment': 'Entertainment',
  'category.health': 'Health',
  'category.salary': 'Income',
  'category.other': 'Other',
  'account.main': 'Main wallet',

  'securityQuestion.first-game': 'What is the first game you remember playing?',
  'securityQuestion.childhood-nickname': 'What childhood nickname do you remember best?',
  'securityQuestion.first-pet': 'What was the name of your first pet?',
  'securityQuestion.favorite-teacher': 'Which teacher do you remember most from school?',
  'securityQuestion.first-trip': 'What is the first place you remember traveling to?',
  'securityQuestion.custom-object': 'What is the name of an old object you can easily remember?',

  'onboarding.tagline': 'A local-first expense tracker. Transactions, images and cache are encrypted on the device; Google Drive stores only ciphertext in the user’s own quota.',
  'onboarding.noBackend': 'No central data backend.',
  'onboarding.passwordLocal': 'The password is never uploaded to an O-Wallet server.',
  'onboarding.crossDevice': 'Cross-device sync through the user’s Google Drive.',
  'onboarding.restore': 'Restore vault from Google Drive',
  'onboarding.googleClientMissing': 'VITE_GOOGLE_CLIENT_ID must be configured before Drive restore or sync.',
  'onboarding.createTitle': 'Create encrypted vault',
  'onboarding.createHint': 'The recovery key is the real cryptographic recovery secret. Security questions are only an additional verification layer.',
  'onboarding.password': 'Password',
  'onboarding.passwordPlaceholder': 'At least 8 characters',
  'onboarding.confirmPassword': 'Confirm password',
  'onboarding.recoveryKey': 'Recovery key',
  'onboarding.recoveryWarning': 'If both the password and recovery key are lost, the data cannot be decrypted again.',
  'onboarding.recoverySaved': 'I saved the recovery key in a safe place.',
  'onboarding.securityQuestion1': 'Security question 1',
  'onboarding.securityQuestion2': 'Security question 2',
  'onboarding.answer': 'Answer',
  'onboarding.passwordMismatch': 'The passwords do not match.',
  'onboarding.questionsMustDiffer': 'Choose two different security questions.',
  'onboarding.creating': 'Creating…',
  'onboarding.createButton': 'Create O-Wallet vault',
  'onboarding.recoveryFileNote': 'Keep this recovery key private. Anyone with the recovery key and the configured security answers can unlock the vault.',

  'unlock.title': 'Unlock O-Wallet',
  'unlock.memoryHint': 'The DEK exists only in this tab’s memory after unlock.',
  'unlock.unlocking': 'Unlocking…',
  'unlock.button': 'Unlock',
  'unlock.forgot': 'Forgot password?',
  'unlock.recovery': 'Recovery unlock',
  'unlock.back': 'Back to password',

  'dashboard.title': 'Overview',
  'dashboard.subtitle': 'Data is calculated directly on this device.',
  'dashboard.balance': 'Total balance',
  'dashboard.income': 'Income',
  'dashboard.expense': 'Expense',
  'dashboard.net': 'Net',
  'dashboard.cashflow': 'Income / expense over time',
  'dashboard.selectedRange': 'Selected range: {range}',
  'dashboard.noDataTitle': 'No data yet',
  'dashboard.noDataText': 'Add a transaction to start populating the chart.',
  'dashboard.expenseByCategory': 'Expense by category',
  'dashboard.total': 'Total {value}',
  'dashboard.noExpenseTitle': 'No expenses yet',
  'dashboard.noExpenseText': 'There is no data for the pie chart yet.',
  'dashboard.recent': 'Recent transactions',
  'dashboard.noTransactionsTitle': 'No transactions yet',
  'dashboard.noTransactionsText': 'Add a transaction manually or import one from an image with OCR.',
  'dashboard.images': '{count} images',

  'analytics.title': 'Analytics',
  'analytics.subtitle': 'Charts are rendered on-device from decrypted data.',
  'analytics.income': 'Income',
  'analytics.expense': 'Expense',
  'analytics.net': 'Net',
  'analytics.cashflow': 'Cash flow',
  'analytics.cashflowHint': 'Income and expense grouped by time bucket.',
  'analytics.noDataTitle': 'No data',
  'analytics.noDataText': 'The chart will appear when this range contains transactions.',
  'analytics.expenseMix': 'Expense mix',
  'analytics.noExpenseTitle': 'No expenses',
  'analytics.noExpenseText': 'There are no categories to draw in the pie chart.',
  'analytics.topCategories': 'Top categories',
  'analytics.emptyTitle': 'Empty',
  'analytics.emptyText': 'No expenses yet.',

  'transactions.title': 'Transactions',
  'transactions.subtitle': '{count} decrypted local records.',
  'transactions.search': 'Search merchant, note, category…',
  'transactions.allTypes': 'All types',
  'transactions.emptyTitle': 'No matching transactions',
  'transactions.emptyText': 'Change the filter or add a new transaction.',
  'transactions.balanceAfter': 'After transaction:',
  'transactions.imageTitle': 'Image {index}',
  'transactions.deleteConfirm': 'Delete this transaction? Sync will create a tombstone so other devices receive the deletion.',
  'transactions.unknownAccount': 'Account?',

  'modal.title': 'Add transaction',
  'modal.imageRetentionHint': 'Images are retained and encrypted; the default retention is forever.',
  'modal.amount': 'Amount',
  'modal.currency': 'Currency',
  'modal.time': 'Time',
  'modal.category': 'Category',
  'modal.account': 'Account',
  'modal.sourceAccount': 'Source account',
  'modal.destinationAccount': 'Destination account',
  'modal.merchant': 'Merchant / recipient',
  'modal.balanceAfter': 'Balance after transaction',
  'modal.description': 'Description / transfer message',
  'modal.note': 'Note',
  'modal.screenshot': 'Screenshot / receipt',
  'modal.ocrHint': 'OCR runs in the browser with Tesseract.js; the image is passed directly to a worker on the device.',
  'modal.chooseImages': 'Choose images',
  'modal.ocrFirst': 'OCR first image',
  'modal.rawOcr': 'Raw OCR text',
  'modal.saving': 'Saving',
  'modal.save': 'Save transaction',
  'modal.errorOcr': 'OCR failed.',
  'modal.errorMissingFields': 'Amount, account and category are required.',
  'modal.errorTransferAccounts': 'The destination account must differ from the source account.',
  'modal.errorSave': 'Could not save the transaction.',

  'image.saveDecrypted': 'Save decrypted copy',
  'image.decrypting': 'Decrypting image…',
  'image.notFound': 'Image not found.',
  'image.openError': 'Could not open the image.',

  'settings.title': 'Settings',
  'settings.subtitle': 'There is no O-Wallet data backend; the Google access token is held only in this tab’s memory.',
  'settings.driveSync': 'Google Drive sync',
  'settings.driveHint': 'O-Wallet creates a visible folder in My Drive. Transactions and images in that folder are stored as binary ciphertext.',
  'settings.clientMissing': 'VITE_GOOGLE_CLIENT_ID is not configured. See .env.example.',
  'settings.syncNow': 'Sync now',
  'settings.openDrive': 'Open Drive',
  'settings.disconnect': 'Disconnect',
  'settings.connectGoogle': 'Connect Google',
  'settings.lastSync': 'Last sync: pulled {pulledRecords} records / {pulledImages} images, pushed {pushedRecords} records / {pushedImages} images, resolved {conflicts} conflicts.',
  'settings.localStorage': 'Local encrypted storage',
  'settings.records': 'Records',
  'settings.images': 'Images',
  'settings.encryptedImageBytes': 'Encrypted image bytes',
  'settings.theme': 'Theme',
  'settings.autoSync': 'Auto sync',
  'settings.imageRetention': 'Image retention',
  'settings.keepDays': 'Days to keep images',
  'settings.security': 'Security',
  'settings.securityHint': 'Locking the vault removes the DEK from React state. Ciphertext remains in IndexedDB for fast reopening.',
  'settings.lockVault': 'Lock vault',
  'settings.securityQuestionsHint': 'Security questions do not decrypt data directly. The recovery key is the secret used to unwrap the DEK; the questions are only an additional verification layer.',
  'settings.accounts': 'Accounts',
  'settings.accountsHint': 'Multiple accounts and transfers between accounts are supported.',
  'settings.accountPlaceholder': 'Account name, e.g. MBBank',
  'settings.openingBalance': 'Opening balance',
  'settings.categories': 'Categories',
  'settings.categoriesHint': 'Categories are user-defined; defaults are only initial seed data.',
  'settings.categoryPlaceholder': 'Category name',
  'settings.kindExpense': 'Expense',
  'settings.kindIncome': 'Income',
  'settings.kindBoth': 'Both',
  'settings.deploymentNote': 'Deployment note',
  'settings.deploymentText': 'GitHub Pages serves static assets only. Node/Vite/Tailwind are build-time tools; production runs no Node server.',
  'settings.privacy': 'Privacy policy',
  'settings.terms': 'Terms of service',

  'sync.prepare': 'Preparing the O-Wallet folder…',
  'sync.index': 'Reading the Drive index…',
  'sync.records': 'Merging records…',
  'sync.images': 'Merging encrypted images…',
  'sync.done': 'Sync complete.',

  'error.createVault': 'Could not create the vault.',
  'error.unlockVault': 'Could not unlock the vault.',
  'error.recoveryFailed': 'Recovery failed.',
  'error.googleConnect': 'Could not connect to Google.',
  'error.restoreVault': 'Could not restore the vault configuration.',
  'error.tokenExpired': 'The Google access token expired. Reconnect Google and sync again.',
  'error.syncFailed': 'Sync failed.',
  'error.vaultLocked': 'The vault is locked.',
  'error.passwordTooShort': 'The password must contain at least 8 characters.',
  'error.securityQuestionsRequired': 'At least 2 answered security questions are required.',
  'error.wrongPassword': 'Incorrect password.',
  'error.missingSecurityAnswers': 'Security question answers are missing.',
  'error.wrongSecurityAnswer': 'A security question answer is incorrect.',
  'error.wrongRecoveryKey': 'Incorrect recovery key.',
  'error.googleScriptLoad': 'Could not load Google Identity Services.',
  'error.googleProfile': 'Could not read the Google profile.',
  'error.googleClientMissing': 'VITE_GOOGLE_CLIENT_ID is not configured.',
  'error.googleNotReady': 'Google Identity Services is not ready.',
  'error.googleAuthorization': 'Google authorization failed or was closed.',
  'error.driveDownload': 'Could not download the file from Google Drive.',
  'error.invalidDriveRecord': 'The synced Drive data is missing valid O-Wallet metadata.',
  'error.corruptImage': 'The encrypted image payload is corrupted or invalid.',
}

const dictionaries = { vi, en }

interface I18nContextValue {
  language: Language
  locale: string
  setLanguage: (language: Language) => void
  t: Translator
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'vi' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nContextValue>(() => {
    const t: Translator = (key, vars) => {
      let text = dictionaries[language][key] ?? dictionaries.en[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    }
    return {
      language,
      locale: language === 'vi' ? 'vi-VN' : 'en-US',
      setLanguage: (next) => setLanguageState(next),
      t,
    }
  }, [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}

const DEFAULT_CATEGORY_KEYS: Record<string, string> = {
  food: 'category.food',
  shopping: 'category.shopping',
  transport: 'category.transport',
  bills: 'category.bills',
  entertainment: 'category.entertainment',
  health: 'category.health',
  salary: 'category.salary',
  other: 'category.other',
}

export function categoryDisplayName(category: Category, t: Translator) {
  const key = DEFAULT_CATEGORY_KEYS[category.id]
  return key ? t(key) : category.name
}

export function questionLabel(questionId: string, t: Translator) {
  return t(`securityQuestion.${questionId}`)
}

export function accountDisplayName(account: Account, t: Translator) {
  return account.name === 'Ví chính' || account.name === 'Main wallet' ? t('account.main') : account.name
}

export function localizeError(error: unknown, t: Translator, fallbackKey: string) {
  if (!(error instanceof Error)) return t(fallbackKey)
  return error.message.startsWith('error.') ? t(error.message) : error.message
}
