import type { ActivityLog, Baby } from '../types';

const TYPE_LABELS: Record<string, string> = {
  breastFeeding: '母乳',
  bottleFeeding: 'ミルク',
  sleep: '睡眠',
  pee: 'おしっこ',
  poop: 'うんち',
  diaper: 'おむつ',
  bath: 'お風呂',
  cry: '泣き',
  temperature: '体温',
  meal: '離乳食',
  memo: 'メモ',
};

function calcAgeText(birthDate: string, referenceDate: string): string {
  const birth = new Date(birthDate);
  const ref = new Date(referenceDate);
  const diffMs = ref.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return '生後0日';
  if (diffDays < 30) return `生後${diffDays}日`;

  let months = (ref.getFullYear() - birth.getFullYear()) * 12 + (ref.getMonth() - birth.getMonth());
  if (ref.getDate() < birth.getDate()) months--;
  if (months < 1) return `生後${diffDays}日`;
  return `生後${months}ヶ月`;
}

function formatTime(isoTimestamp: string): string {
  // Extract HH:MM from ISO timestamp
  const d = new Date(isoTimestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function extractDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function formatLogEntry(log: ActivityLog): string {
  const time = formatTime(log.timestamp);
  const label = TYPE_LABELS[log.type] ?? log.type;

  switch (log.type) {
    case 'breastFeeding': {
      const parts: string[] = [];
      if (log.leftBreastMinutes !== undefined) parts.push(`左${log.leftBreastMinutes}分`);
      if (log.rightBreastMinutes !== undefined) parts.push(`右${log.rightBreastMinutes}分`);
      return `${time} ${label}: ${parts.join('・') || '記録あり'}`;
    }
    case 'bottleFeeding':
      return `${time} ${label}: ${log.amountML ?? 0}ml`;
    case 'sleep': {
      if (log.sleepEnd) {
        const endTime = formatTime(log.sleepEnd);
        const startMs = new Date(log.timestamp).getTime();
        const endMs = new Date(log.sleepEnd).getTime();
        const durationMin = Math.round((endMs - startMs) / 60000);
        const hours = Math.floor(durationMin / 60);
        const mins = durationMin % 60;
        const durationText = hours > 0 ? `${hours}時間${mins > 0 ? `${mins}分` : ''}` : `${mins}分`;
        return `${time} ${label}: ${time}〜${endTime}（${durationText}）`;
      }
      return `${time} ${label}: ${time}〜（睡眠中）`;
    }
    case 'diaper': {
      const parts: string[] = [];
      if (log.hasPee) parts.push('おしっこ');
      if (log.hasPoop) parts.push('うんち');
      return `${time} ${label}: ${parts.join('・') || '交換のみ'}`;
    }
    case 'pee':
      return `${time} おしっこ`;
    case 'poop':
      return `${time} うんち`;
    case 'temperature':
      return `${time} ${label}: ${log.temperature ?? '-'}℃`;
    case 'cry':
      return `${time} ${label}${log.note ? `（${log.note}）` : ''}`;
    case 'meal':
      return `${time} ${label}${log.note ? `: ${log.note}` : ''}`;
    case 'memo':
      return `${time} ${label}: ${log.note ?? ''}`;
    case 'bath':
      return `${time} ${label}${log.note ? `（${log.note}）` : ''}`;
    default:
      return `${time} ${label}`;
  }
}

/**
 * Format activity logs as a daily summary for the /v1/advice endpoint.
 */
export function formatDailySummary(baby: Baby, date: string, logs: ActivityLog[]): string {
  const ageText = calcAgeText(baby.birthDate, date);
  const header = `${baby.name}ちゃん（${ageText}）の${date}の記録：`;

  if (logs.length === 0) {
    return `${header}\nまだ記録がありません。`;
  }

  // Sort by timestamp
  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const entries = sorted.map(formatLogEntry);
  return `${header}\n${entries.join('\n')}`;
}

/**
 * Format activity logs grouped by date for the /v1/chat endpoint.
 */
export function formatChatContext(baby: Baby, logs: ActivityLog[]): string {
  if (logs.length === 0) return '';

  // Determine reference date from latest log
  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const latestDate = extractDate(sorted[sorted.length - 1].timestamp);
  const ageText = calcAgeText(baby.birthDate, latestDate);
  const header = `${baby.name}ちゃん（${ageText}）の記録：`;

  // Group by date
  const groups = new Map<string, ActivityLog[]>();
  for (const log of sorted) {
    const date = extractDate(log.timestamp);
    const group = groups.get(date);
    if (group) {
      group.push(log);
    } else {
      groups.set(date, [log]);
    }
  }

  const sections: string[] = [header];
  for (const [date, dateLogs] of groups) {
    sections.push(`\n【${date}】`);
    for (const log of dateLogs) {
      sections.push(formatLogEntry(log));
    }
  }

  return sections.join('\n');
}
