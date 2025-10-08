# SEO Optimization Guide - Papuenvios

## 🎯 Current SEO Status

### Implemented ✅
- Meta tags (title, description)
- Semantic HTML structure
- react-helmet-async for dynamic meta tags

### Needs Implementation 🔧
- Structured data (JSON-LD)
- Sitemap generation
- Robots.txt
- Open Graph tags
- Twitter Card tags
- Canonical URLs
- Schema.org markup
- Image optimization
- URL structure optimization

---

## 📋 SEO Implementation Checklist

### 1. Meta Tags (Per Page)

**Required on ALL pages:**
```jsx
import { Helmet } from 'react-helmet-async';

<Helmet>
  {/* Primary Meta Tags */}
  <title>{language === 'es'
    ? 'Título en Español - Papuenvios'
    : 'Title in English - Papuenvios'}
  </title>
  <meta name="description" content={language === 'es'
    ? 'Descripción en español con palabras clave relevantes'
    : 'Description in English with relevant keywords'}
  />
  <meta name="keywords" content="e-commerce, remesas, envíos, Cuba, USA, España, combos" />

  {/* Open Graph / Facebook */}
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://papuenvios.com/" />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={pageDescription} />
  <meta property="og:image" content="https://papuenvios.com/og-image.jpg" />
  <meta property="og:locale" content={language === 'es' ? 'es_ES' : 'en_US'} />
  <meta property="og:locale:alternate" content={language === 'es' ? 'en_US' : 'es_ES'} />

  {/* Twitter */}
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content="https://papuenvios.com/" />
  <meta property="twitter:title" content={pageTitle} />
  <meta property="twitter:description" content={pageDescription} />
  <meta property="twitter:image" content="https://papuenvios.com/twitter-image.jpg" />

  {/* Canonical URL */}
  <link rel="canonical" href="https://papuenvios.com/products" />

  {/* Alternate Language */}
  <link rel="alternate" hrefLang="es" href="https://papuenvios.com/es/products" />
  <link rel="alternate" hrefLang="en" href="https://papuenvios.com/en/products" />
  <link rel="alternate" hrefLang="x-default" href="https://papuenvios.com/products" />
</Helmet>
```

---

### 2. Structured Data (JSON-LD)

#### Organization Schema
```jsx
<Helmet>
  <script type="application/ld+json">
    {JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Papuenvios",
      "url": "https://papuenvios.com",
      "logo": "https://papuenvios.com/logo.png",
      "description": language === 'es'
        ? "Plataforma de comercio digital y remesas a Cuba desde USA y España"
        : "Digital commerce platform and remittances to Cuba from USA and Spain",
      "address": {
        "@type": "PostalAddress",
        "addressCountry": "US"
      },
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "email": "info@papuenvios.com"
      },
      "sameAs": [
        "https://facebook.com/papuenvios",
        "https://instagram.com/papuenvios",
        "https://twitter.com/papuenvios"
      ]
    })}
  </script>
</Helmet>
```

#### Product Schema (on product pages)
```jsx
<Helmet>
  <script type="application/ld+json">
    {JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": product.name,
      "description": product.description,
      "image": product.image_url,
      "sku": product.sku,
      "offers": {
        "@type": "Offer",
        "url": `https://papuenvios.com/products/${product.slug}`,
        "priceCurrency": "USD",
        "price": product.final_price,
        "availability": product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        "seller": {
          "@type": "Organization",
          "name": "Papuenvios"
        }
      },
      "aggregateRating": product.rating && {
        "@type": "AggregateRating",
        "ratingValue": product.rating,
        "reviewCount": product.reviewCount
      }
    })}
  </script>
</Helmet>
```

#### Breadcrumb Schema
```jsx
<Helmet>
  <script type="application/ld+json">
    {JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://papuenvios.com"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Products",
          "item": "https://papuenvios.com/products"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": product.name,
          "item": `https://papuenvios.com/products/${product.slug}`
        }
      ]
    })}
  </script>
</Helmet>
```

---

### 3. robots.txt

Create `/public/robots.txt`:
```txt
# Allow all crawlers
User-agent: *
Allow: /

# Disallow admin pages
Disallow: /admin
Disallow: /dashboard
Disallow: /settings
Disallow: /user-management
Disallow: /login
Disallow: /auth

# Disallow API endpoints
Disallow: /api/

# Sitemap location
Sitemap: https://papuenvios.com/sitemap.xml
```

---

### 4. Sitemap Generation

Create utility to generate sitemap:

```javascript
// scripts/generateSitemap.js
import { supabase } from '../src/lib/supabase.js';
import fs from 'fs';

