import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * TabsResponsive - Mobile-first responsive tabs component
 *
 * Desktop (md+): Renders horizontal tabs normally
 * Mobile (<md): Renders as dropdown menu with icons
 *
 * @param {Array} tabs - Tab configuration array
 *   [{ id, label (i18n key), icon (LucideIcon), content (ReactNode) }, ...]
 * @param {string} activeTab - Currently active tab id
 * @param {Function} onTabChange - Callback when tab changes
 */
const TabsResponsive = ({ tabs, activeTab, onTabChange }) => {
  const { t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeTabData = tabs.find(tab => tab.id === activeTab);

  return (
    <div className="w-full">
      {/* Desktop View (md+) */}
      <div className="hidden md:flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-6 py-3 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>

      {/* Mobile View (<md) - Dropdown */}
      <div className="md:hidden bg-white border-b border-gray-200">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {activeTabData?.icon}
            <span className="font-medium text-sm">{t(activeTabData?.label || '')}</span>
          </div>
          <ChevronDown
            size={20}
            className={`transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="absolute left-0 right-0 bg-white border-b border-gray-200 z-50">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                <span className="text-sm font-medium">{t(tab.label)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`transition-opacity ${activeTab === tab.id ? 'opacity-100' : 'hidden'}`}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TabsResponsive;
