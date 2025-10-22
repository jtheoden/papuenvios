/**
 * ProvinceSelector Component
 * Reusable selector for Province and Municipality
 * Can be used standalone or integrated into other forms
 */

import { useLanguage } from '@/contexts/LanguageContext';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';

const ProvinceSelector = ({
  shippingZones = [],
  selectedProvince = '',
  selectedMunicipality = '',
  municipalities = [],
  onProvinceChange,
  onMunicipalityChange,
  showLabel = true
}) => {
  const { language } = useLanguage();

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
          {shippingZones.map(zone => (
            <option key={zone.id} value={zone.province_name}>
              {zone.province_name}
              {zone.free_shipping || parseFloat(zone.shipping_cost) === 0
                ? ` - ${language === 'es' ? 'Envío Gratis' : 'Free Shipping'}`
                : ` - $${parseFloat(zone.shipping_cost).toFixed(2)}`
              }
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
            {municipalities.map(mun => (
              <option key={mun} value={mun}>
                {mun}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
};

export default ProvinceSelector;
