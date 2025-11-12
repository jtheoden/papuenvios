import React, { useState } from 'react';
import { useVisualSettingsAdmin } from '@/hooks/useVisualSettings';
import { toast } from '@/components/ui/use-toast';
import { Palette, Save, RotateCcw } from 'lucide-react';

export function VisualSettingsPanel() {
  const { settings, loading, saving, error, success, updateSetting, resetToDefaults } =
    useVisualSettingsAdmin();

  const [formData, setFormData] = useState({});

  // Initialize form data from settings
  React.useEffect(() => {
    if (settings) {
      setFormData({
        app_name: settings.app_name || '',
        site_title: settings.site_title || '',
        logo_text: settings.logo_text || '',
        favicon_url: settings.favicon_url || '',
        primary_color: settings.primary_color || '#3B82F6',
        secondary_color: settings.secondary_color || '#10B981',
        support_email: settings.support_email || '',
        support_phone: settings.support_phone || '',
        maintenance_mode: settings.maintenance_mode === 'true' || settings.maintenance_mode === true,
      });
    }
  }, [settings]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveSetting = async (key) => {
    const value = formData[key];
    if (value === undefined) return;

    await updateSetting(key, value);
  };

  const handleSaveAll = async () => {
    // Save all changed settings
    const keys = Object.keys(formData);
    for (const key of keys) {
      await updateSetting(key, formData[key]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-600">Cargando configuración...</div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4">
        <p className="text-sm text-red-800">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Palette className="w-6 h-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">Configuración Visual</h2>
      </div>

      {/* Success Message */}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4">
          <p className="text-sm text-green-800">✓ Cambios guardados exitosamente</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Form */}
      <form className="space-y-6" onSubmit={e => { e.preventDefault(); handleSaveAll(); }}>

        {/* Application Name Section */}
        <fieldset className="border border-gray-200 rounded-lg p-4 space-y-4">
          <legend className="text-lg font-semibold text-gray-900 px-2">
            Información de la Aplicación
          </legend>

          {/* App Name */}
          <div>
            <label htmlFor="app_name" className="block text-sm font-medium text-gray-900">
              Nombre de la Aplicación
            </label>
            <input
              id="app_name"
              name="app_name"
              type="text"
              value={formData.app_name || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="PapuEnvios"
            />
            <p className="mt-1 text-xs text-gray-500">
              Nombre mostrado en la navegación
            </p>
          </div>

          {/* Site Title */}
          <div>
            <label htmlFor="site_title" className="block text-sm font-medium text-gray-900">
              Título de la Página
            </label>
            <input
              id="site_title"
              name="site_title"
              type="text"
              value={formData.site_title || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="PapuEnvios - Remesas y E-Commerce"
            />
            <p className="mt-1 text-xs text-gray-500">
              Mostrado en la pestaña del navegador
            </p>
          </div>

          {/* Logo Text */}
          <div>
            <label htmlFor="logo_text" className="block text-sm font-medium text-gray-900">
              Texto del Logo
            </label>
            <input
              id="logo_text"
              name="logo_text"
              type="text"
              value={formData.logo_text || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Papu"
            />
            <p className="mt-1 text-xs text-gray-500">
              Texto mostrado en el logo del header
            </p>
          </div>

          {/* Favicon URL */}
          <div>
            <label htmlFor="favicon_url" className="block text-sm font-medium text-gray-900">
              URL del Favicon
            </label>
            <input
              id="favicon_url"
              name="favicon_url"
              type="text"
              value={formData.favicon_url || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="/favicon.ico"
            />
            <p className="mt-1 text-xs text-gray-500">
              Ruta relativa o URL absoluta
            </p>
          </div>
        </fieldset>

        {/* Colors Section */}
        <fieldset className="border border-gray-200 rounded-lg p-4 space-y-4">
          <legend className="text-lg font-semibold text-gray-900 px-2">
            Colores
          </legend>

          <div className="grid grid-cols-2 gap-4">
            {/* Primary Color */}
            <div>
              <label htmlFor="primary_color" className="block text-sm font-medium text-gray-900">
                Color Primario
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="primary_color"
                  name="primary_color"
                  type="color"
                  value={formData.primary_color || '#3B82F6'}
                  onChange={handleChange}
                  disabled={saving}
                  className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.primary_color || '#3B82F6'}
                  onChange={handleChange}
                  disabled={saving}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  placeholder="#3B82F6"
                />
              </div>
            </div>

            {/* Secondary Color */}
            <div>
              <label htmlFor="secondary_color" className="block text-sm font-medium text-gray-900">
                Color Secundario
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="secondary_color"
                  name="secondary_color"
                  type="color"
                  value={formData.secondary_color || '#10B981'}
                  onChange={handleChange}
                  disabled={saving}
                  className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.secondary_color || '#10B981'}
                  onChange={handleChange}
                  disabled={saving}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  placeholder="#10B981"
                />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Support Section */}
        <fieldset className="border border-gray-200 rounded-lg p-4 space-y-4">
          <legend className="text-lg font-semibold text-gray-900 px-2">
            Información de Soporte
          </legend>

          {/* Support Email */}
          <div>
            <label htmlFor="support_email" className="block text-sm font-medium text-gray-900">
              Email de Soporte
            </label>
            <input
              id="support_email"
              name="support_email"
              type="email"
              value={formData.support_email || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="soporte@papuenvios.com"
            />
          </div>

          {/* Support Phone */}
          <div>
            <label htmlFor="support_phone" className="block text-sm font-medium text-gray-900">
              Teléfono de Soporte
            </label>
            <input
              id="support_phone"
              name="support_phone"
              type="tel"
              value={formData.support_phone || ''}
              onChange={handleChange}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+53-XXXXXXX"
            />
          </div>
        </fieldset>

        {/* Maintenance Mode */}
        <fieldset className="border border-gray-200 rounded-lg p-4">
          <legend className="text-lg font-semibold text-gray-900 px-2">
            Estado de la Aplicación
          </legend>
          <div className="mt-4 flex items-center gap-3">
            <input
              id="maintenance_mode"
              name="maintenance_mode"
              type="checkbox"
              checked={formData.maintenance_mode || false}
              onChange={handleChange}
              disabled={saving}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="maintenance_mode" className="text-sm font-medium text-gray-900">
              Modo Mantenimiento
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Cuando está activo, solo los administradores pueden acceder
          </p>
        </fieldset>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Restablecer
          </button>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </form>

      {/* Info Box */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-2">💡 Nota</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• Los cambios se aplican en toda la aplicación en tiempo real</li>
          <li>• El caché se actualiza automáticamente</li>
          <li>• Los usuarios verán los cambios después de refrescar la página</li>
        </ul>
      </div>
    </div>
  );
}
