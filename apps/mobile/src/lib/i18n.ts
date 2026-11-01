// i18next setup. English only for now; every string lives in src/i18n/en/<namespace>.json and keys carry
// their namespace ('errors:rate_limited'). The web-only redeem namespace is never loaded in the native apps
// (App Store 3.1.1: no mention of codes or web purchases in the iOS app).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import age from '../i18n/en/age.json';
import ai from '../i18n/en/ai.json';
import auth from '../i18n/en/auth.json';
import common from '../i18n/en/common.json';
import create from '../i18n/en/create.json';
import editor from '../i18n/en/editor.json';
import errors from '../i18n/en/errors.json';
import home from '../i18n/en/home.json';
import profile from '../i18n/en/profile.json';
import redeem from '../i18n/en/redeem.json';
import report from '../i18n/en/report.json';
import series from '../i18n/en/series.json';
import settings from '../i18n/en/settings.json';
import story from '../i18n/en/story.json';
import studio from '../i18n/en/studio.json';
import unlock from '../i18n/en/unlock.json';
import vip from '../i18n/en/vip.json';
import wallet from '../i18n/en/wallet.json';
import watch from '../i18n/en/watch.json';

const resources = { age, ai, auth, common, create, editor, errors, home, profile, report, series, settings, story, studio, unlock, vip, wallet, watch, ...(Platform.OS === 'web' ? { redeem } : {}) };

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: resources },
  ns: Object.keys(resources),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
