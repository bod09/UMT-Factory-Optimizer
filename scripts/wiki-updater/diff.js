// Generate PR body with diff report
export function generateDiffReport(changes, events) {
  const lines = ['## Wiki Update Report\n'];

  // Event status
  if (events?.length > 0) {
    const active = events.filter(e => e.active);
    if (active.length > 0) {
      lines.push('### Active Events');
      for (const e of active) {
        lines.push(`- **${e.name}** (${e.startDate} to ${e.endDate})`);
        if (e.machines?.length) lines.push(`  - Event machines: ${e.machines.join(', ')}`);
      }
      lines.push('');
    }
  }

  if (changes.added.length > 0) {
    lines.push('### New Machines Found');
    lines.push('These need manual setup (inputs, outputs, effect, tags):\n');
    for (const m of changes.added) {
      lines.push(`- **${m.name}** (\`${m.id}\`)`);
    }
    lines.push('');
  }

  if (changes.costChanges.length > 0) {
    lines.push('### Cost Changes (Game Balance)');
    for (const c of changes.costChanges) {
      lines.push(`- **${c.name}**: $${c.old?.toLocaleString()} → $${c.new?.toLocaleString()}`);
    }
    lines.push('');
  }

  if (changes.descChanges.length > 0) {
    lines.push('### Description Changes');
    lines.push('May indicate mechanic changes - review carefully:\n');
    for (const d of changes.descChanges) {
      lines.push(`- **${d.name}**`);
      lines.push(`  - Old: ${d.old}...`);
      lines.push(`  - New: ${d.new}...`);
    }
    lines.push('');
  }

  if (changes.updated.length > 0) {
    lines.push('### Updated Fields');
    for (const u of changes.updated) {
      lines.push(`- **${u.name}**: ${u.changes.join(', ')}`);
    }
    lines.push('');
  }

  const total = changes.added.length + changes.updated.length;
  if (total === 0) {
    lines.push('No changes detected - machines.json is up to date with the wiki.');
  } else {
    lines.push(`---`);
    lines.push(`*${total} machine(s) affected. Custom fields (inputs, outputs, effects, tags) were NOT modified.*`);
  }

  return lines.join('\n');
}
