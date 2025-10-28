# 📋 DEVELOPMENT STANDARDS & BEST PRACTICES

**Version:** 1.0
**Last Updated:** October 27, 2025
**Applies to:** All development, code reviews, and commits

---

## 🎯 CORE PRINCIPLES

1. **Code Security First** - Every change must be validated before commit
2. **No Regressions** - Never break existing functionality
3. **Dependency Awareness** - Verify impact before modifying files
4. **Clear Communication** - Document decisions and changes
5. **Respectful of Progress** - Build on achievements, don't destroy them

---

## ✅ CODE QUALITY STANDARDS

### File Modifications
- **ALWAYS read file first** before editing
- **ALWAYS check for dependencies** before changing
  - Search for imports: `grep -rn "filename" src/`
  - Check component usage: `grep -rn "ComponentName" src/`
  - Verify service calls across components
- **If uncertain,** ask for confirmation before proceeding
- **TEST immediately** after changes with `npm run build`

### Commit Messages
- **NO signatures** - Remove Claude/🤖/Co-Authored-By lines
- **Format:** `type: description` (e.g., `fix: Correct field mapping`)
- **Detailed body** explaining WHY the change was made
- **Include affected files** and areas impacted
- **Reference issues** if applicable
- **Keep it professional** and clear

### Error Handling
- Always log errors with context
- Use try-catch blocks appropriately
- Provide user-friendly error messages
- Log to console for debugging: `console.log('[Component] message:', data)`

### Token Optimization
- **Be concise** in code and documentation
- **Reuse existing functions** instead of rewriting
- **Consolidate documentation** (avoid multiple md files for same topic)
- **Remove redundant console logs** after testing
- **Batch related changes** into single commits
- **Use descriptive variable names** to reduce explanation needed

---

## 🔒 SECURITY REQUIREMENTS

### Authentication & Authorization
- ✅ Verify user role before sensitive operations
- ✅ Check `isAdmin` or `isSuperAdmin` where needed
- ✅ Use RLS policies on all database tables
- ✅ Implement signed URLs for private storage (1-hour expiration)

### Data Protection
- ❌ Never store credentials in code
- ❌ Never log sensitive data (passwords, tokens)
- ✅ Use environment variables for secrets
- ✅ Validate user input on both client and server
- ✅ Use file path prefixes (user_id/) for RLS enforcement

### File Upload Security
- ✅ Validate file type and size
- ✅ Store in private buckets, never public URLs
- ✅ Use signed URLs with expiration
- ✅ Implement malware scanning if needed

---

## 📝 DOCUMENTATION STANDARDS

### File Organization
- **ONE file per major category**
  - PROJECT_DEVELOPMENT_STATUS.md → Context, progress, issues
  - DEVELOPMENT_STANDARDS.md → Rules and practices (this file)
  - AGENT_BEHAVIOR_GUIDELINES.md → How agent should act

- **NO separate files** for:
  - Debug guides (include in STATUS)
  - Component recovery notes (include in STATUS)
  - Technical troubleshooting (include in STATUS)

### Status Tracking Format
- Use `✅` for completed
- Use `❌` for missing/broken
- Use `⚠️` for needs attention
- Use `🔴` for critical
- Use `🟡` for high priority
- Use `🟢` for low priority

### Code Comments
- Explain WHY, not WHAT
- Use clear, professional language
- Keep comments up-to-date with code
- Mark temporary code with `TODO:` or `FIXME:`

---

## 🧪 TESTING REQUIREMENTS

### Before Any Commit
1. Run `npm run build` - Must succeed
2. Check for TypeScript errors
3. Verify no console errors in browser
4. Test affected features manually
5. Check git diff for unintended changes

### After Commits
1. Verify build still works
2. Quick smoke test of main flows
3. Check that related features still work

### Integration Testing Checklist
- [ ] Component imports correctly
- [ ] Component props are passed correctly
- [ ] Callbacks execute as expected
- [ ] Error states handled
- [ ] Loading states work
- [ ] Responsive design still works
- [ ] Accessibility maintained

---

## 🚀 DEPLOYMENT CHECKLIST

Before deploying to production:
- [ ] All critical issues resolved
- [ ] No console errors
- [ ] Build succeeds with no warnings
- [ ] Bundle size acceptable
- [ ] Performance acceptable
- [ ] Security review passed
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] Backup created
- [ ] Rollback plan documented

---

## 🔄 GIT WORKFLOW

### Branch Strategy
```
main (production-ready)
  └─ local development branches
      ├─ feature/feature-name
      ├─ fix/bug-name
      └─ refactor/refactor-name
```

### Commit Process
1. Make changes with tests
2. Run `npm run build` - Must pass
3. Review changes with `git diff`
4. Stage files: `git add <files>`
5. Commit with clear message (NO signatures)
6. Verify: `git log --oneline -5`

