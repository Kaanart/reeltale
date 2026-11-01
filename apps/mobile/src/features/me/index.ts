// Public surface of the Me feature. Other features import from here, not from the files inside.
//
//   BlockButton, useIsBlocked, useSetBlocked  block / unblock one account (profile screens, "..." menus)
//   reportHref(type, id, creatorId?)           the /report modal route for series, episodes, AI scenes, profiles
//   useWallet, demoWalletCell                  the wallet query (key ['u', userId, 'wallet']) and its demo state
//   useAiConsents, consentOn, AI_CONSENT_*     per-purpose AI consent (Settings is where people change it)
//   useSubscriptions, activeSubscription       the account's VIP

export { BlockButton } from './components/BlockButton';
export { demoWalletCell, useAiConsents, useIsBlocked, useSetBlocked, useSubscriptions, useWallet } from './hooks';
export { AI_CONSENT_PURPOSES, AI_CONSENT_VERSION, consentArgs, consentOn } from './logic/consent';
export type { AiConsentPurpose, ConsentRow } from './logic/consent';
export { reportHref } from './logic/report';
export type { ReportTargetType } from './logic/report';
export { activeSubscription } from './logic/subscription';
export type { SubscriptionRow } from './logic/subscription';
