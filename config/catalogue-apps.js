import { APP_ID, APP_DETAILS } from '../learning-tracker/config.js';
import { APP_ID as TECH_WEEK_ID, APP_DETAILS as TECH_WEEK_DETAILS } from '../apps/sf-tech-week-oct-8/config.js';
import { APP_ID as BLOCKPLAN_ID, APP_DETAILS as BLOCKPLAN_DETAILS } from '../apps/blockplan/config.js';

// New apps hosted inside this site live under apps/<name>/ and must declare
// their path and branding here.
// Standalone template repositories publish their root app automatically.
export const HOSTED_APPS = [{
  path: 'learning-tracker/',
  appId: APP_ID,
  details: APP_DETAILS,
  templateOnly: true, // Don't advertise a duplicate tracker in generated repos.
}, {
  path: 'apps/sf-tech-week-oct-8/',
  appId: TECH_WEEK_ID,
  details: TECH_WEEK_DETAILS,
  templateOnly: true,
}, {
  path: 'apps/blockplan/',
  appId: BLOCKPLAN_ID,
  details: BLOCKPLAN_DETAILS,
  templateOnly: true,
}];
