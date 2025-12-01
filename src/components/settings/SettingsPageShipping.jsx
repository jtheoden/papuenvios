import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Truck, MapPin, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { getAllShippingZones, updateShippingZone, createShippingZone } from '@/lib/shippingService';
import { getProvinceNames } from '@/lib/cubanLocations';

/**
 * Shipping Zones component
 * Manages shipping costs per province
 */
const SettingsPageShipping = () => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  const [shippingZones, setShippingZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [savingZone, setSavingZone] = useState(null);

  useEffect(() => {
    loadShippingZones();
  }, []);

  const loadShippingZones = async () => {
    setLoadingZones(true);
    try {
      const zones = await getAllShippingZones();
      // getAllShippingZones returns array directly
      const existingZones = zones || [];

      // Ensure all Cuban provinces are represented
      const provinceNames = getProvinceNames();
      const existingProvinces = existingZones.map(z => z.province_name);
      const missingProvinces = provinceNames.filter(p => !existingProvinces.includes(p));

      // Add missing provinces with 0 cost
      const allZones = [
        ...existingZones,
        ...missingProvinces.map(name => ({
          id: `temp-${name}`,
          province_name: name,
          shipping_cost: 0,
          is_active: false,
          free_shipping: false,
          is_new: true
        }))
      ];

      setShippingZones(allZones.sort((a, b) => a.province_name.localeCompare(b.province_name)));
    } catch (error) {
      console.error('Error loading shipping zones:', error);
      toast({
        title: language === 'es' ? 'Error al cargar zonas' : 'Error loading zones',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingZones(false);
    }
  };

  const handleShippingZoneUpdate = async (zoneId, updates) => {
    setSavingZone(zoneId);
    try {
      const zone = shippingZones.find(z => z.id === zoneId);

      if (zone.is_new) {
        // Create new zone
        const result = await createShippingZone({
          provinceName: zone.province_name,
          shippingCost: updates.shipping_cost ?? zone.shipping_cost,
          isActive: updates.is_active ?? zone.is_active ?? true,
          freeShipping: updates.free_shipping ?? zone.free_shipping ?? false
        });

        if (result.success) {
          // Reload zones to get the real ID
          await loadShippingZones();
          toast({
            title: language === 'es' ? '✅ Zona creada' : '✅ Zone created'
          });
        }
      } else {
        // Update existing zone
        const result = await updateShippingZone(zoneId, {
          shippingCost: updates.shipping_cost,
          isActive: updates.is_active,
          freeShipping: updates.free_shipping
        });

        if (result.success) {
          setShippingZones(prev =>
            prev.map(z => z.id === zoneId ? { ...z, ...updates } : z)
          );
          toast({
            title: language === 'es' ? '✅ Zona actualizada' : '✅ Zone updated'
          });
        }
      }
    } catch (error) {
      console.error('Error updating shipping zone:', error);
      toast({
        title: language === 'es' ? 'Error al guardar' : 'Save error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingZone(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
      <h2 className="text-2xl font-semibold mb-6 flex items-center">
        <Truck className="mr-3" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
        {language === 'es' ? 'Zonas de Envío' : 'Shipping Zones'}
      </h2>

      <p className="text-sm text-gray-600 mb-6">
        {language === 'es'
          ? 'Configura el costo de envío por provincia. Las provincias con costo $0 no aparecerán en el selector de envío.'
          : 'Configure shipping cost by province. Provinces with $0 cost will not appear in the shipping selector.'}
      </p>

      {loadingZones ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin" style={{ color: visualSettings.primaryColor }} />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {shippingZones.map(zone => (
            <div
              key={zone.id}
              className="p-4 border rounded-lg"
              style={{
                borderColor: zone.is_active ? (visualSettings.primaryColor || '#2563eb') : '#e5e7eb',
                backgroundColor: zone.is_active ? `${visualSettings.primaryColor || '#2563eb'}08` : 'transparent'
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                  <span className="font-medium">{zone.province_name}</span>
                </div>
                {savingZone === zone.id && (
                  <RefreshCw className="h-4 w-4 animate-spin" style={{ color: visualSettings.primaryColor }} />
                )}
              </div>

              <div className="space-y-3">
                {/* Free shipping checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zone.free_shipping || false}
                    onChange={e => handleShippingZoneUpdate(zone.id, {
                      ...zone,
                      free_shipping: e.target.checked,
                      shipping_cost: e.target.checked ? 0 : zone.shipping_cost,
                      is_active: true
                    })}
                    className="rounded"
                  />
                  <span className="text-sm">
                    {language === 'es' ? 'Envío Gratis' : 'Free Shipping'}
                  </span>
                </label>

                {/* Shipping cost input */}
                {!zone.free_shipping && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {language === 'es' ? 'Costo de envío ($)' : 'Shipping cost ($)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={zone.shipping_cost || 0}
                      onChange={e => {
                        const cost = parseFloat(e.target.value) || 0;
                        setShippingZones(prev =>
                          prev.map(z => z.id === zone.id ? { ...z, shipping_cost: cost } : z)
                        );
                      }}
                      onBlur={e => {
                        const cost = parseFloat(e.target.value) || 0;
                        if (cost !== zone.shipping_cost) {
                          handleShippingZoneUpdate(zone.id, {
                            ...zone,
                            shipping_cost: cost,
                            is_active: cost > 0
                          });
                        }
                      }}
                      className="input-style w-full text-sm"
                      placeholder="0.00"
                    />
                  </div>
                )}

                {/* Status indicator */}
                <div className="flex items-center gap-2 text-xs">
                  {zone.free_shipping ? (
                    <span className="px-2 py-1 rounded" style={{
                      backgroundColor: `${visualSettings.successColor || '#10b981'}20`,
                      color: visualSettings.successColor || '#10b981'
                    }}>
                      {language === 'es' ? '✓ Gratis' : '✓ Free'}
                    </span>
                  ) : zone.shipping_cost > 0 ? (
                    <span className="px-2 py-1 rounded" style={{
                      backgroundColor: `${visualSettings.primaryColor || '#2563eb'}20`,
                      color: visualSettings.primaryColor || '#2563eb'
                    }}>
                      {language === 'es' ? '✓ Activo' : '✓ Active'}
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-500">
                      {language === 'es' ? 'No disponible' : 'Not available'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default SettingsPageShipping;
