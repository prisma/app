// Local dev convenience (not part of the deploy artifact). The app's own entry
// calls service.load() directly, unaddressed — for standalone local dev that
// reads plain DB_URL/PORT from the local environment (the serializer's
// unprefixed case).
import '../src/server.ts';
