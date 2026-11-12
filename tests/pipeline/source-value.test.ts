import { expect, it } from 'vitest';
import { sourceValueAdvice } from '../../src/lib/source-value';
const baseline = { enabled:true, intervalMinutes:10, totalPosts:100, buyerPosts:20, contactedPosts:5, wonPosts:1, dismissedPosts:0,
  truncatedPosts:0, processingPending:0, runCount:10, errorRuns:0, hasCurrentVersionHeartbeat:true, lastExtensionAt:new Date('2026-11-12T12:00:00Z') };
const now = new Date('2026-11-12T12:02:00Z');
it('suggests frequency only when current collection and owner outcomes support it, never applies settings', () => {
  expect(sourceValueAdvice(baseline,now)).toMatchObject({action:'increase',suggestedIntervalMinutes:5});
  expect(sourceValueAdvice({...baseline,contactedPosts:0,wonPosts:0,dismissedPosts:30},now)).toMatchObject({action:'decrease',suggestedIntervalMinutes:20});
  expect(sourceValueAdvice({...baseline,contactedPosts:0,wonPosts:0},now)).toMatchObject({action:'unknown',suggestedIntervalMinutes:null});
});
it('does not interpret missing telemetry, little data, or disabled collection as poor lead quality', () => {
  for(const changed of [{hasCurrentVersionHeartbeat:false},{lastExtensionAt:null},{lastExtensionAt:new Date('2026-11-11')},{totalPosts:5},{runCount:1}]) {
    expect(sourceValueAdvice({...baseline,...changed},now).suggestedIntervalMinutes).toBeNull();
  }
  expect(sourceValueAdvice({...baseline,enabled:false},now).action).toBe('keep');
});
it('prioritizes repairs over speeding a backlogged or incomplete-text collector and bounds proposals', () => {
  for(const changed of [{errorRuns:4},{truncatedPosts:30},{processingPending:40}]) expect(sourceValueAdvice({...baseline,...changed},now).action).toBe('repair');
  expect(sourceValueAdvice({...baseline,intervalMinutes:3},now)).toMatchObject({action:'keep',suggestedIntervalMinutes:null});
  expect(sourceValueAdvice({...baseline,intervalMinutes:150,contactedPosts:0,wonPosts:0,dismissedPosts:30},now).suggestedIntervalMinutes).toBe(180);
});
