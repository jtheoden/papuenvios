import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Package, DollarSign, Save, List, Edit, Trash2, Box, Settings2, Eye, EyeOff, Check, X, AlertTriangle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import TabsResponsive from './TabsResponsive';
import VendorCategoriesTab from './vendor/VendorCategoriesTab';
import VendorCombosTab from './vendor/VendorCombosTab';
import VendorManagementTab from './vendor/VendorManagementTab';
import VendorInventoryTab from './vendor/VendorInventoryTab';

const VendorPage = () => {
  const { t, language } = useLanguage();
  const {
    products, refreshProducts,
    financialSettings,
    categories, refreshCategories,
    combos, refreshCombos,
    testimonials, refreshTestimonials,
    visualSettings
  } = useBusiness();

  // Load currency IDs for products
  const [currencies, setCurrencies] = useState([]);
  const [baseCurrencyId, setBaseCurrencyId] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [exchangeRates, setExchangeRates] = useState({});

  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('currencies')
          .select('*')
          .eq('is_active', true)
          .order('code', { ascending: true});

        if (error) {
          console.error('[fetchCurrencies] ERROR fetching currencies:', error);
          console.error('[fetchCurrencies] Error details:', { message: error?.message, code: error?.code });
          throw error;
        }

        if (data) {
          setCurrencies(data);
          const baseCurrency = data.find(c => c.is_base);
          if (baseCurrency) {
            setBaseCurrencyId(baseCurrency.id);
            setSelectedCurrency(baseCurrency.id);
          } else {
          }
        }

        // Load exchange rates
        const { data: ratesData, error: ratesError } = await supabase
          .from('exchange_rates')
          .select('*')
          .eq('is_active', true);

        if (ratesError) {
          console.error('[fetchCurrencies] ERROR fetching exchange rates:', ratesError);
          console.error('[fetchCurrencies] Error details:', { message: ratesError?.message, code: ratesError?.code });
          throw ratesError;
        }

        if (ratesData) {
          const ratesMap = {};
          ratesData.forEach(rate => {
            ratesMap[`${rate.from_currency_id}-${rate.to_currency_id}`] = rate.rate;
          });
          setExchangeRates(ratesMap);
        }

      } catch (error) {
        console.error('[fetchCurrencies] FATAL ERROR:', error);
        console.error('[fetchCurrencies] Error details:', { message: error?.message, code: error?.code, stack: error?.stack });
      }
    };

    const fetchAdminData = async () => {
      try {
        await refreshProducts(true);

        // Load testimonials with admin view
        await refreshTestimonials(true);

        // Load all combos including inactive ones for admin view
        await refreshCombos(true);

        // Load all carousel slides
        // await refreshCarouselSlides(false); // Will implement when updating HomePage
      } catch (error) {
        console.error('[fetchAdminData] ERROR:', error);
        console.error('[fetchAdminData] Error details:', { message: error?.message, code: error?.code, stack: error?.stack });
      }
    };

    fetchCurrencies();
    fetchAdminData();
  }, []);
  
  const [view, setView] = useState('inventory');

  return (
    <div className="container mx-auto py-8 px-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>{t('vendor.title')}</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">{t('vendor.subtitle')}</p>
      </motion.div>

      <TabsResponsive
        tabs={[
          {
            id: 'inventory',
            label: 'vendor.tabs.inventory',
            icon: <Package className="h-5 w-5" />,
            content: (
              <VendorInventoryTab
                products={products}
                categories={categories}
                currencies={currencies}
                visualSettings={visualSettings}
                baseCurrencyId={baseCurrencyId}
                selectedCurrency={selectedCurrency}
                exchangeRates={exchangeRates}
                financialSettings={financialSettings}
                onSelectedCurrencyChange={setSelectedCurrency}
                onProductsRefresh={refreshProducts}
              />
            )
          },
          {
            id: 'categories',
            label: 'vendor.tabs.categories',
            icon: <List className="h-5 w-5" />,
            content: (
              <VendorCategoriesTab
                categories={categories}
                onCategoriesChange={refreshCategories}
                visualSettings={visualSettings}
              />
            )
          },
          {
            id: 'combos',
            label: 'vendor.tabs.combos',
            icon: <Box className="h-5 w-5" />,
            content: (
              <VendorCombosTab
                combos={combos}
                products={products}
                currencies={currencies}
                visualSettings={visualSettings}
                financialSettings={financialSettings}
                exchangeRates={exchangeRates}
                selectedCurrency={selectedCurrency}
                onSelectedCurrencyChange={setSelectedCurrency}
                onCombosRefresh={refreshCombos}
              />
            )
          },
          {
            id: 'management',
            label: 'vendor.tabs.management',
            icon: <Settings2 className="h-5 w-5" />,
            content: (
              <VendorManagementTab
                testimonials={testimonials}
                onTestimonialsRefresh={refreshTestimonials}
              />
            )
          }
        ]}
        activeTab={view}
        onTabChange={setView}
      />
    </div>
  );
};

export default VendorPage;
