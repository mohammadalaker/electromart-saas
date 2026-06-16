import { useState, useEffect } from 'react';
import { Bell, X, Trash2, Check, AlertTriangle, Package, ShoppingCart, Clock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function NotificationsSystem() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(new Set());

  useEffect(() => {
    fetchNotifications();
    const stored = localStorage.getItem('readNotifs');
    if (stored) setReadIds(new Set(JSON.parse(stored)));
  }, []);

  const fetchNotifications = async () => {
    const notifs = [];
    
    // Low stock
    const { data: lowStock } = await supabase
      .from('products')
      .select('id, eng_name, stock_count')
      .gt('stock_count', 0)
      .lte('stock_count', 10)
      .order('stock_count', { ascending: true })
      .limit(20);
    
    // Out of stock
    const { data: outStock } = await supabase
      .from('products')
      .select('id, eng_name')
      .eq('stock_count', 0)
      .limit(20);

    // Out of stock (0 stock) first
    outStock?.forEach(p => {
      const name = p.eng_name || 'منتج غير معروف';
      const truncatedName = `${name.substring(0, 50)}${name.length > 50 ? '...' : ''}`;
      notifs.push({
        id: 'out-' + p.id,
        type: 'danger',
        title: 'نفد المخزون',
        message: truncatedName,
        icon: 'alert'
      });
    });
    
    // Low stock second
    lowStock?.forEach(p => {
      const name = p.eng_name || 'منتج غير معروف';
      const truncatedName = `${name.substring(0, 50)}${name.length > 50 ? '...' : ''}`;
      notifs.push({
        id: 'low-' + p.id,
        type: 'warning',
        title: 'تنبيه مخزون',
        message: `${truncatedName} متبقي ${p.stock_count}`,
        icon: 'package'
      });
    });

    setNotifications(notifs.slice(0, 50));
  };

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markAllRead = () => {
    const allIds = notifications.map(n => n.id);
    const newSet = new Set(allIds);
    setReadIds(newSet);
    localStorage.setItem('readNotifs', JSON.stringify([...newSet]));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  console.log('notifications:', notifications);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'relative',
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          background: 'white',
          border: '1px solid #e5e7eb',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Bell size={20} color="#4b5563" />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            background: '#ef4444',
            color: 'white',
            fontSize: '11px',
            borderRadius: '999px',
            padding: '2px 6px',
            fontWeight: 'bold'
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '48px',
            left: '0',
            right: 'auto',
            width: '380px',
            maxHeight: '500px',
            backgroundColor: 'white',
            borderRadius: '16px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            border: '1px solid #e5e7eb',
            zIndex: 99999,
            direction: 'rtl',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #f3f4f6',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
              الإشعارات ({notifications.length})
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={markAllRead} style={{ fontSize: '12px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}>
                تحديد الكل كمقروء
              </button>
              <button onClick={clearAll} style={{ fontSize: '12px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                مسح الكل
              </button>
            </div>
          </div>

          <div style={{
            height: '400px',
            overflowY: 'auto',
            backgroundColor: 'white',
            display: 'block'
          }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
                لا توجد إشعارات
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #f3f4f6',
                    backgroundColor: readIds.has(n.id) ? 'white' : '#f9fafb',
                    display: 'flex',
                    gap: '12px'
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    backgroundColor: n.type === 'danger' ? '#fee2e2' : '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {n.type === 'danger' ? <AlertTriangle size={18} color="#ef4444" /> : <Package size={18} color="#f59e0b" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      {n.message}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
