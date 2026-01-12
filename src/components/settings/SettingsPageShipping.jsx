import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, MapPin, RefreshCw, ChevronDown, ChevronRight, Plus, Trash2, Save,
  Building2, DollarSign, Clock, Package, AlertCircle
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import {
  getAllShippingZones,
  updateShippingZone,
  createShippingZone,
  deleteShippingZone,
  getShippingZonesForProvince
} from '@/lib/shippingService';
import { getProvinceNames, getMunicipalitiesByProvince } from '@/lib/cubanLocations';

/**
 * Shipping Zones component
 * Manages shipping costs per province and municipality
 * Includes transport cost, delivery days, and notes
 */
const SettingsPageShipping = () => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  const [shippingZones, setShippingZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [savingZone, setSavingZone] = useState(null);
  const [expandedProvince, setExpandedProvince] = useState(null);
  const [municipalityZones, setMunicipalityZones] = useState({});
  const [loadingMunicipalities, setLoadingMunicipalities] = useState(null);
  const [editingMunicipality, setEditingMunicipality] = useState(null);
  const [newMunicipalityCost, setNewMunicipalityCost] = useState({});
  const [showAdvanced, setShowAdvanced] = useState({});

  useEffect(() => {
    loadShippingZones();
  }, []);

  const loadShippingZones = async () => {
    setLoadingZones(true);
    try {
      const zones = await getAllShippingZones();
      // Filter to only province-level zones (municipality_name is null)
      const provinceZones = (zones || []).filter(z => !z.municipality_name);

      // Ensure all Cuban provinces are represented
      const provinceNames = getProvinceNames();
      const existingProvinces = provinceZones.map(z => z.province_name);
      const missingProvinces = provinceNames.filter(p => !existingProvinces.includes(p));

      // Add missing provinces with 0 cost
      const allZones = [
        ...provinceZones,
        ...missingProvinces.map(name => ({
          id: `temp-${name}`,
          province_name: name,
          municipality_name: null,
          shipping_cost: 0,
          transport_cost: 0,
          delivery_days: 3,
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

  const loadMunicipalityZones = useCallback(async (provinceName) => {
    setLoadingMunicipalities(provinceName);
    try {
      const zones = await getShippingZonesForProvince(provinceName);
      const munZones = zones.filter(z => z.municipality_name);
      setMunicipalityZones(prev => ({
        ...prev,
        [provinceName]: munZones
      }));
    } catch (error) {
      console.error('Error loading municipality zones:', error);
    } finally {
      setLoadingMunicipalities(null);
    }
  }, []);

  const handleExpandProvince = async (provinceName) => {
    if (expandedProvince === provinceName) {
      setExpandedProvince(null);
    } else {
      setExpandedProvince(provinceName);
      if (!municipalityZones[provinceName]) {
        await loadMunicipalityZones(provinceName);
      }
    }
  };

  const toggleAdvanced = (zoneId) => {
    setShowAdvanced(prev => ({ ...prev, [zoneId]: !prev[zoneId] }));
  };

  const handleProvinceUpdate = async (zoneId, updates) => {
    setSavingZone(zoneId);
    try {
      const zone = shippingZones.find(z => z.id === zoneId);

      if (zone.is_new) {
        await createShippingZone({
          provinceName: zone.province_name,
          municipalityName: null,
          shippingCost: updates.shipping_cost ?? zone.shipping_cost,
          transportCost: updates.transport_cost ?? zone.transport_cost ?? 0,
          deliveryDays: updates.delivery_days ?? zone.delivery_days ?? 3,
          deliveryNote: updates.delivery_note ?? zone.delivery_note ?? '',
          isActive: updates.is_active ?? zone.is_active ?? true,
          freeShipping: updates.free_shipping ?? zone.free_shipping ?? false
        });

        await loadShippingZones();
        toast({
          title: language === 'es' ? '✅ Zona creada' : '✅ Zone created'
        });
      } else {
        await updateShippingZone(zoneId, {
          shippingCost: updates.shipping_cost,
          transportCost: updates.transport_cost,
          deliveryDays: updates.delivery_days,
          deliveryNote: updates.delivery_note,
          isActive: updates.is_active,
          freeShipping: updates.free_shipping
        });

        setShippingZones(prev =>
          prev.map(z => z.id === zoneId ? { ...z, ...updates } : z)
        );
        toast({
          title: language === 'es' ? '✅ Zona actualizada' : '✅ Zone updated'
        });
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

  const handleAddMunicipalityCost = async (provinceName, municipalityName, costs) => {
    setSavingZone(`${provinceName}-${municipalityName}`);
    try {
      await createShippingZone({
        provinceName,
        municipalityName,
        shippingCost: costs.shipping_cost || 0,
        transportCost: costs.transport_cost || 0,
        deliveryDays: costs.delivery_days || 3,
        isActive: true,
        freeShipping: costs.shipping_cost === 0
      });

      await loadMunicipalityZones(provinceName);
      setEditingMunicipality(null);
      setNewMunicipalityCost({});
      toast({
        title: language === 'es' ? '✅ Municipio configurado' : '✅ Municipality configured'
      });
    } catch (error) {
      console.error('Error adding municipality cost:', error);
      toast({
        title: language === 'es' ? 'Error al agregar' : 'Error adding',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingZone(null);
    }
  };

  const handleUpdateMunicipalityCost = async (zoneId, provinceName, updates) => {
    setSavingZone(zoneId);
    try {
      await updateShippingZone(zoneId, {
        shippingCost: updates.shipping_cost,
        transportCost: updates.transport_cost,
        deliveryDays: updates.delivery_days,
        freeShipping: updates.shipping_cost === 0
      });

      await loadMunicipalityZones(provinceName);
      toast({
        title: language === 'es' ? '✅ Costo actualizado' : '✅ Cost updated'
      });
    } catch (error) {
      console.error('Error updating municipality cost:', error);
      toast({
        title: language === 'es' ? 'Error al actualizar' : 'Error updating',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingZone(null);
    }
  };

  const handleDeleteMunicipalityCost = async (zoneId, provinceName) => {
    setSavingZone(zoneId);
    try {
      await deleteShippingZone(zoneId);
      await loadMunicipalityZones(provinceName);
      toast({
        title: language === 'es' ? '✅ Configuración eliminada' : '✅ Configuration removed'
      });
    } catch (error) {
      console.error('Error deleting municipality cost:', error);
      toast({
        title: language === 'es' ? 'Error al eliminar' : 'Error deleting',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingZone(null);
    }
  };

  const renderCostInput = (label, value, onChange, onBlur, IconComponent, placeholder = '0.00', unit = '$') => (
    <div className="flex-1">
      <label className="flex items-center gap-1 text-xs text-gray-600 mb-1">
        <IconComponent className="h-3 w-3" />
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value || ''}
          onChange={onChange}
          onBlur={onBlur}
          className="input-style w-full text-sm pr-6"
          placeholder={placeholder}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>
      </div>
    </div>
  );

  const renderMunicipalitySection = (zone) => {
    const provinceName = zone.province_name;
    const municipalities = getMunicipalitiesByProvince(provinceName);
    const munZones = municipalityZones[provinceName] || [];
    const configuredMunicipalities = munZones.map(z => z.municipality_name);
    const unconfiguredMunicipalities = municipalities.filter(m => !configuredMunicipalities.includes(m));

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2 }}
        className="mt-4 pt-4 border-t border-gray-200"
      >
        {loadingMunicipalities === provinceName ? (
          <div className="flex justify-center py-4">
            <RefreshCw className="h-5 w-5 animate-spin" style={{ color: visualSettings.primaryColor }} />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {language === 'es' ? 'Costos por Municipio' : 'Municipality Costs'}
              </h4>
              <span className="text-xs text-gray-500">
                {munZones.length} {language === 'es' ? 'configurados' : 'configured'}
              </span>
            </div>

            {/* Configured municipalities */}
            {munZones.length > 0 && (
              <div className="space-y-3 mb-4">
                {munZones.map(munZone => (
                  <div
                    key={munZone.id}
                    className="p-3 bg-gradient-to-r from-gray-50 to-white rounded-lg border border-gray-100"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <MapPin className="h-3 w-3 text-gray-400" />
                        {munZone.municipality_name}
                      </span>
                      <button
                        onClick={() => handleDeleteMunicipalityCost(munZone.id, provinceName)}
                        disabled={savingZone === munZone.id}
                        className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                        title={language === 'es' ? 'Eliminar' : 'Delete'}
                      >
                        {savingZone === munZone.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {language === 'es' ? 'Envío' : 'Shipping'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={munZone.shipping_cost}
                          onBlur={e => {
                            const cost = parseFloat(e.target.value) || 0;
                            if (cost !== parseFloat(munZone.shipping_cost)) {
                              handleUpdateMunicipalityCost(munZone.id, provinceName, {
                                ...munZone,
                                shipping_cost: cost
                              });
                            }
                          }}
                          className="w-full text-sm px-2 py-1 border rounded"
                          disabled={savingZone === munZone.id}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {language === 'es' ? 'Transp.' : 'Transport'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={munZone.transport_cost || 0}
                          onBlur={e => {
                            const cost = parseFloat(e.target.value) || 0;
                            if (cost !== parseFloat(munZone.transport_cost || 0)) {
                              handleUpdateMunicipalityCost(munZone.id, provinceName, {
                                ...munZone,
                                transport_cost: cost
                              });
                            }
                          }}
                          className="w-full text-sm px-2 py-1 border rounded"
                          disabled={savingZone === munZone.id}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {language === 'es' ? 'Días' : 'Days'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          defaultValue={munZone.delivery_days || 3}
                          onBlur={e => {
                            const days = parseInt(e.target.value) || 3;
                            if (days !== (munZone.delivery_days || 3)) {
                              handleUpdateMunicipalityCost(munZone.id, provinceName, {
                                ...munZone,
                                delivery_days: days
                              });
                            }
                          }}
                          className="w-full text-sm px-2 py-1 border rounded"
                          disabled={savingZone === munZone.id}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new municipality cost */}
            {unconfiguredMunicipalities.length > 0 && (
              <div className="space-y-2">
                {editingMunicipality === provinceName ? (
                  <div className="p-3 border-2 border-dashed border-blue-300 rounded-lg bg-blue-50/50">
                    <div className="flex items-center gap-2 mb-3">
                      <select
                        value={newMunicipalityCost.municipality || ''}
                        onChange={e => setNewMunicipalityCost(prev => ({
                          ...prev,
                          municipality: e.target.value
                        }))}
                        className="flex-1 text-sm px-2 py-1.5 border rounded bg-white"
                      >
                        <option value="">
                          {language === 'es' ? 'Seleccionar municipio...' : 'Select municipality...'}
                        </option>
                        {unconfiguredMunicipalities.map(mun => (
                          <option key={mun} value={mun}>{mun}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                      <div>
                        <label className="text-xs text-gray-600">
                          {language === 'es' ? 'Costo Envío ($)' : 'Shipping ($)'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={newMunicipalityCost.shipping_cost || ''}
                          onChange={e => setNewMunicipalityCost(prev => ({
                            ...prev,
                            shipping_cost: e.target.value
                          }))}
                          className="w-full text-sm px-2 py-1 border rounded"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">
                          {language === 'es' ? 'Transp. ($)' : 'Transport ($)'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={newMunicipalityCost.transport_cost || ''}
                          onChange={e => setNewMunicipalityCost(prev => ({
                            ...prev,
                            transport_cost: e.target.value
                          }))}
                          className="w-full text-sm px-2 py-1 border rounded"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">
                          {language === 'es' ? 'Días entrega' : 'Delivery days'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          placeholder="3"
                          value={newMunicipalityCost.delivery_days || ''}
                          onChange={e => setNewMunicipalityCost(prev => ({
                            ...prev,
                            delivery_days: e.target.value
                          }))}
                          className="w-full text-sm px-2 py-1 border rounded"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingMunicipality(null);
                          setNewMunicipalityCost({});
                        }}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        {language === 'es' ? 'Cancelar' : 'Cancel'}
                      </button>
                      <button
                        onClick={() => {
                          if (newMunicipalityCost.municipality) {
                            handleAddMunicipalityCost(provinceName, newMunicipalityCost.municipality, {
                              shipping_cost: parseFloat(newMunicipalityCost.shipping_cost) || 0,
                              transport_cost: parseFloat(newMunicipalityCost.transport_cost) || 0,
                              delivery_days: parseInt(newMunicipalityCost.delivery_days) || 3
                            });
                          }
                        }}
                        disabled={!newMunicipalityCost.municipality || savingZone}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                      >
                        {savingZone === `${provinceName}-${newMunicipalityCost.municipality}` ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {language === 'es' ? 'Guardar' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingMunicipality(provinceName)}
                    className="flex items-center gap-2 w-full p-2.5 text-sm border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
                  >
                    <Plus className="h-4 w-4 text-gray-400 group-hover:text-blue-500" />
                    <span className="text-gray-600 group-hover:text-blue-600">
                      {language === 'es' ? 'Configurar municipio específico' : 'Configure specific municipality'}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Info text */}
            <div className="flex items-start gap-2 mt-4 p-2 bg-amber-50 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                {language === 'es'
                  ? 'Los municipios sin configuración específica usarán los costos por defecto de la provincia.'
                  : 'Municipalities without specific configuration will use province default costs.'}
              </p>
            </div>
          </>
        )}
      </motion.div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
      <h2 className="text-2xl font-semibold mb-2 flex items-center">
        <Truck className="mr-3" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
        {language === 'es' ? 'Zonas de Envío' : 'Shipping Zones'}
      </h2>

      <p className="text-sm text-gray-600 mb-6">
        {language === 'es'
          ? 'Configura costos de envío y transporte por provincia y municipio. Expande una provincia para ver opciones avanzadas y configurar municipios específicos.'
          : 'Configure shipping and transport costs by province and municipality. Expand a province to see advanced options and configure specific municipalities.'}
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
              className="border rounded-xl overflow-hidden transition-shadow hover:shadow-md"
              style={{
                borderColor: zone.is_active ? (visualSettings.primaryColor || '#2563eb') : '#e5e7eb',
                backgroundColor: zone.is_active ? `${visualSettings.primaryColor || '#2563eb'}05` : 'transparent'
              }}
            >
              <div className="p-4">
                {/* Province Header */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => handleExpandProvince(zone.province_name)}
                    className="flex items-center gap-2 hover:opacity-70 transition-opacity"
                  >
                    {expandedProvince === zone.province_name ? (
                      <ChevronDown className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                    ) : (
                      <ChevronRight className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                    )}
                    <MapPin className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                    <span className="font-medium">{zone.province_name}</span>
                  </button>
                  {savingZone === zone.id && (
                    <RefreshCw className="h-4 w-4 animate-spin" style={{ color: visualSettings.primaryColor }} />
                  )}
                </div>

                {/* Free Shipping Checkbox */}
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={zone.free_shipping || false}
                    onChange={e => handleProvinceUpdate(zone.id, {
                      ...zone,
                      free_shipping: e.target.checked,
                      shipping_cost: e.target.checked ? 0 : zone.shipping_cost,
                      is_active: true
                    })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    {language === 'es' ? 'Envío Gratis' : 'Free Shipping'}
                  </span>
                </label>

                {/* Cost Inputs */}
                {!zone.free_shipping && (
                  <div className="space-y-3">
                    {/* Primary costs row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                          <DollarSign className="h-3 w-3" />
                          {language === 'es' ? 'Costo Envío' : 'Shipping Cost'}
                        </label>
                        <div className="relative">
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
                              handleProvinceUpdate(zone.id, {
                                ...zone,
                                shipping_cost: cost,
                                is_active: cost > 0 || (zone.transport_cost || 0) > 0
                              });
                            }}
                            className="input-style w-full text-sm pr-6"
                            placeholder="0.00"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                        </div>
                      </div>
                      <div>
                        <label className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                          <Package className="h-3 w-3" />
                          {language === 'es' ? 'Costo Transp.' : 'Transport Cost'}
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={zone.transport_cost || 0}
                            onChange={e => {
                              const cost = parseFloat(e.target.value) || 0;
                              setShippingZones(prev =>
                                prev.map(z => z.id === zone.id ? { ...z, transport_cost: cost } : z)
                              );
                            }}
                            onBlur={e => {
                              const cost = parseFloat(e.target.value) || 0;
                              handleProvinceUpdate(zone.id, {
                                ...zone,
                                transport_cost: cost
                              });
                            }}
                            className="input-style w-full text-sm pr-6"
                            placeholder="0.00"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                        </div>
                      </div>
                    </div>

                    {/* Advanced options toggle */}
                    <button
                      onClick={() => toggleAdvanced(zone.id)}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      {showAdvanced[zone.id] ? (
                        <>
                          <ChevronDown className="h-3 w-3" />
                          {language === 'es' ? 'Ocultar opciones' : 'Hide options'}
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3 w-3" />
                          {language === 'es' ? 'Más opciones' : 'More options'}
                        </>
                      )}
                    </button>

                    {/* Advanced options */}
                    <AnimatePresence>
                      {showAdvanced[zone.id] && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-3 pt-2 border-t border-gray-100"
                        >
                          <div>
                            <label className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                              <Clock className="h-3 w-3" />
                              {language === 'es' ? 'Días de entrega' : 'Delivery days'}
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="30"
                              value={zone.delivery_days || 3}
                              onChange={e => {
                                const days = parseInt(e.target.value) || 3;
                                setShippingZones(prev =>
                                  prev.map(z => z.id === zone.id ? { ...z, delivery_days: days } : z)
                                );
                              }}
                              onBlur={e => {
                                const days = parseInt(e.target.value) || 3;
                                handleProvinceUpdate(zone.id, {
                                  ...zone,
                                  delivery_days: days
                                });
                              }}
                              className="input-style w-full text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              {language === 'es' ? 'Nota de entrega' : 'Delivery note'}
                            </label>
                            <textarea
                              value={zone.delivery_note || ''}
                              onChange={e => {
                                setShippingZones(prev =>
                                  prev.map(z => z.id === zone.id ? { ...z, delivery_note: e.target.value } : z)
                                );
                              }}
                              onBlur={e => {
                                handleProvinceUpdate(zone.id, {
                                  ...zone,
                                  delivery_note: e.target.value
                                });
                              }}
                              className="input-style w-full text-sm resize-none"
                              rows={2}
                              placeholder={language === 'es' ? 'Ej: Entrega solo fines de semana' : 'E.g.: Weekend delivery only'}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Status badges */}
                <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                  {zone.free_shipping ? (
                    <span className="px-2 py-1 rounded-full" style={{
                      backgroundColor: `${visualSettings.successColor || '#10b981'}20`,
                      color: visualSettings.successColor || '#10b981'
                    }}>
                      {language === 'es' ? '✓ Envío Gratis' : '✓ Free Shipping'}
                    </span>
                  ) : (zone.shipping_cost > 0 || zone.transport_cost > 0) ? (
                    <span className="px-2 py-1 rounded-full" style={{
                      backgroundColor: `${visualSettings.primaryColor || '#2563eb'}15`,
                      color: visualSettings.primaryColor || '#2563eb'
                    }}>
                      {language === 'es' ? '✓ Activo' : '✓ Active'}
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                      {language === 'es' ? 'Sin configurar' : 'Not configured'}
                    </span>
                  )}
                  {municipalityZones[zone.province_name]?.length > 0 && (
                    <span className="px-2 py-1 rounded-full bg-purple-100 text-purple-600">
                      {municipalityZones[zone.province_name].length} {language === 'es' ? 'municipios' : 'municipalities'}
                    </span>
                  )}
                  {(zone.transport_cost || 0) > 0 && (
                    <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-600">
                      +${parseFloat(zone.transport_cost).toFixed(2)} {language === 'es' ? 'transp.' : 'transport'}
                    </span>
                  )}
                </div>

                {/* Municipality section */}
                <AnimatePresence>
                  {expandedProvince === zone.province_name && renderMunicipalitySection(zone)}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default SettingsPageShipping;
