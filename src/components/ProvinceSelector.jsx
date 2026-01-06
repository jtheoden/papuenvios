/**
 * ProvinceSelector Component
 * Reusable selector for Province and Municipality
 * Supports municipality-specific shipping costs with fallback to province default
 */

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

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
  const { language } = useLanguage();

  // Separate province-level and municipality-level zones
  const { provinceZones, municipalityZonesMap } = useMemo(() => {
    const provinceZones = shippingZones.filter(z => !z.municipality_name);
    const municipalityZonesMap = {};

    shippingZones
      .filter(z => z.municipality_name)
      .forEach(z => {
        if (!municipalityZonesMap[z.province_name]) {
          municipalityZonesMap[z.province_name] = {};
        }
        municipalityZonesMap[z.province_name][z.municipality_name] = z;
      });

    return { provinceZones, municipalityZonesMap };
  }, [shippingZones]);

  // Get cost display for a municipality
  const getMunicipalityCost = (provinceName, municipalityName) => {
    const munZone = municipalityZonesMap[provinceName]?.[municipalityName];
    if (munZone) {
      // Municipality-specific cost
      if (munZone.free_shipping || parseFloat(munZone.shipping_cost) === 0) {
        return { cost: 0, label: language === 'es' ? 'Envío Gratis' : 'Free Shipping', isSpecific: true };
      }
      return { cost: parseFloat(munZone.shipping_cost), label: `$${parseFloat(munZone.shipping_cost).toFixed(2)}`, isSpecific: true };
    }

    // Fallback to province default
    const provinceZone = provinceZones.find(z => z.province_name === provinceName);
    if (provinceZone) {
      if (provinceZone.free_shipping || parseFloat(provinceZone.shipping_cost) === 0) {
        return { cost: 0, label: language === 'es' ? 'Envío Gratis' : 'Free Shipping', isSpecific: false };
      }
      return { cost: parseFloat(provinceZone.shipping_cost), label: `$${parseFloat(provinceZone.shipping_cost).toFixed(2)}`, isSpecific: false };
    }

    return { cost: 0, label: '', isSpecific: false };
  };

  // Get the province cost for display
  const getProvinceCostLabel = (zone) => {
    if (!showCosts) return '';
    if (zone.free_shipping || parseFloat(zone.shipping_cost) === 0) {
      return ` - ${language === 'es' ? 'Envío Gratis' : 'Free Shipping'}`;
    }
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
                <option key={mun} value={mun}>
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
