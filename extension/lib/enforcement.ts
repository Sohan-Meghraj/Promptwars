import { findActiveRuleForDomain, hasActiveGrantForDomain, isRuleActive } from './schedule';
import { loadSnapshot } from './storage';
import type { AccessGrant, RestrictionRule } from './types';

const DNR_ID_START = 1_000_000;

function dnrIdFor(rule: RestrictionRule, occupied: Set<number>): number {
  let hash = 0;
  for (let index = 0; index < rule.id.length; index += 1) {
    hash = (hash * 31 + (rule.id.charCodeAt(index) || 0)) >>> 0;
  }
  let candidate = DNR_ID_START + (hash % 1_000_000_000);
  while (occupied.has(candidate)) candidate += 1;
  occupied.add(candidate);
  return candidate;
}

function createRedirectRule(rule: RestrictionRule, id: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { extensionPath: '/gate.html' },
    },
    condition: {
      urlFilter: `||${rule.domain}/`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

export async function hasProtectionPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
}

export async function reconcileEnforcement(): Promise<{
  activeRuleCount: number;
  isPermissionGranted: boolean;
}> {
  const snapshot = await loadSnapshot();
  const permissionGranted = await hasProtectionPermission();
  const activeRules = permissionGranted
    ? snapshot.rules.filter(
        (rule) =>
          isRuleActive(rule) && !hasActiveGrantForDomain(snapshot.grants, rule.domain),
      )
    : [];
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const occupied = new Set<number>();
  const nextRules = activeRules.map((rule) => createRedirectRule(rule, dnrIdFor(rule, occupied)));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: currentRules.map((rule) => rule.id),
    addRules: nextRules,
  });

  return { activeRuleCount: activeRules.length, isPermissionGranted: permissionGranted };
}

export function matchingActiveRule(
  rules: RestrictionRule[],
  grants: AccessGrant[],
  hostname: string,
): RestrictionRule | null {
  if (hasActiveGrantForDomain(grants, hostname)) return null;
  return findActiveRuleForDomain(rules, hostname);
}

export async function setScheduleAlarm(): Promise<void> {
  await chrome.alarms.create('scrollgate:reconcile', {
    periodInMinutes: 1,
  });
}

export async function setGrantExpiryAlarm(grants: AccessGrant[]): Promise<void> {
  const futureGrants = grants.filter((grant) => new Date(grant.expiresAt).getTime() > Date.now());
  if (futureGrants.length === 0) {
    await chrome.alarms.clear('scrollgate:grant-expiry');
    return;
  }

  let nextExpiry = new Date(futureGrants[0]?.expiresAt ?? 0).getTime();
  for (const grant of futureGrants) {
    const expiry = new Date(grant.expiresAt).getTime();
    if (expiry < nextExpiry) nextExpiry = expiry;
  }
  await chrome.alarms.create('scrollgate:grant-expiry', { when: nextExpiry });
}
