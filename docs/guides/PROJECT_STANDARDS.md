# Papuenvios - Project Standards & Best Practices

## 🎯 Core Principles

Every change to this project MUST follow these standards:

### 1. **Good Practices**
- Clean code architecture
- DRY (Don't Repeat Yourself)
- SOLID principles
- Proper error handling
- Type safety where applicable

### 2. **Optimization & Performance**
- Lazy loading components
- Image optimization (WebP, compression)
- Database query optimization
- Proper indexing
- Memoization where needed
- Code splitting

### 3. **Security**
- RLS (Row Level Security) on all tables
- Input validation (client + server)
- SQL injection prevention
- XSS prevention
- CSRF protection
- Secure authentication flow
- Environment variable protection

### 4. **SEO**
- Semantic HTML
- Meta tags (title, description, OG tags)
- Structured data (JSON-LD)
- Sitemap generation
- Robots.txt
- Alt text on images
- Performance optimization (Core Web Vitals)

### 5. **UX/UI**
- Responsive design (mobile-first)
- Accessibility (ARIA labels, keyboard navigation)
- Loading states
- Error states
- Empty states
- Consistent spacing/typography
- Color contrast (WCAG AA)
- Touch-friendly targets (min 44x44px)

### 6. **Bilingual Content**
- ALL user-facing text in ES/EN
- Language context properly used
- Toast messages bilingual
- Error messages bilingual
- Form labels bilingual
- Button text bilingual

### 7. **Context Awareness**
- Understand current state before changes
- Check related components
- Review existing patterns
- Don't break working features
- Maintain consistency

### 8. **Deep Analysis**
- Check entire feature flow
- Review all related files
- Test edge cases
- Consider user journey
- Think about data integrity

### 9. **TDD/Testing Oriented**
- Write tests first when possible
- Test user flows
- Test error scenarios
- Test edge cases
- Manual testing checklist

---

## 📋 Pre-Change Checklist

Before making ANY change:

- [ ] Read related code
- [ ] Understand current implementation
- [ ] Check for similar patterns in project
- [ ] Identify affected components
- [ ] Plan bilingual support
- [ ] Consider security implications
- [ ] Think about performance
- [ ] Review accessibility
- [ ] Check mobile responsiveness
- [ ] Plan error handling

---

## 🔧 Implementation Standards

### Database Changes

**MUST:**
```sql
-- 1. Add RLS policies
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- 2. Public read for active items
CREATE POLICY "table_viewable_by_everyone"
ON table_name FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- 3. Admin full CRUD
CREATE POLICY "table_manageable_by_admins"
ON table_name FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- 4. Grant permissions
GRANT SELECT ON table_name TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON table_name TO authenticated;

-- 5. Add indexes for performance
CREATE INDEX idx_table_field ON table_name(field);
```

### React Components

**MUST:**
```jsx
// 1. Import bilingual context
import { useLanguage } from '@/contexts/LanguageContext';

// 2. Use language in component
const { language, t } = useLanguage();

// 3. All text bilingual
<button>
  {language === 'es' ? 'Guardar' : 'Save'}
</button>

// 4. Toast messages bilingual
toast({
  title: language === 'es' ? 'Éxito' : 'Success',
  description: language === 'es'
    ? 'Operación completada'
    : 'Operation completed'
});

// 5. Loading states
{loading && <LoadingSpinner />}

// 6. Error states
{error && <ErrorMessage message={error} />}

// 7. Empty states
{items.length === 0 && (
  <p>{language === 'es' ? 'No hay elementos' : 'No items'}</p>
)}

// 8. Accessibility
<button aria-label={language === 'es' ? 'Cerrar' : 'Close'}>
  <X />
</button>
```

### CRUD Operations

**MUST:**
```javascript
// 1. Use UUID for database operations
const handleDelete = async (uuid) => {
  // NOT slug, NOT display ID
  await deleteItem(uuid);
};

// 2. Validate input
if (!formData.name || !formData.email) {
  toast({
    title: language === 'es' ? 'Error' : 'Error',
    description: language === 'es'
      ? 'Complete todos los campos requeridos'
      : 'Fill all required fields',
    variant: 'destructive'
  });
  return;
}

// 3. Handle errors properly
try {
  const { error } = await createItem(data);
  if (error) throw error;

  toast({
    title: language === 'es' ? 'Creado' : 'Created',
    description: language === 'es'
      ? 'El elemento se creó exitosamente'
      : 'Item created successfully'
  });

  await refreshItems();
  resetForm();
} catch (error) {
  console.error('Error creating item:', error);
  toast({
    title: 'Error',
    description: error.message || (language === 'es'
      ? 'Error al crear el elemento'
      : 'Error creating item'),
    variant: 'destructive'
  });
}

// 4. Confirmation for destructive actions
const confirmMessage = language === 'es'
  ? '¿Está seguro de que desea eliminar?'
  : 'Are you sure you want to delete?';

if (!confirm(confirmMessage)) return;
```

### Form Handling

**MUST:**
```jsx
// 1. Controlled inputs
const [formData, setFormData] = useState({
  name_es: '',
  name_en: '',
  description_es: '',
  description_en: ''
});

// 2. Labels for accessibility
<label className="block text-sm font-medium mb-2">
  {language === 'es' ? 'Nombre (Español)' : 'Name (Spanish)'} *
</label>
<input
  type="text"
  value={formData.name_es}
  onChange={e => setFormData({...formData, name_es: e.target.value})}
  placeholder={language === 'es' ? 'Ej: Producto' : 'Ex: Product'}
  className="input-style w-full"
  required
  aria-required="true"
/>

// 3. Show what mode (create/edit)
<h2>
  {isEditing
    ? (language === 'es' ? 'Editar' : 'Edit')
    : (language === 'es' ? 'Crear Nuevo' : 'Create New')
  }
</h2>

// 4. Dynamic button text
<Button onClick={handleSubmit}>
  {isEditing ? (
    <><Save className="mr-2 h-4 w-4" />
    {language === 'es' ? 'Actualizar' : 'Update'}</>
  ) : (
    <><Plus className="mr-2 h-4 w-4" />
    {language === 'es' ? 'Crear' : 'Create'}</>
  )}
</Button>

// 5. Cancel button when editing
{isEditing && (
  <Button variant="outline" onClick={resetForm}>
    <X className="mr-2 h-4 w-4" />
    {language === 'es' ? 'Cancelar' : 'Cancel'}
  </Button>
)}
```

---

## 🔍 Code Review Checklist

Before committing ANY code:

### Functionality
- [ ] Feature works as expected
- [ ] No console errors
- [ ] No console warnings
- [ ] Edge cases handled
- [ ] Error scenarios tested

### Bilingual
- [ ] All text is bilingual
- [ ] Toast messages in both languages
- [ ] Form labels in both languages
- [ ] Button text in both languages
- [ ] Error messages in both languages
- [ ] Empty states in both languages

### Security
- [ ] Input validation present
- [ ] RLS policies created
- [ ] No SQL injection possible
- [ ] No XSS vulnerabilities
- [ ] Proper authentication checks
- [ ] Environment variables not exposed

### Performance
- [ ] No unnecessary re-renders
- [ ] Images optimized
- [ ] Lazy loading where applicable
- [ ] Database queries optimized
- [ ] Proper indexing

### UX/UI
- [ ] Mobile responsive
- [ ] Loading states present
- [ ] Error states present
- [ ] Empty states present
- [ ] Accessibility labels
- [ ] Keyboard navigation works
- [ ] Touch targets min 44px

### SEO
- [ ] Semantic HTML used
- [ ] Meta tags present
- [ ] Alt text on images
- [ ] Proper heading hierarchy
- [ ] No broken links

### Code Quality
- [ ] No code duplication
- [ ] Proper variable names
- [ ] Comments where needed
- [ ] Consistent formatting
- [ ] No hardcoded values
- [ ] Error handling present

---

## 🚨 Common Mistakes to Avoid

### ❌ DON'T:
```javascript
// 1. Mix UUID and slug
handleDelete(category.slug) // ❌ Wrong

// 2. Hardcode language
<button>Guardar</button> // ❌ Wrong

// 3. Ignore errors
await deleteItem(id); // ❌ No error handling

// 4. Skip validation
createItem(formData); // ❌ No validation

// 5. Use slug for CRUD
.eq('slug', slugValue) // ❌ Wrong
```

### ✅ DO:
```javascript
// 1. Always use UUID for CRUD
handleDelete(category.id) // ✅ Correct (UUID)

// 2. Always bilingual
<button>{language === 'es' ? 'Guardar' : 'Save'}</button>

// 3. Handle errors
try {
  await deleteItem(id);
} catch (error) {
  toast({ title: 'Error', description: error.message });
}

// 4. Validate input
if (!formData.name) {
  toast({ title: 'Error', description: 'Name required' });
  return;
}

// 5. Use UUID for CRUD
.eq('id', uuidValue) // ✅ Correct
```

---

## 📊 Testing Matrix

For every feature, test:

| Scenario | ES | EN | Mobile | Desktop | Edge Case |
|----------|----|----|--------|---------|-----------|
| Create | ✅ | ✅ | ✅ | ✅ | Empty fields |
| Read | ✅ | ✅ | ✅ | ✅ | No data |
| Update | ✅ | ✅ | ✅ | ✅ | Duplicate name |
| Delete | ✅ | ✅ | ✅ | ✅ | Used by others |
| Error | ✅ | ✅ | ✅ | ✅ | Network failure |

---

## 🎯 Current Project State (Context)

### Fixed Issues ✅
1. Category CRUD (UUID vs slug)
2. Bilingual support in categories
3. Description fields added
4. Auto-slug generation
5. RLS policies for all tables
6. Context provider error
7. React Helmet deprecation

### Current Architecture

**Frontend:**
- React 18 + Vite
- TailwindCSS + Framer Motion
- Context API (Auth, Business, Language)
- Supabase client

**Backend:**
- Supabase (PostgreSQL)
- Row Level Security
- Auth with Google OAuth
- Real-time subscriptions

**State Management:**
- AuthContext - User authentication
- BusinessContext - Products, categories, combos
- LanguageContext - ES/EN switching

**Key Patterns:**
- Protected routes with HOC
- Bilingual content via context
- UUID for DB operations
- Slug for display/URLs
- Soft deletes (is_active)
- Error boundaries

### Database Schema
- user_profiles (UUID, role-based)
- products (with categories, currencies)
- product_categories (UUID + slug)
- combo_products + combo_items
- orders + order_items
- inventory + movements
- carousel_slides
- testimonials
- And more...

---

## 📝 Change Template

When making changes, follow this format:

```markdown
## Change: [Feature Name]

### Context
- Current state: [What exists now]
- Problem: [What needs fixing/adding]
- Impact: [What this affects]

### Solution
- Approach: [How you'll fix it]
- Files changed: [List files]
- Database changes: [If any]

### Bilingual Implementation
- [ ] All text bilingual
- [ ] Toast messages
- [ ] Form labels
- [ ] Error messages

### Security Checklist
- [ ] Input validation
- [ ] RLS policies
- [ ] No injection risks
- [ ] Proper auth checks

### Testing Done
- [ ] Created item
- [ ] Updated item
- [ ] Deleted item
- [ ] Error scenarios
- [ ] Both languages
- [ ] Mobile + Desktop

### Performance
- [ ] No unnecessary renders
- [ ] Optimized queries
- [ ] Images optimized

### Accessibility
- [ ] ARIA labels
- [ ] Keyboard navigation
- [ ] Screen reader friendly
```

---

## 🎓 Learning Resources

### Internal Patterns
Study these files to understand patterns:
- `src/components/VendorPage.jsx` - CRUD example
- `src/contexts/BusinessContext.jsx` - Context pattern
- `src/lib/productService.js` - Service layer
- `supabase/FIX_ALL_ERRORS.sql` - RLS patterns

### External Resources
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
- [React Best Practices](https://react.dev/learn/thinking-in-react)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Core Web Vitals](https://web.dev/vitals/)

---

**Remember:** Every change should make the project better, not just different.
Every line of code should serve a purpose.
Every feature should work in both languages.
Every operation should be secure by default.

---

**Last Updated:** 2025-10-01
**Project Version:** 1.0.0
**Status:** Active Development
