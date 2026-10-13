/**
 * ProvinceSelector Component
 * Reusable selector for Province and Municipality
 * Supports municipality-specific shipping costs with fallback to province default.
 * Rules live in @/lib/shippingZoneRules (province selectable if any municipality is available)
 */

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getSelectableProvinces, getShippingState, isZoneAvailable } from '@/lib/shippingZoneRules';

const ProvinceSelector = ({
  shippingZones = [],
  selectedProvince = '',
  selectedMunicipality = '',
  municipalities = [],
  onProvinceChange,
  onMunicipalityChange,
  showLabel = true,
  showCosts = true
}) => {
  const { t, language } = useLanguage();

  // A province is listed when it is selectable (own row available OR any of its
  // municipality rows available). Provinces like Camaguey have a province row with
  // cost 0 and are selectable only through their priced municipalities.
  const { provinceZones, municipalityZonesMap } = useMemo(() => {
    const selectable = getSelectableProvinces(shippingZones);
    const provinceZones = selectable.filter(z => !z.municipality_name);

    const municipalityZonesMap = {};
    selectable
      .filter(z => z.municipality_name)
      .forEach(z => {
        if (!municipalityZonesMap[z.province_name]) {
          municipalityZonesMap[z.province_name] = {};
        }
        municipalityZonesMap[z.province_name][z.municipality_name] = z;
      });

    return { provinceZones, municipalityZonesMap };
  }, [shippingZones]);

  // Get cost display for a municipality (rules shared with checkout: never "free" unless flagged free)
  const getMunicipalityCost = (provinceName, municipalityName) => {
    const state = getShippingState(shippingZones, provinceName, municipalityName);
    const isSpecific = state.source === 'municipality';

    if (state.status !== 'available') {
      return { cost: 0, label: t('cart.shippingUnavailableShort'), isSpecific: false, unavailable: true };
    }
    if (state.freeShipping) {
      return { cost: 0, label: language === 'es' ? 'Envío Gratis' : 'Free Shipping', isSpecific, unavailable: false };
    }
    return { cost: state.cost, label: `$${state.cost.toFixed(2)}`, isSpecific, unavailable: false };
  };

  // Province label: its own fee when the province row is available, nothing otherwise
  // (a province selectable only through municipalities shows the prices per municipality)
  const getProvinceCostLabel = (zone) => {
    if (!showCosts || !isZoneAvailable(zone)) return '';

    // Free shipping
    if (zone.free_shipping) {
      return ` - ${language === 'es' ? 'Envío Gratis' : 'Free Shipping'}`;
    }

    // Has cost
    return ` - $${parseFloat(zone.shipping_cost).toFixed(2)}`;
  };

  return (
    <>
      {/* Province Selection */}
      <div>
        {showLabel && (
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Provincia' : 'Province'} <span className="text-red-500">*</span>
          </label>
        )}
        <select
          value={selectedProvince}
          onChange={e => onProvinceChange(e.target.value)}
          className="input-style w-full"
          required
        >
          <option value="">
            {language === 'es' ? 'Seleccione una provincia' : 'Select a province'}
          </option>
          {provinceZones.map(zone => (
            <option key={zone.id} value={zone.province_name}>
              {zone.province_name}{getProvinceCostLabel(zone)}
            </option>
          ))}
        </select>
      </div>

      {/* Municipality Selection - Only show if province selected */}
      {selectedProvince && (
        <div>
          {showLabel && (
            <label className="block text-sm font-medium mb-2">
              {language === 'es' ? 'Municipio' : 'Municipality'} <span className="text-red-500">*</span>
            </label>
          )}
          <select
            value={selectedMunicipality}
            onChange={e => onMunicipalityChange(e.target.value)}
            className="input-style w-full"
            required
          >
            <option value="">
              {language === 'es' ? 'Seleccione un municipio' : 'Select a municipality'}
            </option>
            {municipalities.map(mun => {
              const costInfo = getMunicipalityCost(selectedProvince, mun);
              return (
                <option key={mun} value={mun} disabled={costInfo.unavailable}>
                  {mun}
                  {showCosts && costInfo.label && ` - ${costInfo.label}`}
                  {showCosts && costInfo.isSpecific && ` *`}
                </option>
              );
            })}
          </select>
          {showCosts && municipalityZonesMap[selectedProvince] && Object.keys(municipalityZonesMap[selectedProvince]).length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              * {language === 'es' ? 'Costo específico del municipio' : 'Municipality-specific cost'}
            </p>
          )}
        </div>
      )}
    </>
  );
};

export default ProvinceSelector;
