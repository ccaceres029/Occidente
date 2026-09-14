export function addDays(value, days) {
  const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function sprintCalendar(start, pause, virtualDay = 2) {
  if (!Number.isInteger(virtualDay) || virtualDay < 0 || virtualDay > 6) throw new Error('Selecciona un día válido para la reunión virtual.');
  if (!start) return Array.from({length:8}, (_, i) => ({ sprint:i+1, start:null, end:null, saturday:null, virtual:null }));
  const initial = new Date(start + 'T12:00:00Z');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(initial.getTime()) || initial.toISOString().slice(0,10) !== start || initial.getUTCDay() !== 1) throw new Error('Selecciona un lunes válido para iniciar.');
  const result = []; let day=start, sprint=1;
  while(sprint<=8) {
    const paused = pause && day==='2026-10-05';
    result.push({sprint:paused?null:sprint,start:day,end:addDays(day,6),saturday:paused?null:addDays(day,5),virtual:paused?null:addDays(day,virtualDay)});
    day=addDays(day,7); if(!paused)sprint++;
  }
  return result;
}
export function shortDate(value) { return value ? new Date(value+'T12:00:00Z').toLocaleDateString('es-HN',{day:'2-digit',month:'short',timeZone:'UTC'}) : 'Por acordar'; }
export function holiday(value) {
  if(value==='2026-09-15')return 'Independencia';
  if(value==='2026-10-07')return 'Feriado desde las 12:00';
  if(value==='2026-10-08'||value==='2026-10-09')return 'Feriado Morazánico';
  if(value==='2026-10-10')return 'Sin revisión · feriado hasta las 12:00';
  return '';
}
