// The backend tests exercise the 0.4.0 server engine; in the shipped 0.5.0 it is off (src/backend.ts LEGACY_ENGINE).
Reflect.set(globalThis, '__LV_TRANSLATOR_LEGACY__', true);
