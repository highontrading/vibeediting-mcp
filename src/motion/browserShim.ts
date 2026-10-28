/**
 * Injected into the page before any of its scripts. It replaces the clock so that
 * animations are driven frame by frame (deterministic, no dropped frames):
 * - requestAnimationFrame callbacks run once per rendered frame with the frame time
 * - performance.now() and Date.now() return the frame time
 * - CSS animations / Web Animations are paused and seeked
 * - if the page defines window.seek(t) (t in seconds), it is called every frame
 */
export const SHIM = `(() => {
  let now = 0;
  const epoch = 1700000000000;
  const queue = new Map();
  let nextId = 1;
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { queue.delete(id); };
  const perfNow = () => now;
  try { Object.defineProperty(performance, 'now', { value: perfNow, configurable: true }); } catch (e) { performance.now = perfNow; }
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) { super(epoch + now); } else { super(...a); } }
    static now() { return epoch + now; }
  }
  window.Date = FakeDate;
  window.__vibeErrors = [];
  window.addEventListener('error', (e) => window.__vibeErrors.push(String(e.message || e)));
  window.__vibeSeek = async (t) => {
    now = t * 1000;
    if (document.getAnimations) {
      for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = now; } catch (e) {} }
    }
    if (typeof window.seek === 'function') { await window.seek(t); }
    const cbs = Array.from(queue.values()); queue.clear();
    for (const cb of cbs) { try { cb(now); } catch (e) { window.__vibeErrors.push(String(e && e.message || e)); } }
  };
})();`;
