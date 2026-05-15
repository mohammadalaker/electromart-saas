import { Loader2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { isModuleEnabled } from '../utils/storeEntitlements';
import ModuleLockedPage from './ModuleLockedPage';

/**
 * يحمي الصفحة حسب stores.disabled_modules (الوحدات المعطّلة).
 */
export default function EntitlementGuard({ module, children }) {
  const { store, loading } = useStore();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
        <Loader2 className="animate-spin text-indigo-500" size={36} />
      </div>
    );
  }

  if (!isModuleEnabled(store, module)) {
    return <ModuleLockedPage moduleKey={module} />;
  }

  return children;
}