async function generateSitemap() {
  // Get all public pages
  const { data: products } = await supabase
    .from('products')
    .select('slug, updated_at')
    .eq('is_active', true);

  const { data: categories } = await supabase
    .from('product_categories')
    .select('slug, updated_at')
    .eq('is_active', true);

  const staticPages = [
    { url: '', priority: '1.0', changefreq: 'daily' },
    { url: 'products', priority: '0.9', changefreq: 'daily' },
    { url: 'remittances', priority: '0.8', changefreq: 'weekly' },
    { url: 'cart', priority: '0.7', changefreq: 'weekly' },
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  ${staticPages.map(page => `
  <url>
    <loc>https://papuenvios.com/${page.url}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <xhtml:link rel="alternate" hreflang="es" href="https://papuenvios.com/es/${page.url}"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://papuenvios.com/en/${page.url}"/>
  </url>
  `).join('')}

  ${products?.map(product => `
  <url>
    <loc>https://papuenvios.com/products/${product.slug}</loc>
    <lastmod>${new Date(product.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <xhtml:link rel="alternate" hreflang="es" href="https://papuenvios.com/es/products/${product.slug}"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://papuenvios.com/en/products/${product.slug}"/>
  </url>
  `).join('') || ''}

  ${categories?.map(category => `
  <url>
    <loc>https://papuenvios.com/categories/${category.slug}</loc>
    <lastmod>${new Date(category.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
    <xhtml:link rel="alternate" hreflang="es" href="https://papuenvios.com/es/categories/${category.slug}"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://papuenvios.com/en/categories/${category.slug}"/>
  </url>
  `).join('') || ''}
</urlset>`;

  fs.writeFileSync('./public/sitemap.xml', sitemap);
  console.log('✅ Sitemap generated successfully!');
}

generateSitemap();
```

Add to package.json:
```json
{
  "scripts": {
    "generate:sitemap": "node scripts/generateSitemap.js"
  }
}
```

---

### 5. Image Optimization

**Requirements:**
- Use WebP format
- Provide alt text
- Lazy load images
- Responsive images
- Compress images

**Implementation:**
```jsx
// Component: OptimizedImage.jsx
import { useState } from 'react';

const OptimizedImage = ({
  src,
  alt,
  className,
  width,
  height,
  loading = 'lazy'
}) => {
  const [imageError, setImageError] = useState(false);

  // Fallback image
  const fallback = '/placeholder.webp';

  return (
    <picture>
      {/* WebP version */}
      <source
        type="image/webp"
        srcSet={`${src}.webp 1x, ${src}@2x.webp 2x`}
      />

      {/* Fallback JPG */}
      <img
        src={imageError ? fallback : src}
        alt={alt}
        className={className}
        width={width}
        height={height}
        loading={loading}
        onError={() => setImageError(true)}
      />
    </picture>
  );
};

// Usage
<OptimizedImage
  src="/products/product-image.jpg"
  alt={language === 'es' ? product.name_es : product.name_en}
  width={400}
  height={300}
  loading="lazy"
/>
```

---

### 6. URL Structure Best Practices

**Good URL Structure:**
```
✅ https://papuenvios.com/products/electronics
✅ https://papuenvios.com/products/samsung-galaxy-s24
✅ https://papuenvios.com/categories/electronics
✅ https://papuenvios.com/blog/how-to-send-remittances

❌ https://papuenvios.com/product?id=12345
❌ https://papuenvios.com/cat_view.php?cat=electronics
❌ https://papuenvios.com/page/12345/edit
```

**Implementation:**
- Use slugs not IDs in URLs
- Keep URLs short and descriptive
- Use hyphens not underscores
- Lowercase only
- Include keywords

---

### 7. Performance Optimization (Core Web Vitals)

#### Largest Contentful Paint (LCP) - Target: < 2.5s
```jsx
// Preload hero image
<Helmet>
  <link
    rel="preload"
    as="image"
    href="/hero-image.webp"
  />
</Helmet>

// Lazy load below-fold content
const ProductGrid = lazy(() => import('./ProductGrid'));
```

#### First Input Delay (FID) - Target: < 100ms
```jsx
// Debounce expensive operations
import { debounce } from 'lodash';

const handleSearch = debounce((query) => {
  searchProducts(query);
}, 300);
```

#### Cumulative Layout Shift (CLS) - Target: < 0.1
```jsx
// Always specify image dimensions
<img
  src={product.image}
  alt={product.name}
  width={400}
  height={300}  // Prevents layout shift
/>

// Reserve space for dynamic content
<div className="min-h-[200px]">
  {loading ? <Skeleton /> : <Content />}
</div>
```

---

### 8. Heading Hierarchy

**Proper Structure:**
```jsx
<h1>Main Page Title</h1>              {/* Only ONE h1 per page */}
  <h2>Section Title</h2>
    <h3>Subsection Title</h3>
      <h4>Detail Title</h4>
  <h2>Another Section</h2>
    <h3>Subsection</h3>

❌ DON'T skip levels (h1 → h3)
✅ DO follow hierarchy (h1 → h2 → h3)
```

**Example: Product Page**
```jsx
<h1>{product.name}</h1>
  <h2>Product Details</h2>
  <h2>Customer Reviews</h2>
    <h3>Rating: {rating}</h3>
  <h2>Related Products</h2>
  <h2>Shipping Information</h2>
```

---

### 9. Internal Linking Strategy

**Benefits:**
- Helps search engines discover content
- Distributes page authority
- Improves user navigation

**Implementation:**
```jsx
// Link to related products
<div className="related-products">
  <h3>Related Products</h3>
  {relatedProducts.map(p => (
    <Link
      to={`/products/${p.slug}`}
      aria-label={`View ${p.name}`}
    >
      {p.name}
    </Link>
  ))}
</div>

// Breadcrumbs
<nav aria-label="Breadcrumb">
  <ol>
    <li><Link to="/">Home</Link></li>
    <li><Link to="/products">Products</Link></li>
    <li><Link to={`/categories/${category.slug}`}>{category.name}</Link></li>
    <li aria-current="page">{product.name}</li>
  </ol>
</nav>

// Category navigation
<nav aria-label="Categories">
  {categories.map(cat => (
    <Link to={`/categories/${cat.slug}`}>
      {language === 'es' ? cat.name_es : cat.name_en}
    </Link>
  ))}
</nav>
```

---

### 10. Page-Specific SEO Implementation

#### Home Page
```jsx
<Helmet>
  <title>
    {language === 'es'
      ? 'Papuenvios - Comercio Digital y Remesas a Venezuela'
      : 'Papuenvios - Digital Commerce and Remittances to Venezuela'}
  </title>
  <meta name="description" content={language === 'es'
    ? 'Plataforma completa de comercio digital. Compra productos, envía remesas a Venezuela de forma rápida y segura.'
    : 'Complete digital commerce platform. Buy products, send remittances to Venezuela quickly and securely.'}
  />
  <meta name="keywords" content="remesas Venezuela, envíos, e-commerce, productos, dinero, transferencias" />
</Helmet>
```

#### Products Page
```jsx
<Helmet>
  <title>
    {language === 'es'
      ? 'Productos - Papuenvios'
      : 'Products - Papuenvios'}
  </title>
  <meta name="description" content={language === 'es'
    ? 'Explora nuestra amplia selección de productos. Electrónica, ropa, accesorios y más con envío internacional.'
    : 'Explore our wide selection of products. Electronics, clothing, accessories and more with international shipping.'}
  />
</Helmet>
```

#### Product Detail Page
```jsx
<Helmet>
  <title>
    {`${product.name} - Papuenvios`}
  </title>
  <meta name="description" content={
    language === 'es'
      ? product.description_es?.substring(0, 155)
      : product.description_en?.substring(0, 155)
  } />
  <meta property="og:type" content="product" />
  <meta property="product:price:amount" content={product.final_price} />
  <meta property="product:price:currency" content="USD" />
</Helmet>
```

---

### 11. Local SEO (if applicable)

```jsx
<Helmet>
  <script type="application/ld+json">
    {JSON.stringify({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "Papuenvios",
      "image": "https://papuenvios.com/logo.png",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "123 Main St",
        "addressLocality": "Miami",
        "addressRegion": "FL",
        "postalCode": "33101",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "25.7617",
        "longitude": "-80.1918"
      },
      "openingHoursSpecification": {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "09:00",
        "closes": "18:00"
      },
      "telephone": "+1-305-xxx-xxxx",
      "priceRange": "$$"
    })}
  </script>
</Helmet>
```

---

### 12. SEO Monitoring & Analytics

**Tools to Install:**
```bash
npm install @vercel/analytics
npm install @vercel/speed-insights
```

**Track:**
- Organic traffic
- Keyword rankings
- Page load times
- Bounce rate
- Conversion rate
- Core Web Vitals

**Google Tools:**
- Google Search Console
- Google Analytics 4
- Google PageSpeed Insights
- Lighthouse CI

---

## 📊 SEO Checklist (Per Page)

```markdown
[ ] Unique title tag (50-60 chars)
[ ] Unique meta description (150-160 chars)
[ ] One H1 tag
[ ] Proper heading hierarchy (H1 → H2 → H3)
[ ] Alt text on all images
[ ] Internal links to related content
[ ] External links (rel="noopener noreferrer")
[ ] Structured data (JSON-LD)
[ ] Canonical URL
[ ] Bilingual meta tags
[ ] Open Graph tags
[ ] Twitter Card tags
[ ] Mobile responsive
[ ] Fast loading (< 3s)
[ ] HTTPS enabled
[ ] No broken links
[ ] Clean URL structure
[ ] XML sitemap entry
```

---

**Remember:** SEO is ongoing, not one-time. Monitor, measure, and optimize continuously.

---

**Last Updated:** 2025-10-01
**Priority:** HIGH
**Impact:** Organic Traffic Growth