### Commit Message Template
```
type: concise description (50 chars max)

Detailed explanation of why this change was made.
Include what was changed and the impact.

Files affected:
- src/components/ComponentName.jsx
- src/lib/serviceName.js

Issues resolved:
- Fixes remittance workflow
- Improves performance
```

---

## 🔍 CODE REVIEW CHECKLIST

Before considering code "done":

### Correctness
- [ ] Logic is correct
- [ ] Edge cases handled
- [ ] No infinite loops
- [ ] No memory leaks
- [ ] Async operations properly handled

### Quality
- [ ] Code is readable
- [ ] Naming is descriptive
- [ ] Functions are focused (single responsibility)
- [ ] No duplication
- [ ] Properly formatted

### Safety
- [ ] No security vulnerabilities
- [ ] Input validation present
- [ ] Error handling present
- [ ] No console.log left from debugging
- [ ] No hardcoded values

### Testing
- [ ] Builds successfully
- [ ] No console errors
- [ ] Manual testing completed
- [ ] Related features still work
- [ ] No TypeScript errors

### Documentation
- [ ] Changes documented in code comments if complex
- [ ] Status file updated
- [ ] Dependencies documented if added

---

## ⚡ PERFORMANCE GUIDELINES

### Bundle Size
- Current: 924 kB (251 kB gzipped)
- Target: < 500 kB (150 kB gzipped)
- Use code splitting for large components
- Lazy load routes
- Remove unused dependencies

### Runtime Performance
- Avoid unnecessary re-renders
- Use React.memo for expensive components
- Implement pagination for large lists
- Optimize database queries
- Cache API results appropriately

### Database Performance
- Create indexes for frequently queried columns
- Use LIMIT for large result sets
- Avoid N+1 queries
- Use connection pooling
- Monitor slow queries

---

## 🎨 CODE STYLE

### JavaScript/React
- Use functional components, not class components
- Use hooks for state management
- Use descriptive variable names
- Use arrow functions
- Avoid var, use const/let
- Use template literals for strings

### CSS/Tailwind
- Use Tailwind utility classes
- Create reusable component classes
- Avoid inline styles
- Use responsive breakpoints
- Ensure accessibility (colors, contrast)

### File Organization
- One component per file
- Related utilities in shared lib files
- Services organized by domain
- Constants grouped logically

---

## 📱 ACCESSIBILITY STANDARDS

### Required
- [ ] Proper semantic HTML
- [ ] ARIA labels where needed
- [ ] Keyboard navigation support
- [ ] Color contrast minimum 4.5:1
- [ ] Focus indicators visible
- [ ] Alt text for images
- [ ] Form labels connected to inputs

### Testing
- Test with keyboard only
- Test with screen reader
- Test with high contrast mode
- Validate HTML

---

## 🌍 INTERNATIONALIZATION

### Translation Keys
- Use dot notation: `navigation.myRemittances`
- Group by feature: `remittances.*, orders.*, etc`
- Use descriptive keys
- Keep values in JSON files

### Language Support
- ✅ Spanish (ES)
- ✅ English (EN)
- Add new languages to translations
- Test both languages in UI

---

## 🐛 DEBUGGING PROCESS

When issues occur:

1. **Reproduce** - Can you repeat the issue?
2. **Isolate** - Which component/function fails?
3. **Log** - Add console.logs with context
4. **Check** - Review recent git changes
5. **Search** - Similar issues elsewhere?
6. **Fix** - Apply minimal fix
7. **Test** - Verify fix works and doesn't break others
8. **Document** - Update status file

### Debug Logging Format
```javascript
console.log('[ComponentName] Action description:', data);
console.warn('[ComponentName] Warning message:', value);
console.error('[ComponentName] Error message:', error);
```

---

## ✋ WHEN IN DOUBT

Ask before proceeding:
- "Is it safe to modify file X?"
- "What are the dependencies of component Y?"
- "Should I update Z after this change?"
- "Is this the right approach?"
- "Can I verify this doesn't break something?"

Better to ask and be safe than destroy functionality.

---

## 📊 METRICS & MONITORING

### Key Metrics
- Build time
- Bundle size
- Build errors/warnings
- Test coverage
- Performance (Lighthouse)
- Error rates
- User feedback

### Monitoring
- Track build times
- Monitor error logs
- Watch bundle size growth
- Review performance metrics
- Analyze user issues

---

## 🎯 DEFINITION OF DONE

A feature is done when:
1. ✅ Code is written and tested
2. ✅ All tests pass
3. ✅ Build succeeds
4. ✅ No console errors
5. ✅ Related features verified
6. ✅ Documentation updated
7. ✅ Security reviewed
8. ✅ Performance acceptable
9. ✅ Deployed successfully
10. ✅ Status file updated

---

**Remember:** These standards exist to protect the project and ensure quality.
Following them makes development faster, safer, and more professional.
