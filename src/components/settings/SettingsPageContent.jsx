import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, Save, Home, Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, ShieldCheck,
  ShoppingBag, DollarSign, TrendingUp, Users, Package, Truck,
  CreditCard, Star, Gift, Globe, BarChart3, Banknote, Heart, Zap,
  FileText, Image, X, Loader2, Video
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import { saveNotificationSettings } from '@/lib/notificationSettingsService';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import {
  getAllPublications, saveAllPublications, uploadPublicationImage, deletePublicationImage
} from '@/lib/publicationService';

// Icon name → component mapping
const ICON_OPTIONS = {
  ShoppingBag, DollarSign, TrendingUp, Users, Package, Truck,
  CreditCard, Star, Gift, Globe, BarChart3, Banknote, Heart, Zap
};

const ICON_NAMES = Object.keys(ICON_OPTIONS);

// Publication category options
const CATEGORY_OPTIONS = [
  { value: 'general', labelEs: 'General', labelEn: 'General' },
  { value: 'orders', labelEs: 'Pedidos', labelEn: 'Orders' },
  { value: 'remittances', labelEs: 'Remesas', labelEn: 'Remittances' },
  { value: 'recipients', labelEs: 'Destinatarios', labelEn: 'Recipients' },
  { value: 'user-panel', labelEs: 'Panel de Usuario', labelEn: 'User Panel' }
];

/**
 * Content Settings component
 * Manages notification settings + Home Page feature cards + Publications/Guides
 */
