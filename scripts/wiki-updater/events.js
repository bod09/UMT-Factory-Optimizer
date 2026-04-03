// Event detection from Game Updates page
import { USER_AGENT, API_BASE } from './config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Parse the Game Updates page for event mentions with dates
export async function detectEvents() {
  const url = `${API_BASE}?action=parse&page=Game+Updates&prop=wikitext&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  if (!res.ok) return { events: [], activeEvent: null };

  const data = await res.json();
  const wikitext = data.parse?.wikitext?.['*'] || '';

  const events = [];

  // Pattern: "participated in [[Event Name]] from DATE to DATE"
  // Start date may or may not have year (e.g., "12 September to 22 September 2025")
  const eventPattern = /participated in \[\[([^\]]+)\]\]\s*from\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)\s+to\s+(\d{1,2}\s+\w+\s+\d{4})/gi;
  let match;
  while ((match = eventPattern.exec(wikitext)) !== null) {
    const endDate = parseDate(match[3]);
    // Start date may lack year - inherit from end date
    let startStr = match[2].trim();
    if (!/\d{4}/.test(startStr) && endDate) {
      startStr += ' ' + endDate.getFullYear();
    }
    const startDate = parseDate(startStr);
    if (startDate && endDate) {
      events.push({
        name: match[1].trim(),
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        active: isActive(startDate, endDate),
      });
    }
  }

  // Also check for "Event" mentions with dates in version headers
  // Pattern: "Released on DATE" near event keywords
  const lines = wikitext.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for event announcements in features/changes sections
    if (/\bevent\b/i.test(line) && !/race event|fixed|patched/i.test(line)) {
      // Check nearby lines for release date
      for (let j = Math.max(0, i - 10); j < i; j++) {
        const dateMatch = lines[j].match(/Released on (\d{1,2}\s+\w+\s+\d{4})/);
        if (dateMatch) {
          const releaseDate = parseDate(dateMatch[1]);
          if (releaseDate && !events.find(e => e.name === line.trim())) {
            // Check if this is a start or end of event
            if (/refunded|removed|ended/i.test(line)) {
              // Event ended on this date
              const existing = events.find(e => !e.endDate);
              if (existing) existing.endDate = releaseDate.toISOString().split('T')[0];
            }
          }
          break;
        }
      }
    }
  }

  // Also try to fetch dedicated event pages for more details
  for (const event of events) {
    await sleep(500);
    try {
      const eventRes = await fetch(
        `${API_BASE}?action=parse&page=${encodeURIComponent(event.name)}&prop=wikitext&format=json`,
        { headers: { 'User-Agent': USER_AGENT } }
      );
      if (eventRes.ok) {
        const eventData = await eventRes.json();
        const eventWt = eventData.parse?.wikitext?.['*'] || '';

        // Look for machine names mentioned on the event page
        const machineRefs = eventWt.match(/\[\[([^\]|]+(?:Machine|Maker|Mixer|Painter|Factory)[^\]]*)\]\]/g);
        if (machineRefs) {
          event.machines = machineRefs.map(r => r.replace(/\[\[|\]\]/g, '').split('|')[0]);
        }

        // Check for explicit date range
        const dateRange = eventWt.match(/(\d{1,2}\s+\w+\s+\d{4})\s*(?:to|until|-)\s*(\d{1,2}\s+\w+\s+\d{4})/);
        if (dateRange) {
          const start = parseDate(dateRange[1]);
          const end = parseDate(dateRange[2]);
          if (start) event.startDate = start.toISOString().split('T')[0];
          if (end) event.endDate = end.toISOString().split('T')[0];
          event.active = isActive(start, end);
        }
      }
    } catch (e) {
      // Event page might not exist
    }
  }

  // Determine currently active event (if any)
  const activeEvent = events.find(e => e.active) || null;

  return { events, activeEvent };
}

function parseDate(str) {
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function isActive(startDate, endDate) {
  if (!startDate || !endDate) return false;
  const now = new Date();
  return now >= startDate && now <= endDate;
}
