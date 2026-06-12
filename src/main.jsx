import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { StoreProvider } from './context/StoreContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import App from './App.jsx'
import SignUp from './pages/SignUp.jsx'
import SignIn from './pages/SignIn.jsx'
import SalesMovements from './pages/SalesMovements.jsx'
import OnlineOrdersPage from './pages/OnlineOrdersPage.jsx'
import CustomersSuppliers from './pages/CustomersSuppliers.jsx'
import CustomerProfilePage from './pages/CustomerProfilePage.jsx'
import CustomerCRMPage from './pages/CustomerCRMPage.jsx'
import DebtLedgerPage from './pages/DebtLedgerPage.jsx'
import PurchasesPage from './pages/PurchasesPage.jsx'
import PurchaseInvoiceLinesPage from './pages/PurchaseInvoiceLinesPage.jsx'
import PurchaseHistoryPage from './pages/PurchaseHistoryPage.jsx'
import SupplierAccountStatementPage from './pages/SupplierAccountStatementPage.jsx'
import CustomerAccountStatementPage from './pages/CustomerAccountStatementPage.jsx'
import StockLogsPage from './pages/StockLogsPage.jsx'
import StockTransferPage from './pages/StockTransferPage.jsx'
import ProfitReportsPage from './pages/ProfitReportsPage.jsx'
import CashFlowPage from './pages/CashFlowPage.jsx'
import FinancialOverviewPage from './pages/FinancialOverviewPage.jsx'
import FinancialCenterPage from './pages/FinancialCenterPage.jsx'
import FundAccountsPage from './pages/FundAccountsPage.jsx'
import JournalEntriesPage from './pages/JournalEntriesPage.jsx'
import TrialBalancePage from './pages/TrialBalancePage.jsx'
import ActivityLogPage from './pages/ActivityLogPage.jsx'
import DebtAgingReportPage from './pages/DebtAgingReportPage.jsx'
import PromotionsAdminPage from './pages/PromotionsAdminPage.jsx'
import ServiceCenterPage from './pages/ServiceCenterPage.jsx'
import POSPage from './pages/POSPage.jsx'
import PreOrdersPage from './pages/PreOrdersPage.jsx'
import QuickInventoryPage from './pages/QuickInventoryPage.jsx'
import VoucherPage from './components/VoucherPage.jsx'
import ChecksPage from './pages/ChecksPage.jsx'
import WarehouseLocationsPage from './pages/WarehouseLocationsPage.jsx'
import PurchaseRfqPage from './pages/PurchaseRfqPage.jsx'
import PurchasePriceHistoryPage from './pages/PurchasePriceHistoryPage.jsx'
import PublicStoreLanding from './pages/PublicStoreLanding.jsx'
import PublicStorePage from './pages/PublicStorePage.jsx'
import StorefrontSettingsPage from './pages/StorefrontSettingsPage.jsx'
import StoreStatsPage from './pages/StoreStatsPage.jsx'
import SubscriptionPlanPage from './pages/SubscriptionPlanPage.jsx'
import SystemSettingsPage from './pages/SystemSettingsPage.jsx'
import IntegrationsPage from './pages/IntegrationsPage.jsx'
import ExecutiveDashboardPage from './pages/ExecutiveDashboardPage.jsx'
import AlertsPage from './pages/AlertsPage.jsx'
import AnalyticsReportsPage from './pages/AnalyticsReportsPage.jsx'
import EndOfDayReportPage from './pages/EndOfDayReportPage.jsx'
import LowStockPage from './pages/LowStockPage.jsx'
import IncomeStatementPage from './pages/IncomeStatementPage.jsx'
import EntitlementGuard from './components/EntitlementGuard.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import './index.css'
import { initThemeOnBoot } from './lib/theme.js'
import { migrateLegacyStorageKeys } from './lib/storageMigration.js'

