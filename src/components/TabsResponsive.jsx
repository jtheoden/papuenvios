import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { semanticColors } from '@/lib/colorTokens';

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
      <div
        className="hidden md:flex border-b"
        style={{ borderBottomColor: semanticColors.neutral[200] }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={
              activeTab === tab.id
                ? {
                    borderBottom: `2px solid ${semanticColors.primary.main}`,
                    color: semanticColors.primary.main
                  }
                : {
                    color: semanticColors.neutral[600],
                    transition: 'color 0.2s'
                  }
            }
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = semanticColors.neutral[900];
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = semanticColors.neutral[600];
              }
            }}
            className="px-6 py-3 font-medium text-sm transition-colors"
          >
            {t(tab.label)}
          </button>
        ))}
      </div>

      {/* Mobile View (<md) - Dropdown */}
      <div
        className="md:hidden"
        style={{
          backgroundColor: semanticColors.background.primary,
          borderBottom: `1px solid ${semanticColors.neutral[200]}`
        }}
      >
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="w-full px-4 py-3 flex items-center justify-between transition-colors"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = semanticColors.neutral[50];
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
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
          <div
            className="absolute left-0 right-0 z-50"
            style={{
              backgroundColor: semanticColors.background.primary,
              borderBottom: `1px solid ${semanticColors.neutral[200]}`
            }}
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  setMobileMenuOpen(false);
                }}
                className="w-full px-4 py-3 text-left flex items-center gap-3 transition-colors"
                style={
                  activeTab === tab.id
                    ? {
                        backgroundColor: semanticColors.primary.light,
                        color: semanticColors.primary.main,
                        borderRight: `2px solid ${semanticColors.primary.main}`
                      }
                    : {
                        color: semanticColors.neutral[700],
                        transition: 'background-color 0.2s'
                      }
                }
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.backgroundColor = semanticColors.neutral[50];
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
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
