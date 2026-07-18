import { formatRuleEndTime } from './schedule';
import type { LocalIntervention, RestrictionRule } from './types';

export const GENERIC_FALLBACK: LocalIntervention = {
  headline: 'This site is protected right now.',
  message: 'ScrollGate has kept this navigation local and private.',
  microAction: 'Close this tab and return to the next small task.',
  resetText: 'Put both feet on the floor, take one slow breath, then choose a two-minute next step.',
  source: 'local_fallback',
};

export function createLocalFallback(rule: RestrictionRule | null): LocalIntervention {
  if (!rule) return GENERIC_FALLBACK;
  const endTime = formatRuleEndTime(rule);
  const reason = rule.reason ? ` ${rule.reason}` : '';
  const goal = rule.goal ? ` Return to: ${rule.goal}` : '';

  return {
    headline: 'Past-you set this boundary.',
    message: `${rule.domain} is restricted until ${endTime}.${reason}${goal}`,
    microAction: rule.goal ? `Open ${rule.goal} and take the smallest next step.` : 'Pick one small focus task and begin it now.',
    resetText: 'Put both feet on the floor, take one slow breath, and write the first two-minute step of your next task.',
    source: 'local_fallback',
  };
}
