// '/' for anyone who isn't through the 18+ gate. On the web: the landing page (public: lib/gate.ts
// PUBLIC_WEB_PATHS). In the apps: straight on to sign-in or the gate step the account is at. Adults never
// get here: the root layout shows the tabs (Home) at '/' for them. Metro resolves LandingScreen to
// LandingScreen.web.tsx on the web and LandingScreen.tsx in the apps.
export { LandingScreen as default } from '../../features/landing/LandingScreen';
