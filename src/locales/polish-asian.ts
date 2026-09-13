import type { UiLanguage } from './index'

type Pack = Record<string, string>

export const ASIAN_POLISH: Partial<Record<UiLanguage, Pack>> = {
  ja: {
    'view.native':'元の通貨','view.convertTo':'{currency} に換算',
    'fx.nativeHint':'通貨ごとの金額をそのまま保持し、グラフは1通貨ずつ表示します。','fx.convertedMonthHint':'保存済みの為替レートを使って今月分を {currency} で表示します。元データは変更されません。','fx.missingTransactions':'{count}件の取引には {currency} への保存済み為替レートがないため、換算表示には含まれていません。',
    'analytics.previousMonth':'前の月','analytics.nextMonth':'次の月','analytics.monthlyAnalysis':'月別分析','analytics.backCurrent':'今月に戻る','analytics.calendarTitle':'収支カレンダー','analytics.dailyDetail':'{month}の日別内訳','analytics.incomeMix':'収入の内訳','analytics.noIncomeTitle':'収入はありません','analytics.noIncomeText':'この月には、選択中の通貨で記録された収入がありません。','analytics.txShort':'件',
    'categories.roleLabel':'カテゴリの種類','categories.roleGroup':'カテゴリグループ','categories.roleGroupHint':'子カテゴリを整理するためのグループです。取引には直接指定できません。','categories.roleItem':'取引カテゴリ','categories.roleItemHint':'収入や支出を記録するときに選択できる実際のカテゴリです。'
  },
  'zh-CN': {
    'view.native':'原币种','view.convertTo':'换算为 {currency}',
    'fx.nativeHint':'各币种保持原值分开显示；图表一次分析一种币种。','fx.convertedMonthHint':'本月使用已保存的汇率换算为 {currency} 显示，原始数据不会改变。','fx.missingTransactions':'有 {count} 笔交易没有保存到 {currency} 的汇率，因此未计入换算视图。',
    'analytics.previousMonth':'上个月','analytics.nextMonth':'下个月','analytics.monthlyAnalysis':'按月分析','analytics.backCurrent':'回到本月','analytics.calendarTitle':'收支日历','analytics.dailyDetail':'{month}每日明细','analytics.incomeMix':'收入构成','analytics.noIncomeTitle':'暂无收入','analytics.noIncomeText':'本月在当前币种下没有收入交易。','analytics.txShort':'笔',
    'categories.roleLabel':'类别类型','categories.roleGroup':'类别组','categories.roleGroupHint':'用于整理子类别，不能直接分配给交易。','categories.roleItem':'交易类别','categories.roleItemHint':'记录收入或支出时可以直接选择的类别。'
  },
  'zh-TW': {
    'view.native':'原幣別','view.convertTo':'換算為 {currency}',
    'fx.nativeHint':'各幣別保留原值並分開顯示；圖表一次分析一種幣別。','fx.convertedMonthHint':'本月使用已儲存的匯率換算為 {currency} 顯示，原始資料不會變更。','fx.missingTransactions':'有 {count} 筆交易沒有儲存換算為 {currency} 的匯率，因此未計入換算檢視。',
    'analytics.previousMonth':'上個月','analytics.nextMonth':'下個月','analytics.monthlyAnalysis':'按月分析','analytics.backCurrent':'回到本月','analytics.calendarTitle':'收支月曆','analytics.dailyDetail':'{month}每日明細','analytics.incomeMix':'收入組成','analytics.noIncomeTitle':'尚無收入','analytics.noIncomeText':'本月在目前幣別下沒有收入交易。','analytics.txShort':'筆',
    'categories.roleLabel':'分類類型','categories.roleGroup':'分類群組','categories.roleGroupHint':'用來整理子分類，不能直接指定給交易。','categories.roleItem':'交易分類','categories.roleItemHint':'記錄收入或支出時可以直接選擇的分類。'
  },
  th: {
    'view.native':'สกุลเงินเดิม','view.convertTo':'แปลงเป็น {currency}',
    'fx.nativeHint':'เก็บแต่ละสกุลเงินแยกกันตามค่าจริง และกราฟจะแสดงทีละสกุลเงิน','fx.convertedMonthHint':'แสดงเดือนนี้เป็น {currency} โดยใช้อัตราแลกเปลี่ยนที่บันทึกไว้ ข้อมูลต้นฉบับไม่เปลี่ยน','fx.missingTransactions':'มี {count} รายการที่ไม่มีอัตราแลกเปลี่ยนที่บันทึกไว้เป็น {currency} จึงไม่ถูกรวมในมุมมองแบบแปลงสกุลเงิน',
    'analytics.previousMonth':'เดือนก่อน','analytics.nextMonth':'เดือนถัดไป','analytics.monthlyAnalysis':'วิเคราะห์รายเดือน','analytics.backCurrent':'กลับไปเดือนปัจจุบัน','analytics.calendarTitle':'ปฏิทินรายรับ–รายจ่าย','analytics.dailyDetail':'รายละเอียดรายวันของ {month}','analytics.incomeMix':'สัดส่วนรายรับ','analytics.noIncomeTitle':'ยังไม่มีรายรับ','analytics.noIncomeText':'เดือนนี้ไม่มีรายการรายรับในสกุลเงินที่เลือก','analytics.txShort':'รายการ',
    'categories.roleLabel':'ประเภทหมวดหมู่','categories.roleGroup':'กลุ่มหมวดหมู่','categories.roleGroupHint':'ใช้จัดกลุ่มหมวดหมู่ย่อย และไม่สามารถเลือกให้รายการโดยตรงได้','categories.roleItem':'หมวดหมู่รายการ','categories.roleItemHint':'หมวดหมู่ที่เลือกได้เมื่อลงรายรับหรือรายจ่าย'
  }
}
