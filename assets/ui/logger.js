// Simple console logger with throttling
(function() {
  class Logger {
    constructor(options = {}) {
      this.enabled = options.enabled ?? false;
      this.throttleMap = new Map();
      this.throttleInterval = 1000; // Throttle identical messages to once per second
      
      // Clean up old throttle entries every minute
      setInterval(() => this.cleanThrottleMap(), 60000);
    }
    
    cleanThrottleMap() {
      const now = Date.now();
      for (const [key, timestamp] of this.throttleMap.entries()) {
        if (now - timestamp > this.throttleInterval) {
          this.throttleMap.delete(key);
        }
      }
    }
    
    log(...args) {
      if (!this.enabled) return;
      
      const key = args.join('');
      const now = Date.now();
      const lastLog = this.throttleMap.get(key) || 0;
      
      // Throttle identical messages to once per second
      if (now - lastLog < this.throttleInterval) return;
      
      this.throttleMap.set(key, now);
      console.log('[LOG]', ...args);
    }
    
    warn(...args) {
      if (!this.enabled) return;
      console.warn('[WARN]', ...args);
    }
    
    error(...args) {
      // Always log errors regardless of enabled state
      console.error('[ERROR]', ...args);
    }
  }

  // Create and export a singleton instance
  window.DEBUG = new Logger({ enabled: true });
})(); 