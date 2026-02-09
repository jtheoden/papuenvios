/**
 * DIAGNOSTICS MODULE - Comprehensive system health check
 * Runs on application startup to identify issues
 * Logs detailed telemetry for troubleshooting
 */

const DIAGNOSTICS_VERSION = '1.0.0';
const TIMESTAMP = new Date().toISOString();

class SystemDiagnostics {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.info = [];
    this.performance = {};
  }

  /**
   * Check environment variables
   */
  checkEnvironment() {
    console.group('🔧 ENVIRONMENT CHECK');

    const requiredVars = [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY'
    ];

    requiredVars.forEach(varName => {
      const value = import.meta.env[varName];
      if (!value) {
        this.issues.push(`Missing environment variable: ${varName}`);
        console.error(`❌ ${varName}: NOT SET`);
      } else {
        this.info.push(`${varName} is set`);
      }
    });

    console.groupEnd();
  }

  /**
   * Check localStorage and persistence
   */
  checkStorage() {
    console.group('💾 STORAGE CHECK');

    try {
      localStorage.setItem('__diagnostics_test', Date.now().toString());
      const value = localStorage.getItem('__diagnostics_test');
      localStorage.removeItem('__diagnostics_test');

      if (value) {
        this.info.push('localStorage functional');
      }
    } catch (e) {
      this.warnings.push(`localStorage error: ${e.message}`);
      console.warn('⚠️ localStorage: May be limited or disabled');
    }

    // Check for auth session
    const authSession = localStorage.getItem('papuenvios-auth');
    if (authSession) {
    } else {
    }

    console.groupEnd();
  }

  /**
   * Check browser API support
   */
  checkBrowserAPIs() {
    console.group('🌐 BROWSER API CHECK');

    const apis = {
      'LocalStorage': typeof localStorage !== 'undefined',
      'SessionStorage': typeof sessionStorage !== 'undefined',
      'IndexedDB': typeof indexedDB !== 'undefined',
      'Fetch': typeof fetch !== 'undefined',
      'Promise': typeof Promise !== 'undefined',
      'Crypto': typeof crypto !== 'undefined',
      'File API': typeof File !== 'undefined',
      'FormData': typeof FormData !== 'undefined'
    };

    Object.entries(apis).forEach(([api, supported]) => {
      if (supported) {
      } else {
        console.error(`❌ ${api}: NOT SUPPORTED`);
        this.issues.push(`Browser API missing: ${api}`);
      }
    });

    console.groupEnd();
  }

  /**
   * Check network connectivity
   */
  async checkNetworkConnectivity() {
    console.group('🔗 NETWORK CONNECTIVITY CHECK');

    try {
      const startTime = performance.now();
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        mode: 'no-cors'
      });
      const endTime = performance.now();

      this.performance.networkLatency = endTime - startTime;
    } catch (e) {
      this.warnings.push('Network connectivity check failed');
      console.warn('⚠️ Network: May be offline or restricted');
    }

    console.groupEnd();
  }

  /**
   * Check screen and viewport
   */
  checkViewport() {
    console.group('📱 VIEWPORT CHECK');

    if (window.innerWidth < 768) {
      this.info.push('Mobile viewport detected');
    }

    console.groupEnd();
  }

  /**
   * Check performance metrics
   */
  checkPerformance() {
    console.group('⚡ PERFORMANCE METRICS');

    if (window.performance && window.performance.timing) {
      const timing = window.performance.timing;
      const loadTime = timing.loadEventEnd - timing.navigationStart;
      const responseTime = timing.responseEnd - timing.requestStart;
      const renderTime = timing.domContentLoadedEventEnd - timing.navigationStart;

      this.performance.loadTime = loadTime;
      this.performance.responseTime = responseTime;
      this.performance.renderTime = renderTime;

      if (loadTime > 3000) {
        this.warnings.push(`Slow page load: ${loadTime}ms`);
      }
    }

    if (window.performance && window.performance.memory) {
      const memory = window.performance.memory;
      this.performance.memory = {
        used: memory.usedJSHeapSize,
        limit: memory.jsHeapSizeLimit
      };
    }

    console.groupEnd();
  }

  /**
   * Check key service endpoints
   */
  checkServiceEndpoints() {
    console.group('🔌 SERVICE ENDPOINTS CHECK');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
    } else {
      console.error('❌ Supabase URL not configured');
      this.issues.push('Supabase URL not configured');
    }

    console.groupEnd();
  }

  /**
   * Generate comprehensive report
   */
  generateReport() {
    console.group(`📊 DIAGNOSTICS REPORT [${TIMESTAMP}]`);

    console.group('SUMMARY');
    console.groupEnd();

    if (this.issues.length > 0) {
      console.group('CRITICAL ISSUES');
      this.issues.forEach(issue => {
        console.error(`❌ ${issue}`);
      });
      console.groupEnd();
    }

    if (this.warnings.length > 0) {
      console.group('WARNINGS');
      this.warnings.forEach(warning => {
        console.warn(`⚠️ ${warning}`);
      });
      console.groupEnd();
    }

    console.group('PERFORMANCE');
    console.table(this.performance);
    console.groupEnd();

    console.group('ENVIRONMENT');
    console.groupEnd();

    console.groupEnd();

    return {
      version: DIAGNOSTICS_VERSION,
      timestamp: TIMESTAMP,
      issues: this.issues,
      warnings: this.warnings,
      info: this.info,
      performance: this.performance
    };
  }

  /**
   * Run all diagnostics
   */
  async runAll() {
    console.clear();

    this.checkEnvironment();
    this.checkStorage();
    this.checkBrowserAPIs();
    this.checkViewport();
    this.checkServiceEndpoints();
    await this.checkNetworkConnectivity();
    this.checkPerformance();

    return this.generateReport();
  }
}

// Export singleton instance
export const diagnostics = new SystemDiagnostics();

// Auto-run on module load in dev mode
if (import.meta.env.DEV) {
  window.__papuDiagnostics = diagnostics;
}
