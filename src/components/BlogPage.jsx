import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ArrowLeft, Play, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPublications } from '@/lib/publicationService';
import { getHeadingStyle } from '@/lib/styleUtils';

const CATEGORIES = [
  { value: 'all', labelEs: 'Todas', labelEn: 'All' },
  { value: 'orders', labelEs: 'Pedidos', labelEn: 'Orders' },
  { value: 'remittances', labelEs: 'Remesas', labelEn: 'Remittances' },
  { value: 'recipients', labelEs: 'Destinatarios', labelEn: 'Recipients' },
  { value: 'user-panel', labelEs: 'Panel de Usuario', labelEn: 'User Panel' },
  { value: 'general', labelEs: 'General', labelEn: 'General' }
];

/**
 * Parse a YouTube/Vimeo URL into an embeddable URL
 */
function getEmbedUrl(url) {
  if (!url) return null;
  try {
    // YouTube: youtube.com/watch?v=ID or youtu.be/ID
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

    // Vimeo: vimeo.com/ID
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Get category badge color
 */
function getCategoryColor(category) {
  const colors = {
    orders: { bg: 'bg-blue-100', text: 'text-blue-700' },
    remittances: { bg: 'bg-green-100', text: 'text-green-700' },
    recipients: { bg: 'bg-purple-100', text: 'text-purple-700' },
    'user-panel': { bg: 'bg-amber-100', text: 'text-amber-700' },
    general: { bg: 'bg-gray-100', text: 'text-gray-700' }
  };
  return colors[category] || colors.general;
}

const BlogPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedArticle, setSelectedArticle] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const pubs = await getPublications();
        setPublications(pubs);
      } catch (error) {
        console.error('Error loading publications:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = activeCategory === 'all'
    ? publications
    : publications.filter(p => p.category === activeCategory);

  const getCategoryLabel = (value) => {
    const cat = CATEGORIES.find(c => c.value === value);
    return cat ? (language === 'es' ? cat.labelEs : cat.labelEn) : value;
  };

  // Render content as paragraphs (split by double newlines)
  const renderContent = (text) => {
    if (!text) return null;
    return text.split(/\n\n+/).map((paragraph, i) => (
      <p key={i} className="mb-3 text-gray-700 leading-relaxed">
        {paragraph.split('\n').map((line, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {line}
          </React.Fragment>
        ))}
      </p>
    ));
  };

  // Article detail view
  if (selectedArticle) {
    const title = language === 'es' ? selectedArticle.title_es : selectedArticle.title_en;
    const content = language === 'es' ? selectedArticle.content_es : selectedArticle.content_en;
    const embedUrl = getEmbedUrl(selectedArticle.video_url);
    const catColor = getCategoryColor(selectedArticle.category);

    return (
      <div className="min-h-screen py-8 px-4">
        <div className="container mx-auto max-w-4xl">
          <Button
            variant="ghost"
            onClick={() => setSelectedArticle(null)}
            className="mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('blog.backToList')}
          </Button>

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-effect rounded-2xl overflow-hidden"
          >
            {/* Cover image */}
            {selectedArticle.cover_image_url && (
              <div className="w-full h-64 md:h-80 overflow-hidden">
                <img
                  src={selectedArticle.cover_image_url}
                  alt={title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="p-8">
              {/* Category badge */}
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${catColor.bg} ${catColor.text} mb-4`}>
                {getCategoryLabel(selectedArticle.category)}
              </span>

              {/* Title */}
              <h1 className="text-3xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>
                {title}
              </h1>

              {/* Video embed */}
              {embedUrl && (
                <div className="mb-6 rounded-xl overflow-hidden aspect-video">
                  <iframe
                    src={embedUrl}
                    title={title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              {/* Content */}
              <div className="prose max-w-none">
                {renderContent(content)}
              </div>
            </div>
          </motion.article>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-4xl font-bold mb-3" style={getHeadingStyle(visualSettings)}>
            {t('blog.title')}
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            {t('blog.subtitle')}
          </p>
        </motion.div>

        {/* Category filter tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-wrap gap-2 justify-center mb-8"
        >
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat.value
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={activeCategory === cat.value ? {
                background: visualSettings.useGradient
                  ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                  : visualSettings.primaryColor || '#2563eb'
              } : undefined}
            >
              {language === 'es' ? cat.labelEs : cat.labelEn}
            </button>
          ))}
        </motion.div>

        {/* Articles grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((pub, index) => {
              const title = language === 'es' ? pub.title_es : pub.title_en;
              const content = language === 'es' ? pub.content_es : pub.content_en;
              const preview = content ? content.substring(0, 120) + (content.length > 120 ? '...' : '') : '';
              const catColor = getCategoryColor(pub.category);

              return (
                <motion.div
                  key={pub.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="glass-effect rounded-2xl overflow-hidden hover-lift cursor-pointer group"
                  onClick={() => setSelectedArticle(pub)}
                >
                  {/* Cover image or gradient placeholder */}
                  <div className="h-40 overflow-hidden">
                    {pub.cover_image_url ? (
                      <img
                        src={pub.cover_image_url}
                        alt={title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{
                          background: visualSettings.useGradient
                            ? `linear-gradient(135deg, ${visualSettings.primaryColor || '#2563eb'}40, ${visualSettings.secondaryColor || '#9333ea'}40)`
                            : `${visualSettings.primaryColor || '#2563eb'}20`
                        }}
                      >
                        <BookOpen className="h-10 w-10 text-gray-400" />
                      </div>
                    )}
                  </div>

                  <div className="p-5">
                    {/* Category badge + video indicator */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catColor.bg} ${catColor.text}`}>
                        {getCategoryLabel(pub.category)}
                      </span>
                      {pub.video_url && (
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <Play className="h-3 w-3" />
                          {t('blog.watchVideo')}
                        </span>
                      )}
                    </div>

                    <h3 className="font-semibold text-lg mb-2 line-clamp-2">{title}</h3>
                    <p className="text-sm text-gray-500 line-clamp-3">{preview}</p>

                    <span
                      className="inline-block mt-3 text-sm font-medium"
                      style={{ color: visualSettings.primaryColor || '#2563eb' }}
                    >
                      {t('blog.readMore')} →
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('blog.noArticles')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlogPage;