migrateLegacyStorageKeys();
initThemeOnBoot();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
      <StoreProvider>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/" element={<PublicStoreLanding />} />
          <Route element={<RequireAuth />}>
          <Route path="/overview" element={<ExecutiveDashboardPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/inventory" element={<App />} />
          <Route path="/inventory/logs" element={<EntitlementGuard module="inventory_logs"><StockLogsPage /></EntitlementGuard>} />
          <Route path="/inventory/low-stock" element={<LowStockPage />} />
          <Route path="/inventory/transfers" element={<EntitlementGuard module="stock_transfers"><StockTransferPage /></EntitlementGuard>} />
          <Route path="/inventory/locations" element={<EntitlementGuard module="warehouse_locations"><WarehouseLocationsPage /></EntitlementGuard>} />
          <Route path="/warehouse/quick" element={<EntitlementGuard module="quick_inventory"><QuickInventoryPage /></EntitlementGuard>} />
          <Route path="/reports/profit" element={<EntitlementGuard module="profit_reports"><ProfitReportsPage /></EntitlementGuard>} />
          <Route path="/reports/analytics" element={<EntitlementGuard module="profit_reports"><AnalyticsReportsPage /></EntitlementGuard>} />
          <Route path="/reports/eod" element={<EntitlementGuard module="sales_movements"><EndOfDayReportPage /></EntitlementGuard>} />
          <Route path="/finance/center" element={<EntitlementGuard module="financial_center"><FinancialCenterPage /></EntitlementGuard>} />
          <Route path="/finance/funds" element={<EntitlementGuard module="funds"><FundAccountsPage /></EntitlementGuard>} />
          <Route path="/finance/journal" element={<EntitlementGuard module="journal_entries"><JournalEntriesPage /></EntitlementGuard>} />
          <Route path="/finance/trial-balance" element={<EntitlementGuard module="trial_balance"><TrialBalancePage /></EntitlementGuard>} />
          <Route path="/finance/activity-log" element={<EntitlementGuard module="activity_log"><ActivityLogPage /></EntitlementGuard>} />
          <Route path="/finance" element={<EntitlementGuard module="finance_overview"><FinancialOverviewPage /></EntitlementGuard>} />
          <Route path="/finance/cashflow" element={<EntitlementGuard module="finance_overview"><CashFlowPage /></EntitlementGuard>} />
          <Route path="/finance/income-statement" element={<EntitlementGuard module="finance_overview"><IncomeStatementPage /></EntitlementGuard>} />
          <Route path="/finance/debt-aging" element={<EntitlementGuard module="debt_aging"><DebtAgingReportPage /></EntitlementGuard>} />
          <Route path="/promotions" element={<EntitlementGuard module="promotions"><PromotionsAdminPage /></EntitlementGuard>} />
          <Route path="/service/warranty" element={<EntitlementGuard module="service_warranty"><ServiceCenterPage /></EntitlementGuard>} />
          <Route path="/service/tickets" element={<EntitlementGuard module="service_warranty"><ServiceCenterPage /></EntitlementGuard>} />
          <Route path="/pos" element={<EntitlementGuard module="pos"><POSPage /></EntitlementGuard>} />
          <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
          <Route path="/sales" element={<EntitlementGuard module="sales_movements"><SalesMovements /></EntitlementGuard>} />
          <Route path="/online-orders" element={<OnlineOrdersPage />} />
          <Route path="/store-stats" element={<StoreStatsPage />} />
          <Route path="/sales/preorders" element={<EntitlementGuard module="preorders"><PreOrdersPage /></EntitlementGuard>} />
          <Route path="/purchases/lines" element={<EntitlementGuard module="purchase_lines"><PurchaseInvoiceLinesPage /></EntitlementGuard>} />
          <Route path="/purchases/history" element={<EntitlementGuard module="purchase_history"><PurchaseHistoryPage /></EntitlementGuard>} />
          <Route path="/purchases/supplier-statement" element={<EntitlementGuard module="supplier_statement"><SupplierAccountStatementPage /></EntitlementGuard>} />
          <Route path="/sales/customer-statement" element={<EntitlementGuard module="customer_statement"><CustomerAccountStatementPage /></EntitlementGuard>} />
          <Route path="/vouchers" element={<EntitlementGuard module="vouchers"><VoucherPage /></EntitlementGuard>} />
          <Route path="/finance/checks" element={<EntitlementGuard module="checks"><ChecksPage /></EntitlementGuard>} />
          <Route path="/purchases/rfq" element={<EntitlementGuard module="purchase_rfq"><PurchaseRfqPage /></EntitlementGuard>} />
          <Route path="/purchases/price-history" element={<EntitlementGuard module="purchase_price_history"><PurchasePriceHistoryPage /></EntitlementGuard>} />
          <Route path="/purchases" element={<EntitlementGuard module="purchases"><PurchasesPage /></EntitlementGuard>} />
          <Route path="/customers/debt" element={<EntitlementGuard module="debt_ledger"><DebtLedgerPage /></EntitlementGuard>} />
          <Route path="/customers/crm" element={<EntitlementGuard module="customers"><CustomerCRMPage /></EntitlementGuard>} />
          <Route path="/customers/:contactId" element={<EntitlementGuard module="customers"><CustomerProfilePage /></EntitlementGuard>} />
          <Route path="/customers" element={<EntitlementGuard module="customers"><CustomersSuppliers /></EntitlementGuard>} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="/settings/plan" element={<SubscriptionPlanPage />} />
          <Route path="/settings/integrations" element={<IntegrationsPage />} />
          <Route path="/settings/storefront" element={<EntitlementGuard module="storefront"><StorefrontSettingsPage /></EntitlementGuard>} />
          </Route>
          <Route path="/:slug" element={<PublicStorePage />} />
        </Routes>
      </StoreProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
