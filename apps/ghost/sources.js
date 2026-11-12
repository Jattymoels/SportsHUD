// Where positions come from.
//
// A source hands over positions. `begin()` marks the start of the run and
// `elapsed()` is seconds since then. A live fix is stamped when it arrives;
// a replayed one carries its own time.

export function liveSource(onFix, onError) {
  let watch = null;
  let began = null;
  return {
    open() {
      if (!navigator.geolocation) return onError({ message: 'This browser has no location service.' });
      watch = navigator.geolocation.watchPosition(
        (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
        onError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    },
    close() {
      if (watch != null) navigator.geolocation.clearWatch(watch);
    },
    begin() {
      began = performance.now();
    },
    elapsed: () => (performance.now() - began) / 1000,
  };
}

export function demoSource(fixes, speed, onFix) {
  let began = null;
  let next = 0;
  let timer = null;
  const elapsed = () => ((performance.now() - began) / 1000) * speed;
  return {
    open() {
      // Stand at the start until the run begins.
      timer = setInterval(() => {
        if (began == null) return onFix({ lat: fixes[0].lat, lon: fixes[0].lon, accuracy: 5 });
        while (next < fixes.length && fixes[next].t <= elapsed()) onFix({ ...fixes[next++], accuracy: 5 });
      }, 100);
    },
    close() {
      clearInterval(timer);
    },
    begin() {
      began = performance.now();
    },
    elapsed,
    ended: () => began != null && next >= fixes.length,
  };
}

