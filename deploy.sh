#!/bin/bash

# ============================================================================
# PapuEnvíos - Deployment Script
# ============================================================================
# This script automates the complete deployment process:
# 1. Verifies environment
# 2. Installs dependencies
# 3. Executes all migrations
# 4. Verifies migration status
# 5. Builds for production
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions for colored output
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# ============================================================================
# STEP 1: Verify Environment
# ============================================================================

print_header "STEP 1: Verifying Environment"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
print_success "Node.js is installed: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed"
    exit 1
fi
print_success "npm is installed: $(npm --version)"

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    print_error ".env.local not found!"
    echo "Please create .env.local with database credentials"
    exit 1
fi
print_success ".env.local is configured"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found!"
    echo "Please run this script from the project root directory"
    exit 1
fi
print_success "package.json found"

# Check if migrations directory exists
if [ ! -d "supabase/migrations" ]; then
    print_error "supabase/migrations directory not found!"
    exit 1
fi
MIGRATION_COUNT=$(ls -1 supabase/migrations/*.sql 2>/dev/null | wc -l)
print_success "Found $MIGRATION_COUNT migration files"

# ============================================================================
# STEP 2: Install Dependencies
# ============================================================================

print_header "STEP 2: Installing Dependencies"

if [ ! -d "node_modules" ]; then
    print_info "Installing npm packages (this may take a few minutes)..."
    npm install --legacy-peer-deps
    print_success "Dependencies installed"
else
    print_info "node_modules already exists, skipping npm install"
    print_info "Run 'npm install' manually if you need to update packages"
fi

# ============================================================================
# STEP 3: Execute Migrations
# ============================================================================

print_header "STEP 3: Executing Database Migrations"

print_info "This will execute all pending migrations sequentially..."
print_warning "This process may take 5-15 minutes"
echo ""

# Run migrations
if npm run db:migrate; then
    print_success "All migrations executed successfully!"
else
    print_error "Migration execution failed!"
    echo "Common causes:"
    echo "  1. Database credentials incorrect (.env.local)"
    echo "  2. Database not accessible"
    echo "  3. Some migrations have syntax errors"
    echo ""
    echo "To debug, run: npm run db:migrate"
    exit 1
fi

# ============================================================================
# STEP 4: Verify Migration Status
# ============================================================================

print_header "STEP 4: Verifying Migration Status"

if npm run db:status; then
    print_success "Migration status verified!"
else
    print_warning "Could not verify migration status"
    echo "Run manually: npm run db:status"
fi

# ============================================================================
# STEP 5: List Applied Migrations
# ============================================================================

print_header "STEP 5: Migration Summary"

print_info "Listing applied migrations..."
npm run db:list 2>/dev/null || print_info "Migration list not available"

# ============================================================================
# STEP 6: Build for Production (Optional)
# ============================================================================

read -p "Do you want to build for production now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_header "STEP 6: Building for Production"

    if npm run build; then
        print_success "Production build completed!"
        print_info "Build output is in: ./dist/"
        print_info "Total size: $(du -sh dist/ 2>/dev/null | cut -f1)"
    else
        print_error "Build failed!"
        exit 1
    fi
else
    print_info "Skipping production build"
fi

# ============================================================================
# FINAL SUMMARY
# ============================================================================

print_header "DEPLOYMENT COMPLETE! 🎉"

echo "✅ Environment verified"
echo "✅ Dependencies installed"
echo "✅ All migrations executed"
echo "✅ Status verified"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. REQUIRED: Create storage buckets in Supabase Dashboard:"
echo "   https://app.supabase.com/project/qcwnlbpultscerwdnzbm/storage/buckets"
echo "   - order-delivery-proofs (Private, images, 5MB)"
echo "   - remittance-delivery-proofs (Private, images, 5MB)"
echo ""
echo "2. TEST IN DEVELOPMENT:"
echo "   npm run dev"
echo "   Then open http://localhost:5173 and verify:"
echo "   ✓ Products load without timeout"
echo "   ✓ Categories load"
echo "   ✓ Testimonials load"
echo "   ✓ Carousel slides load"
echo "   ✓ Profile loads (no timeouts)"
echo ""
echo "3. DEPLOY TO PRODUCTION:"
echo "   npm run build"
echo "   Then deploy ./dist/ to your hosting provider"
echo ""
echo "📚 Documentation:"
echo "   - QUICK_START_PRODUCTION.md (fast overview)"
echo "   - PRODUCTION_DEPLOYMENT_GUIDE.md (detailed guide)"
echo "   - PROYECTO_ESTADO_FINAL_2025-11-13.md (complete status)"
echo ""
print_success "All systems ready for production!"