const SettingsPageContent = ({ localNotifications, setLocalNotifications, visualSettings, setVisualSettings }) => {
  const { t, language } = useLanguage();
  const { visualSettings: contextVisualSettings } = useBusiness();
  const { refreshNotificationSettings } = useSettings();

  // Use passed visualSettings or fallback to context
  const vs = visualSettings || contextVisualSettings;

  // Feature cards local state
  const [features, setFeatures] = useState(
    () => (vs?.homeFeatures && vs.homeFeatures.length > 0)
      ? vs.homeFeatures
      : DEFAULT_VISUAL_SETTINGS.homeFeatures
  );
  const [expandedFeature, setExpandedFeature] = useState(null);

  // Publications local state
  const [publications, setPublications] = useState([]);
  const [originalPublications, setOriginalPublications] = useState([]);
  const [expandedPub, setExpandedPub] = useState(null);
  const [loadingPubs, setLoadingPubs] = useState(true);
  const [savingPubs, setSavingPubs] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(null); // index of pub being uploaded
  const imageInputRefs = useRef({});

  // Load publications on mount
  useEffect(() => {
    loadPublications();
  }, []);

  const loadPublications = async () => {
    setLoadingPubs(true);
    try {
      const pubs = await getAllPublications();
      setPublications(pubs);
      setOriginalPublications(pubs);
    } catch (error) {
      console.error('Error loading publications:', error);
    } finally {
      setLoadingPubs(false);
    }
  };

  // Navigation target options
  const navOptions = [
    { value: 'products', label: language === 'es' ? 'Productos' : 'Products' },
    { value: 'remittances', label: language === 'es' ? 'Remesas' : 'Remittances' },
    { value: 'dashboard', label: t('settings.content.navDashboard') },
    { value: 'admin', label: t('settings.content.navAdmin') },
    { value: 'vendor', label: t('settings.content.navVendor') },
    { value: 'cart', label: t('settings.content.navCart') }
  ];

  // === Notification Handlers ===
  const handleNotificationSave = async () => {
    try {
      await saveNotificationSettings(localNotifications);
      await refreshNotificationSettings();
      toast({ title: t('settings.saveSuccess') });
    } catch (error) {
      console.error('Error saving notification settings:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // === Feature Handlers ===
  const updateFeature = (index, key, value) => {
    setFeatures(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [key]: value };
      return updated;
    });
  };

  const addFeature = () => {
    const newFeature = {
      id: `feature_${Date.now()}`,
      icon: 'Star',
      titleEs: '',
      titleEn: '',
      descriptionEs: '',
      descriptionEn: '',
      navigateTo: 'products',
      adminOnly: false,
      isActive: true,
      displayOrder: features.length
    };
    setFeatures(prev => [...prev, newFeature]);
    setExpandedFeature(features.length);
  };

  const removeFeature = (index) => {
    setFeatures(prev => prev.filter((_, i) => i !== index));
    setExpandedFeature(null);
    toast({ title: t('settings.content.featureRemoved') });
  };

  const moveFeature = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= features.length) return;
    setFeatures(prev => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = { ...updated[newIndex], displayOrder: index };
      updated[newIndex] = { ...temp, displayOrder: newIndex };
      return updated;
    });
    setExpandedFeature(newIndex);
  };

  const handleFeaturesSave = () => {
    // Re-index displayOrder
    const sorted = features.map((f, i) => ({ ...f, displayOrder: i }));
    if (setVisualSettings) {
      setVisualSettings({ ...vs, homeFeatures: sorted });
    }
    toast({ title: t('settings.content.featureSaved') });
  };

  // === Publication Handlers ===
  const updatePub = (index, key, value) => {
    setPublications(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [key]: value };
      return updated;
    });
  };

  const addPublication = () => {
    const newPub = {
      id: `new_${Date.now()}`,
      _isNew: true,
      title_es: '',
      title_en: '',
      content_es: '',
      content_en: '',
      cover_image_url: '',
      video_url: '',
      category: 'general',
      is_active: true,
      display_order: publications.length
    };
    setPublications(prev => [...prev, newPub]);
    setExpandedPub(publications.length);
  };

  const removePub = async (index) => {
    const pub = publications[index];
    // If it has a cover image in storage, delete it
    if (pub.cover_image_url && !pub._isNew) {
      await deletePublicationImage(pub.cover_image_url);
    }
    setPublications(prev => prev.filter((_, i) => i !== index));
    setExpandedPub(null);
    toast({ title: t('settings.content.pubRemoved') });
  };

  const movePub = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= publications.length) return;
    setPublications(prev => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = { ...updated[newIndex], display_order: index };
      updated[newIndex] = { ...temp, display_order: newIndex };
      return updated;
    });
    setExpandedPub(newIndex);
  };

  const handleImageUpload = async (index, file) => {
    if (!file) return;
    setUploadingImage(index);
    try {
      const result = await uploadPublicationImage(file);
      if (result.success) {
        updatePub(index, 'cover_image_url', result.publicUrl);
        toast({ title: language === 'es' ? 'Imagen subida' : 'Image uploaded' });
      } else {
        toast({ title: t('common.error'), description: result.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } finally {
      setUploadingImage(null);
    }
  };

  const handleRemoveImage = async (index) => {
    const pub = publications[index];
    if (pub.cover_image_url) {
      await deletePublicationImage(pub.cover_image_url);
    }
    updatePub(index, 'cover_image_url', '');
  };

  const handlePublicationsSave = async () => {
    setSavingPubs(true);
    try {
      const result = await saveAllPublications(publications, originalPublications);
      if (result.success) {
        toast({ title: t('settings.content.pubSaved') });
        // Reload to get fresh data with proper IDs
        await loadPublications();
      }
    } catch (error) {
      console.error('Error saving publications:', error);
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } finally {
      setSavingPubs(false);
    }
  };

  const getCategoryLabel = (value) => {
    const cat = CATEGORY_OPTIONS.find(c => c.value === value);
    return cat ? (language === 'es' ? cat.labelEs : cat.labelEn) : value;
  };

  return (
    <div className="space-y-8">
      {/* === Notifications Section === */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
        <h2 className="text-2xl font-semibold mb-6 flex items-center">
          <Bell className="mr-3 text-green-600" />
          {t('settings.notifications.title')}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              {language === 'es' ? 'Destino de notificaciones' : 'Notification destination'}
            </label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm">
              <button
                type="button"
                onClick={() => setLocalNotifications({ ...localNotifications, whatsappTarget: 'whatsapp' })}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  (localNotifications.whatsappTarget || 'whatsapp') === 'whatsapp'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {language === 'es' ? 'Cuenta' : 'Account'}
              </button>
              <button
                type="button"
                onClick={() => setLocalNotifications({ ...localNotifications, whatsappTarget: 'whatsappGroup' })}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  localNotifications.whatsappTarget === 'whatsappGroup'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {language === 'es' ? 'Grupo' : 'Group'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {language === 'es'
                ? 'Selecciona si las notificaciones salen por cuenta directa o por grupo.'
                : 'Choose whether notifications go to a direct account or a group.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              {t('settings.notifications.whatsapp')}
            </label>
            <input
              type="tel"
              value={localNotifications.whatsapp}
              onChange={(e) => setLocalNotifications({ ...localNotifications, whatsapp: e.target.value })}
              placeholder="+1234567890"
              className="w-full input-style"
            />
            <p className="text-xs text-gray-500 mt-1">
              {language === 'es'
                ? 'Número de WhatsApp para soporte individual'
                : 'WhatsApp number for individual support'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              {language === 'es' ? 'Grupo de WhatsApp' : 'WhatsApp Group'}
            </label>
            <input
              type="text"
              value={localNotifications.whatsappGroup}
              onChange={(e) => setLocalNotifications({ ...localNotifications, whatsappGroup: e.target.value })}
              placeholder="https://chat.whatsapp.com/xxxxx"
              className="w-full input-style"
            />
            <p className="text-xs text-gray-500 mt-1">
              {language === 'es'
                ? 'URL del grupo de WhatsApp para notificaciones de pedidos'
                : 'WhatsApp group URL for order notifications'}
            </p>
          </div>
        </div>

        <div className="mt-6 text-right">
          <Button onClick={handleNotificationSave} style={getPrimaryButtonStyle(vs)} className="h-9 px-3">
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.saveSettings')}</span>
          </Button>
        </div>
      </motion.div>

      {/* === Home Page Features Section === */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect p-8 rounded-2xl">
        <h2 className="text-2xl font-semibold mb-2 flex items-center">
          <Home className="mr-3 text-blue-600" />
          {t('settings.content.homeFeatures')}
        </h2>
        <p className="text-sm text-gray-500 mb-6">{t('settings.content.homeFeaturesHint')}</p>

        <div className="space-y-3">
          {features.map((feature, index) => {
            const IconComponent = ICON_OPTIONS[feature.icon] || Star;
            const isExpanded = expandedFeature === index;
            const title = language === 'es' ? feature.titleEs : feature.titleEn;

            return (
              <div
                key={feature.id}
                className={`border rounded-xl overflow-hidden transition-colors ${
                  feature.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'
                }`}
              >
                {/* Header row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedFeature(isExpanded ? null : index)}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: vs?.useGradient
                        ? `linear-gradient(to right, ${vs?.primaryColor || '#2563eb'}, ${vs?.secondaryColor || '#9333ea'})`
                        : vs?.primaryColor || '#2563eb'
                    }}
                  >
                    <IconComponent className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-medium text-sm flex-1 truncate">
                    {title || (language === 'es' ? '(Sin título)' : '(No title)')}
                  </span>
                  {feature.adminOnly && (
                    <ShieldCheck className="h-4 w-4 text-amber-500 flex-shrink-0" title={t('settings.content.featureAdminOnly')} />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFeature(index, 'isActive', !feature.isActive);
                    }}
                    className={`p-1 rounded-md transition-colors ${
                      feature.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={feature.isActive ? t('settings.content.featureActive') : t('settings.content.featureInactive')}
                  >
                    {feature.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded form */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-4">
                    {/* Row 1: Icon + Navigation + Admin-only */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureIcon')}</label>
                        <select
                          value={feature.icon}
                          onChange={(e) => updateFeature(index, 'icon', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {ICON_NAMES.map(name => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureNavigateTo')}</label>
                        <select
                          value={feature.navigateTo}
                          onChange={(e) => updateFeature(index, 'navigateTo', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {navOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={feature.adminOnly}
                            onChange={(e) => updateFeature(index, 'adminOnly', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs font-medium text-gray-600">{t('settings.content.featureAdminOnly')}</span>
                        </label>
                      </div>
                    </div>

                    {/* Row 2: Titles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureTitle')} (ES)</label>
                        <input
                          type="text"
                          value={feature.titleEs}
                          onChange={(e) => updateFeature(index, 'titleEs', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Título en español"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureTitle')} (EN)</label>
                        <input
                          type="text"
                          value={feature.titleEn}
                          onChange={(e) => updateFeature(index, 'titleEn', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Title in English"
                        />
                      </div>
                    </div>

                    {/* Row 3: Descriptions */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureDescription')} (ES)</label>
                        <textarea
                          value={feature.descriptionEs}
                          onChange={(e) => updateFeature(index, 'descriptionEs', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          rows={2}
                          placeholder="Descripción en español"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.featureDescription')} (EN)</label>
                        <textarea
                          value={feature.descriptionEn}
                          onChange={(e) => updateFeature(index, 'descriptionEn', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          rows={2}
                          placeholder="Description in English"
                        />
                      </div>
                    </div>

                    {/* Row 4: Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveFeature(index, -1)}
                          disabled={index === 0}
                          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFeature(index, 1)}
                          disabled={index === features.length - 1}
                          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFeature(index)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        {language === 'es' ? 'Eliminar' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add + Save buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={addFeature}
            className="h-9 px-3"
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.content.addFeature')}</span>
          </Button>
          <Button onClick={handleFeaturesSave} style={getPrimaryButtonStyle(vs)} className="h-9 px-3">
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.saveSettings')}</span>
          </Button>
        </div>
      </motion.div>

      {/* === Publications / Guides Section === */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect p-8 rounded-2xl">
        <h2 className="text-2xl font-semibold mb-2 flex items-center">
          <FileText className="mr-3 text-purple-600" />
          {t('settings.content.publications')}
        </h2>
        <p className="text-sm text-gray-500 mb-6">{t('settings.content.publicationsHint')}</p>

        {loadingPubs ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {publications.map((pub, index) => {
                const isExpanded = expandedPub === index;
                const title = language === 'es' ? pub.title_es : pub.title_en;

                return (
                  <div
                    key={pub.id}
                    className={`border rounded-xl overflow-hidden transition-colors ${
                      pub.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'
                    }`}
                  >
                    {/* Header row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setExpandedPub(isExpanded ? null : index)}
                    >
                      {/* Cover image thumbnail or placeholder */}
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center">
                        {pub.cover_image_url ? (
                          <img src={pub.cover_image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm block truncate">
                          {title || (language === 'es' ? '(Sin título)' : '(No title)')}
                        </span>
                        <span className="text-xs text-gray-400">{getCategoryLabel(pub.category)}</span>
                      </div>
                      {pub.video_url && (
                        <Video className="h-4 w-4 text-blue-400 flex-shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updatePub(index, 'is_active', !pub.is_active);
                        }}
                        className={`p-1 rounded-md transition-colors ${
                          pub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={pub.is_active ? t('settings.content.featureActive') : t('settings.content.featureInactive')}
                      >
                        {pub.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>

                    {/* Expanded form */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-4">
                        {/* Row 1: Category */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubCategory')}</label>
                            <select
                              value={pub.category}
                              onChange={(e) => updatePub(index, 'category', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              {CATEGORY_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                  {language === 'es' ? opt.labelEs : opt.labelEn}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubVideoUrl')}</label>
                            <input
                              type="url"
                              value={pub.video_url || ''}
                              onChange={(e) => updatePub(index, 'video_url', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="https://www.youtube.com/watch?v=..."
                            />
                          </div>
                        </div>

                        {/* Row 2: Cover image */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubCoverImage')}</label>
                          {pub.cover_image_url ? (
                            <div className="relative inline-block">
                              <img
                                src={pub.cover_image_url}
                                alt="Cover"
                                className="h-24 rounded-lg object-cover border border-gray-200"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveImage(index)}
                                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                ref={el => imageInputRefs.current[index] = el}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={(e) => handleImageUpload(index, e.target.files[0])}
                                className="hidden"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => imageInputRefs.current[index]?.click()}
                                disabled={uploadingImage === index}
                                className="h-8"
                              >
                                {uploadingImage === index ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : (
                                  <Image className="h-4 w-4 mr-1" />
                                )}
                                {language === 'es' ? 'Subir imagen' : 'Upload image'}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Row 3: Titles */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubTitle')} (ES)</label>
                            <input
                              type="text"
                              value={pub.title_es}
                              onChange={(e) => updatePub(index, 'title_es', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Título en español"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubTitle')} (EN)</label>
                            <input
                              type="text"
                              value={pub.title_en}
                              onChange={(e) => updatePub(index, 'title_en', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Title in English"
                            />
                          </div>
                        </div>

                        {/* Row 4: Content */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubContent')} (ES)</label>
                            <textarea
                              value={pub.content_es}
                              onChange={(e) => updatePub(index, 'content_es', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                              rows={5}
                              placeholder="Contenido del artículo en español..."
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.content.pubContent')} (EN)</label>
                            <textarea
                              value={pub.content_en}
                              onChange={(e) => updatePub(index, 'content_en', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                              rows={5}
                              placeholder="Article content in English..."
                            />
                          </div>
                        </div>

                        {/* Row 5: Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => movePub(index, -1)}
                              disabled={index === 0}
                              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePub(index, 1)}
                              disabled={index === publications.length - 1}
                              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removePub(index)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                            {language === 'es' ? 'Eliminar' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {publications.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">
                  {language === 'es' ? 'No hay publicaciones. Agrega la primera.' : 'No publications. Add your first one.'}
                </div>
              )}
            </div>

            {/* Add + Save buttons */}
            <div className="flex items-center justify-between mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={addPublication}
                className="h-9 px-3"
              >
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('settings.content.addPublication')}</span>
              </Button>
              <Button
                onClick={handlePublicationsSave}
                style={getPrimaryButtonStyle(vs)}
                className="h-9 px-3"
                disabled={savingPubs}
              >
                {savingPubs ? (
                  <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                ) : (
                  <Save className="h-4 w-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">{t('common.saveSettings')}</span>
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default SettingsPageContent;
