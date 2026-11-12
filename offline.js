// Keeps the app usable with no signal, on a course or a trail, and lets a
// phone add it to its home screen. Every page loads this.
//
// The work is done by sw.js, which the browser runs apart from any page: it
// keeps a copy of each file the site is made of and hands that over when the
// network cannot.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {
    // No copy kept, then: the site still works wherever there is a signal.
  });
}
