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
  // Include ALL provinces but mark which are disabled (cost=0 AND free_shipping=false)
  const { provinceZones, disabledProvinces, municipalityZonesMap } = useMemo(() => {
    const allProvinceZones = shippingZones.filter(z => !z.municipality_name);

    // Disabled provinces: cost = 0 AND free_shipping = false
    const disabledProvinces = new Set(
      allProvinceZones
        .filter(z => parseFloat(z.shipping_cost) === 0 && z.free_shipping !== true)
        .map(z => z.province_name)
    );

    const municipalityZonesMap = {};
    shippingZones
      .filter(z => z.municipality_name)
      .forEach(z => {
        if (!municipalityZonesMap[z.province_name]) {
          municipalityZonesMap[z.province_name] = {};
        }
        municipalityZonesMap[z.province_name][z.municipality_name] = z;
      });

    return { provinceZones: allProvinceZones, disabledProvinces, municipalityZonesMap };
  }, [shippingZones]);

  // Check if a province is disabled
  const isProvinceDisabled = (provinceName) => disabledProvinces.has(provinceName);

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

    // Check if disabled (cost=0 AND NOT free_shipping)
    if (parseFloat(zone.shipping_cost) === 0 && zone.free_shipping !== true) {
      return ` - ${language === 'es' ? '⚠️ Envío deshabilitado' : '⚠️ Shipping disabled'}`;
    }

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
          {provinceZones.map(zone => {
            const disabled = isProvinceDisabled(zone.province_name);
            return (
              <option
                key={zone.id}
                value={zone.province_name}
                disabled={disabled}
                className={disabled ? 'text-gray-400' : ''}
              >
                {zone.province_name}{getProvinceCostLabel(zone)}
              </option>
            );
          })}
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
