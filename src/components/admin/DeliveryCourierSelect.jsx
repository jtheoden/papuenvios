import React, { useEffect, useState } from 'react';
import { listDeliveryCouriers } from '@/lib/courierService';

/**
 * Optional "who delivered" select. Renders nothing while the courier module is unavailable (migrations not applied)
 * or when there are no active couriers, so the delivery dialog behaves exactly as before in those cases.
 */
const DeliveryCourierSelect = ({ value, onChange, disabled, t }) => {
  const [couriers, setCouriers] = useState([]);

  useEffect(() => {
    let alive = true;
    listDeliveryCouriers().then((items) => { if (alive) setCouriers(items); });
    return () => { alive = false; };
  }, []);

  if (couriers.length === 0) return null;
  return (
    <div>
      <label htmlFor="delivery-courier" className="block text-sm font-medium text-gray-800 mb-1">
        {t('couriers.delivery.label')}
      </label>
      <select
        id="delivery-courier"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] border border-gray-300 rounded-lg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">{t('couriers.delivery.none')}</option>
        {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p className="text-xs text-gray-600 mt-1">{t('couriers.delivery.hint')}</p>
    </div>
  );
};

export default DeliveryCourierSelect;
