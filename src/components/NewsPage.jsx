import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, User, Tag, Search, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';

const NewsPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const newsArticles = [
    {
      id: 1,
      title: t('news.articles.1.title'),
      excerpt: t('news.articles.1.excerpt'),
      category: 'business',
      author: 'María González',
      date: '2024-01-15',
      readTime: '5 min',
      featured: true
    },
    {
      id: 2,
      title: t('news.articles.2.title'),
      excerpt: t('news.articles.2.excerpt'),
      category: 'technology',
      author: 'Carlos Rodríguez',
      date: '2024-01-14',
      readTime: '3 min',
      featured: false
    },
    {
      id: 3,
      title: t('news.articles.3.title'),
      excerpt: t('news.articles.3.excerpt'),
      category: 'economy',
      author: 'Ana Martínez',
      date: '2024-01-13',
      readTime: '7 min',
      featured: false
    },
    {
      id: 4,
      title: t('news.articles.4.title'),
      excerpt: t('news.articles.4.excerpt'),
      category: 'business',
      author: 'Luis Fernández',
      date: '2024-01-12',
      readTime: '4 min',
      featured: false
    }
  ];

  const categories = ['all', 'business', 'technology', 'economy'];

  const filteredArticles = newsArticles.filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         article.excerpt.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleReadMore = (article) => {
    toast({
      title: "🚧 Esta funcionalidad no está implementada aún—¡pero no te preocupes! ¡Puedes solicitarla en tu próximo prompt! 🚀",
    });
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold mb-4 gradient-text">
            {t('news.title')}
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {t('news.subtitle')}
          </p>
        </motion.div>

        {/* Search and Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-effect p-6 rounded-2xl mb-8"
        >
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder={t('news.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Tag className="w-5 h-5 text-gray-400" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {categories.map(category => (
                  <option key={category} value={category}>
                    {t(`news.categories.${category}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>

        {/* Featured Article */}
        {filteredArticles.find(article => article.featured) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-12"
          >
            {(() => {
              const featured = filteredArticles.find(article => article.featured);
              return (
                <div className="glass-effect rounded-2xl overflow-hidden hover-lift">
                  <div className="md:flex">
                    <div className="md:w-1/2">
                      <img 
                        className="w-full h-64 md:h-full object-cover"
                        alt={featured.title}
                       src="https://images.unsplash.com/photo-1662485732745-5a841bfe7f65" />
                    </div>
                    <div className="md:w-1/2 p-8">
                      <div className="flex items-center mb-4">
                        <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold mr-3">
                          {t('news.featured')}
                        </span>
                        <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">
                          {t(`news.categories.${featured.category}`)}
                        </span>
                      </div>
                      
                      <h2 className="text-2xl font-bold mb-4">{featured.title}</h2>
                      <p className="text-gray-600 mb-6">{featured.excerpt}</p>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <div className="flex items-center">
                            <User className="w-4 h-4 mr-1" />
                            {featured.author}
                          </div>
                          <div className="flex items-center">
                            <Calendar className="w-4 h-4 mr-1" />
                            {new Date(featured.date).toLocaleDateString()}
                          </div>
                          <div>{featured.readTime}</div>
                        </div>
                        
                        <Button onClick={() => handleReadMore(featured)}>
                          {t('news.readMore')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* Articles Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArticles.filter(article => !article.featured).map((article, index) => (
            <motion.div
              key={article.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="glass-effect rounded-2xl overflow-hidden hover-lift"
            >
              <img 
                className="w-full h-48 object-cover"
                alt={article.title}
               src="https://images.unsplash.com/photo-1662485732745-5a841bfe7f65" />
              
              <div className="p-6">
                <div className="flex items-center mb-3">
                  <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs mr-3">
                    {t(`news.categories.${article.category}`)}
                  </span>
                  <TrendingUp className="w-4 h-4 text-green-500" />
                </div>
                
                <h3 className="text-lg font-semibold mb-3 line-clamp-2">{article.title}</h3>
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">{article.excerpt}</p>
                
                <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                  <div className="flex items-center">
                    <User className="w-3 h-3 mr-1" />
                    {article.author}
                  </div>
                  <div className="flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {new Date(article.date).toLocaleDateString()}
                  </div>
                  <div>{article.readTime}</div>
                </div>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleReadMore(article)}
                  className="w-full"
                >
                  {t('news.readMore')}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Empty State */}
        {filteredArticles.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              {t('news.noArticles')}
            </h3>
            <p className="text-gray-500">{t('news.noArticlesDesc')}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default NewsPage;