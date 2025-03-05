// Console logger with debug levels and throttling
(function() {
  // Debug levels
  const DEBUG_LEVELS = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    LOG: 3,
    ALL: 4
  };
  
  class Logger {
    constructor(options = {}) {
      this.enabled = options.enabled ?? false;
      this.debugLevel = DEBUG_LEVELS.ERROR; // Default to ERROR only
      this.throttleMap = new Map();
      this.throttleInterval = 1000;
      
      // Clean up old throttle entries every minute
      setInterval(() => this.cleanThrottleMap(), 60000);
      
      // Add to window for easy access
      window.DEBUG_LEVELS = DEBUG_LEVELS;
    }
    
    setLevel(level) {
      if (typeof level === 'string') {
        this.debugLevel = DEBUG_LEVELS[level.toUpperCase()] || DEBUG_LEVELS.ERROR;
      } else if (typeof level === 'number') {
        this.debugLevel = Math.max(0, Math.min(level, DEBUG_LEVELS.ALL));
      }
      console.log(`Debug level set to: ${Object.keys(DEBUG_LEVELS).find(k => DEBUG_LEVELS[k] === this.debugLevel)}`);
    }
    
    cleanThrottleMap() {
      const now = Date.now();
      for (const [key, timestamp] of this.throttleMap.entries()) {
        if (now - timestamp > this.throttleInterval) {
          this.throttleMap.delete(key);
        }
      }
    }
    
    shouldLog(level) {
      return this.enabled && DEBUG_LEVELS[level] <= this.debugLevel;
    }
    
    throttle(key) {
      const now = Date.now();
      const lastLog = this.throttleMap.get(key) || 0;
      if (now - lastLog < this.throttleInterval) return true;
      this.throttleMap.set(key, now);
      return false;
    }
    
    log(...args) {
      if (!this.shouldLog('LOG')) return;
      
      const key = args.join('');
      if (this.throttle(key)) return;
      
      console.log('[LOG]', ...args);
    }
    
    warn(...args) {
      if (!this.shouldLog('WARN')) return;
      console.warn('[WARN]', ...args);
    }
    
    error(...args) {
      if (!this.shouldLog('ERROR')) return;
      console.error('[ERROR]', ...args);
    }
  }

  // Create and export a singleton instance
  window.DEBUG = new Logger({ enabled: true });
  
  // Usage examples:
  // DEBUG.setLevel('ERROR')  // Only show errors
  // DEBUG.setLevel('WARN')   // Show warnings and errors
  // DEBUG.setLevel('LOG')    // Show all logs
  // DEBUG.setLevel('ALL')    // Show everything
  // DEBUG.setLevel('NONE')   // Show nothing
})(); 